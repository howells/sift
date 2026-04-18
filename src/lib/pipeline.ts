/**
 * Core data pipeline — shared by TUI and CLI.
 * Fetches emails, analyzes with Claude, splits into active/backlog.
 */
import type { AccountConfig } from "./auth.ts";
import { getAccountGroupsList, getAccounts } from "./auth.ts";
import { pruneOldEntries, removeCachedAnalysis } from "./cache.ts";
import { analyzeEmails, generateReminderFromEmail } from "./claude.ts";
import {
	configExists,
	getReminderLists,
	getTaskBackend,
	loadConfig,
	type SiftConfig,
} from "./config.ts";
import { GmailClient, isGogAvailable } from "./gmail.ts";
import {
	completeReminderByEmail,
	completeReminderById,
	createReminderFromTodo,
	fetchPendingReminders,
	getEmailReminderStates,
	isRemindctlAvailable,
} from "./reminders.ts";
import { createThingsTodoFromTodo } from "./things.ts";
import type { ReminderState, Todo } from "./types.ts";

// --- Types ---

export interface SiftData {
	accounts: AccountConfig[];
	active: Todo[];
	backlog: Todo[];
	clients: Map<string, GmailClient>;
	groups: string[];
}

export type ProgressCallback = (
	step: number,
	message: string,
	detail?: string,
) => void;

// --- Validation ---

/** Check that config, gog, and optional remindctl are available. */
export function validateEnvironment(): {
	config: SiftConfig;
	error: string | null;
} {
	if (!configExists()) {
		return {
			config: null as unknown as SiftConfig,
			error: "No config found. Run 'sift --setup' to configure.",
		};
	}

	if (!isGogAvailable()) {
		return {
			config: null as unknown as SiftConfig,
			error: "'gog' CLI not found. Install it: https://github.com/howells/gog",
		};
	}

	const config = loadConfig();
	if (!config) {
		return {
			config: null as unknown as SiftConfig,
			error: "Failed to load config.",
		};
	}

	const reminderLists = getReminderLists(config);
	if (
		getTaskBackend(config) === "reminders" &&
		reminderLists?.length &&
		!isRemindctlAvailable()
	) {
		return {
			config,
			error:
				"'remindctl' CLI not found but reminder lists are configured. Install it or remove reminderLists from config.",
		};
	}

	return { config, error: null };
}

// --- Core pipeline ---

/** Fetch emails from all accounts, analyze with Claude, and split into active/backlog. */
export async function fetchAndAnalyze(
	onProgress?: ProgressCallback,
): Promise<SiftData> {
	const { config, error } = validateEnvironment();
	if (error) {
		throw new Error(error);
	}

	const accounts = getAccounts();
	const groups = getAccountGroupsList();
	const reminderLists = getReminderLists(config);

	pruneOldEntries(90);

	// Step 1: Connect
	onProgress?.(1, "Connecting to Gmail");
	const clients = new Map<string, GmailClient>();
	for (const account of accounts) {
		clients.set(account.name, new GmailClient(account.email));
	}

	// Step 2: Fetch
	onProgress?.(2, "Fetching emails");
	const allEmails = await Promise.all(
		accounts.map(async (account) => {
			const client = clients.get(account.name);
			if (!client) {
				return { account: account.name, group: account.group, emails: [] };
			}
			const [starred, unread] = await Promise.all([
				client.listStarred(200),
				client.listUnread(100),
			]);
			const starredIds = new Set(starred.map((e) => e.id));
			const combined = [...starred];
			for (const email of unread) {
				if (!starredIds.has(email.id)) {
					combined.push(email);
				}
			}
			return { account: account.name, group: account.group, emails: combined };
		}),
	);

	// Step 3: Analyze
	const totalEmails = allEmails.reduce((sum, a) => sum + a.emails.length, 0);
	onProgress?.(3, "Analyzing with Claude", `${totalEmails} emails`);

	const result = await analyzeEmails(
		allEmails,
		new Date(),
		(cached, toAnalyze) => {
			if (toAnalyze === 0) {
				onProgress?.(3, "Analyzing with Claude", `All ${cached} from cache`);
			} else if (cached > 0) {
				onProgress?.(
					3,
					"Analyzing with Claude",
					`${cached} cached, analyzing ${toAnalyze} new`,
				);
			} else {
				onProgress?.(
					3,
					"Analyzing with Claude",
					`Analyzing ${toAnalyze} emails`,
				);
			}
		},
	);

	// Split into active/backlog
	const thirtyDaysAgo = new Date();
	thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

	const defaultList = reminderLists?.[0]?.list ?? "Work";
	const reminderStates = getEmailReminderStates(defaultList);

	const active: Todo[] = [];
	const backlog: Todo[] = [];

	for (const todo of result.todos) {
		const enriched = {
			...todo,
			reminderState:
				reminderStates.get(todo.emailId ?? "") ?? ("none" as ReminderState),
		};
		if (new Date(todo.date) < thirtyDaysAgo) {
			backlog.push(enriched);
		} else {
			active.push(enriched);
		}
	}

	// Add pending reminders to active list
	const finalActive = reminderLists?.length
		? [...active, ...fetchPendingReminders(reminderLists).todos]
		: active;

	return { accounts, active: finalActive, backlog, clients, groups };
}

// --- Actions (stateless, for CLI use) ---

const urgencyOrder = { overdue: 0, this_week: 1, when_you_can: 2 };

/** Sort todos by urgency: overdue first, then this_week, then when_you_can. */
export function sortByUrgency(todos: Todo[]): Todo[] {
	return [...todos].sort(
		(a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency],
	);
}

/** Filter todos to only those belonging to a specific account group. */
export function filterByGroup(todos: Todo[], group: string): Todo[] {
	return todos.filter((t) => t.group === group);
}

export interface ActionResult {
	action: string;
	backend?: "reminders" | "things";
	error?: string;
	id: string;
	success: boolean;
}

/** Find a todo by its ID, email ID, or thread ID. */
export function findTodoById(todos: Todo[], id: string): Todo | undefined {
	return todos.find(
		(t) => t.id === id || t.emailId === id || t.threadId === id,
	);
}

/** Mark a todo as done: unstar/mark-read for emails, complete for reminders. */
export async function executeDone(
	todo: Todo,
	clients: Map<string, GmailClient>,
): Promise<ActionResult> {
	if (todo.source === "reminder" && todo.reminderId) {
		const success = completeReminderById(todo.reminderId);
		return { action: "done", id: todo.id, success };
	}

	if (todo.source === "email" && todo.emailId) {
		const client = clients.get(todo.account);
		if (!client) {
			return {
				action: "done",
				id: todo.id,
				success: false,
				error: `No client for account: ${todo.account}`,
			};
		}

		const config = loadConfig();
		const reminderLists = config ? getReminderLists(config) : null;
		const defaultList = reminderLists?.[0]?.list ?? "Work";

		if (todo.reminderState !== "none") {
			completeReminderByEmail(todo.emailId, defaultList);
		}

		const [unstarred, read] = await Promise.all([
			client.unstar(todo.emailId),
			client.markRead(todo.emailId),
		]);

		if (unstarred && read) {
			removeCachedAnalysis(todo.emailId);
		}

		return { action: "done", id: todo.id, success: unstarred && read };
	}

	return {
		action: "done",
		id: todo.id,
		success: false,
		error: "Unknown source",
	};
}

/** Star an email-backed todo in Gmail. */
export function executeStar(
	todo: Todo,
	clients: Map<string, GmailClient>,
): ActionResult {
	if (todo.source === "reminder") {
		return {
			action: "star",
			id: todo.id,
			success: false,
			error: "Cannot star a reminder",
		};
	}
	if (!todo.emailId) {
		return {
			action: "star",
			id: todo.id,
			success: false,
			error: "No email ID",
		};
	}

	const client = clients.get(todo.account);
	if (!client) {
		return {
			action: "star",
			id: todo.id,
			success: false,
			error: `No client for account: ${todo.account}`,
		};
	}

	const success = client.star(todo.emailId);
	return { action: "star", id: todo.id, success };
}

/** Create an Apple Reminder or Things todo from an email-backed todo. */
export async function executeRemind(
	todo: Todo,
	clients: Map<string, GmailClient>,
): Promise<ActionResult> {
	if (todo.source === "reminder") {
		return {
			action: "remind",
			id: todo.id,
			success: false,
			error: "Already a reminder",
		};
	}
	if (todo.reminderState !== "none") {
		return {
			action: "remind",
			id: todo.id,
			success: false,
			error: "Reminder already exists",
		};
	}

	const config = loadConfig();
	const taskBackend = getTaskBackend(config);
	const reminderLists = config ? getReminderLists(config) : null;
	const defaultList = reminderLists?.[0]?.list ?? "Work";

	const client = clients.get(todo.account);
	if (client && todo.threadId) {
		try {
			const thread = await client.getThread(todo.threadId);
			if (thread) {
				const content = await generateReminderFromEmail(thread, todo.summary);
				const result =
					taskBackend === "things"
						? createThingsTodoFromTodo(todo, config, {
								title: content.title,
								notes: content.notes,
							})
						: createReminderFromTodo(todo, defaultList, {
								title: content.title,
								notes: content.notes,
							});
				return {
					action: "remind",
					backend: taskBackend,
					error: result.error,
					id: todo.id,
					success: result.success,
				};
			}
		} catch {
			// Fall through to basic reminder
		}
	}

	const result =
		taskBackend === "things"
			? createThingsTodoFromTodo(todo, config)
			: createReminderFromTodo(todo, defaultList);
	return {
		action: "remind",
		backend: taskBackend,
		error: result.error,
		id: todo.id,
		success: result.success,
	};
}

/** Return a Gmail web URL for a todo's thread. */
export function executeOpen(
	todo: Todo,
	clients: Map<string, GmailClient>,
): ActionResult {
	if (todo.source === "reminder") {
		return {
			action: "open",
			id: todo.id,
			success: true,
			error: "Opening Reminders app",
		};
	}

	if (!todo.threadId) {
		return {
			action: "open",
			id: todo.id,
			success: false,
			error: "No thread ID",
		};
	}

	const client = clients.get(todo.account);
	if (!client) {
		return {
			action: "open",
			id: todo.id,
			success: false,
			error: `No client for account: ${todo.account}`,
		};
	}

	return {
		action: "open",
		id: todo.id,
		success: true,
		// Return URL instead of opening — agent can decide what to do
		error: client.getWebUrl(todo.threadId),
	};
}
