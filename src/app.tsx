import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useEffect, useState } from "react";
import { Header } from "./components/Header.js";
import { Spinner } from "./components/Spinner.js";
import { StatusBar } from "./components/StatusBar.js";
import { TodoList } from "./components/TodoList.js";
import {
	getAccountGroupsList,
	getAccounts,
	getAuthenticatedClient,
} from "./lib/auth.js";
import { removeCachedAnalysis } from "./lib/cache.js";
import { analyzeEmails, generateReminderFromEmail } from "./lib/claude.js";
import { configExists, getReminderLists, loadConfig } from "./lib/config.js";
import { type Email, GmailClient } from "./lib/gmail.js";
import {
	completeReminderByEmail,
	completeReminderById,
	createReminderFromTodo,
	fetchPendingReminders,
	getEmailReminderStates,
	openRemindersApp,
} from "./lib/reminders.js";
import type { ReminderState, Todo, View } from "./lib/types.js";

export function App() {
	const { exit } = useApp();
	const { stdout } = useStdout();
	// Stay 1 row under terminal height so Ink uses efficient in-place
	// rendering (log-update) instead of clearTerminal + full redraw
	const terminalHeight = (stdout?.rows || 24) - 1;

	const [view, setView] = useState<View>("main");
	const [todos, setTodos] = useState<Todo[]>([]);
	const [backlog, setBacklog] = useState<Todo[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
	const [loading, setLoading] = useState<{
		active: boolean;
		message: string;
		step: number;
		detail?: string;
	}>({ active: true, message: "Initializing...", step: 1 });
	const [error, setError] = useState<string | null>(null);
	const [gmailClients, setGmailClients] = useState<Map<string, GmailClient>>(
		new Map(),
	);
	const [refreshTrigger, setRefreshTrigger] = useState(0);

	// Get accounts and groups from config
	const accounts = getAccounts();
	const accountGroups = getAccountGroupsList();

	// Initialize Gmail clients
	useEffect(() => {
		async function init() {
			try {
				// Check config exists
				if (!configExists()) {
					setError("No config found. Run 'sift --setup' to configure.");
					setLoading((l) => ({ ...l, active: false }));
					return;
				}

				// Step 1: Connect to accounts
				setLoading({ active: true, message: "Connecting to Gmail", step: 1 });
				const clients = new Map<string, GmailClient>();

				for (let i = 0; i < accounts.length; i++) {
					const account = accounts[i];
					setLoading((l) => ({
						...l,
						detail: `${account.name} (${i + 1}/${accounts.length})`,
					}));
					const auth = await getAuthenticatedClient(account.name);
					clients.set(account.name, new GmailClient(auth, account.email));
				}

				setGmailClients(clients);

				// Step 2: Fetch emails
				setLoading({ active: true, message: "Fetching emails", step: 2 });
				const allEmails: { account: string; group: string; emails: Email[] }[] =
					[];
				let totalEmails = 0;

				for (let i = 0; i < accounts.length; i++) {
					const account = accounts[i];
					setLoading((l) => ({
						...l,
						detail: `${account.name} (${i + 1}/${accounts.length})`,
					}));
					const client = clients.get(account.name)!;
					const starred = await client.listStarred(200);
					const unread = await client.listUnread(100);

					// Combine and deduplicate
					const combined = [...starred];
					for (const email of unread) {
						if (!combined.find((e) => e.id === email.id)) {
							combined.push(email);
						}
					}

					totalEmails += combined.length;
					allEmails.push({
						account: account.name,
						group: account.group,
						emails: combined,
					});
				}

				// Step 3: Analyze with Claude
				setLoading({
					active: true,
					message: "Analyzing with Claude",
					step: 3,
					detail: `${totalEmails} emails to check`,
				});

				// Analyze with Claude (uses cache for unchanged emails)
				const result = await analyzeEmails(
					allEmails,
					new Date(),
					(cached, toAnalyze) => {
						const detail =
							toAnalyze === 0
								? `All ${cached} from cache`
								: cached > 0
									? `${cached} cached, analyzing ${toAnalyze} new`
									: `Analyzing ${toAnalyze} emails`;
						setLoading((l) => ({ ...l, detail }));
					},
				);

				// Split into active todos and backlog (older than 30 days)
				const thirtyDaysAgo = new Date();
				thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

				const active: Todo[] = [];
				const old: Todo[] = [];

				// Get config for reminder lists
				const config = loadConfig();
				const reminderLists = config ? getReminderLists(config) : null;

				// Get reminder states from Apple Reminders (single source of truth)
				// Use first reminder list or default to "Work"
				const defaultList = reminderLists?.[0]?.list ?? "Work";
				const reminderStates = getEmailReminderStates(defaultList);

				for (const todo of result.todos) {
					// Hydrate reminder state from Apple Reminders
					const todoWithReminder = {
						...todo,
						reminderState:
							reminderStates.get(todo.emailId ?? "") ??
							("none" as ReminderState),
					};

					const todoDate = new Date(todo.date);
					if (todoDate < thirtyDaysAgo) {
						old.push(todoWithReminder);
					} else {
						active.push(todoWithReminder);
					}
				}

				// Fetch and merge Apple Reminders if configured
				if (reminderLists && reminderLists.length > 0) {
					const reminderTodos = fetchPendingReminders(reminderLists);
					active.push(...reminderTodos);
				}

				setTodos(active);
				setBacklog(old);
				setLoading((l) => ({ ...l, active: false }));
			} catch (err) {
				setError(err instanceof Error ? err.message : "Unknown error");
				setLoading((l) => ({ ...l, active: false }));
			}
		}

		init();
	}, [refreshTrigger]);

	// Get filtered todos based on selected group, sorted by urgency to match display order
	const urgencyOrder = { overdue: 0, this_week: 1, when_you_can: 2 };
	const filteredTodos = (
		selectedGroup ? todos.filter((t) => t.group === selectedGroup) : todos
	).sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

	// Get filtered backlog (same filtering, sorted by date oldest first)
	const filteredBacklog = (
		selectedGroup ? backlog.filter((t) => t.group === selectedGroup) : backlog
	).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

	// Get the current list based on view
	const currentList = view === "backlog" ? filteredBacklog : filteredTodos;

	// Keyboard handling
	useInput((input, key) => {
		if (loading.active) return;

		// Navigation
		if (key.upArrow || input === "k") {
			setSelectedIndex((i) => Math.max(0, i - 1));
		}
		if (key.downArrow || input === "j") {
			setSelectedIndex((i) => Math.min(currentList.length - 1, i + 1));
		}

		// Toggle backlog view
		if (input === "b") {
			setView((v) => (v === "backlog" ? "main" : "backlog"));
			setSelectedIndex(0);
		}

		// Escape to go back to main
		if (key.escape && view === "backlog") {
			setView("main");
			setSelectedIndex(0);
		}

		// Group switching (1-N based on config)
		const num = parseInt(input, 10);
		if (num >= 1 && num <= accountGroups.length) {
			const group = accountGroups[num - 1];
			setSelectedGroup((current) => (current === group ? null : group));
			setSelectedIndex(0);
		}

		// Open in browser (email) or Reminders app (reminder)
		if (key.return && currentList[selectedIndex]) {
			const todo = currentList[selectedIndex];
			if (todo.source === "reminder") {
				openRemindersApp();
			} else if (todo.threadId) {
				const client = gmailClients.get(todo.account);
				if (client) {
					client.openInBrowser(todo.threadId);
				}
			}
		}

		// Done (unstar + mark read + remove from cache + complete reminder)
		if (input === "d" && currentList[selectedIndex]) {
			const todo = currentList[selectedIndex];

			// Handle reminder-sourced todos
			if (todo.source === "reminder" && todo.reminderId) {
				completeReminderById(todo.reminderId);
				const newListLength = currentList.filter(
					(t) => t.id !== todo.id,
				).length;
				if (view === "backlog") {
					setBacklog((prev) => prev.filter((t) => t.id !== todo.id));
				} else {
					setTodos((prev) => prev.filter((t) => t.id !== todo.id));
				}
				setSelectedIndex((i) => Math.min(i, Math.max(0, newListLength - 1)));
				return;
			}

			// Handle email-sourced todos
			if (todo.source === "email" && todo.emailId) {
				const emailId = todo.emailId; // Capture for closure
				const client = gmailClients.get(todo.account);
				if (client) {
					// Complete associated reminder if it exists
					if (todo.reminderState !== "none") {
						const config = loadConfig();
						const reminderLists = config ? getReminderLists(config) : null;
						const defaultList = reminderLists?.[0]?.list ?? "Work";
						completeReminderByEmail(emailId, defaultList);
					}

					Promise.all([client.unstar(emailId), client.markRead(emailId)]).then(
						() => {
							removeCachedAnalysis(emailId);
							// Calculate new list length after removal for proper index clamping
							const newListLength = currentList.filter(
								(t) => t.id !== todo.id,
							).length;
							if (view === "backlog") {
								setBacklog((prev) => prev.filter((t) => t.id !== todo.id));
							} else {
								setTodos((prev) => {
									const newTodos = prev.filter((t) => t.id !== todo.id);
									// Auto-refresh when list gets low (< 5 items)
									if (newTodos.length < 5 && !loading.active) {
										setTimeout(() => {
											setLoading({
												active: true,
												message: "Fetching more emails",
												step: 1,
											});
											setRefreshTrigger((n) => n + 1);
										}, 100);
									}
									return newTodos;
								});
							}
							setSelectedIndex((i) =>
								Math.min(i, Math.max(0, newListLength - 1)),
							);
						},
					);
				}
			}
		}

		// Star (save for later) - only for email-sourced todos
		if (input === "s" && currentList[selectedIndex]) {
			const todo = currentList[selectedIndex];
			// Skip for reminder-sourced items (no email to star)
			if (todo.source === "reminder") return;

			if (!todo.isStarred && todo.emailId) {
				const client = gmailClients.get(todo.account);
				if (client) {
					client.star(todo.emailId).then(() => {
						// Update the todo's starred status in state
						const updateTodo = (t: Todo) =>
							t.id === todo.id ? { ...t, isStarred: true } : t;
						if (view === "backlog") {
							setBacklog((prev) => prev.map(updateTodo));
						} else {
							setTodos((prev) => prev.map(updateTodo));
						}
					});
				}
			}
		}

		// Create Apple Reminder (t = "to-do") - only for email-sourced todos
		if (input === "t" && currentList[selectedIndex]) {
			const todo = currentList[selectedIndex];

			// Skip for reminder-sourced items (already a reminder)
			if (todo.source === "reminder") return;

			// Already has reminder (pending or completed) - no action
			if (todo.reminderState !== "none") {
				return;
			}

			// Get config for reminder list
			const config = loadConfig();
			const reminderLists = config ? getReminderLists(config) : null;
			const defaultList = reminderLists?.[0]?.list ?? "Work";

			// Async: fetch thread, generate with Claude, create reminder
			(async () => {
				const client = gmailClients.get(todo.account);
				if (!client || !todo.threadId) {
					// Fall back to simple reminder
					const result = createReminderFromTodo(todo, defaultList);
					if (result.success) {
						const updateTodo = (t: Todo) =>
							t.id === todo.id
								? { ...t, reminderState: "pending" as ReminderState }
								: t;
						if (view === "backlog") {
							setBacklog((prev) => prev.map(updateTodo));
						} else {
							setTodos((prev) => prev.map(updateTodo));
						}
					}
					return;
				}

				// Mark as pending immediately for UI feedback
				const markPending = (t: Todo) =>
					t.id === todo.id
						? { ...t, reminderState: "pending" as ReminderState }
						: t;
				if (view === "backlog") {
					setBacklog((prev) => prev.map(markPending));
				} else {
					setTodos((prev) => prev.map(markPending));
				}

				try {
					// Fetch full thread
					const thread = await client.getThread(todo.threadId);
					if (!thread) {
						createReminderFromTodo(todo, defaultList);
						return;
					}

					// Generate specific action with Claude
					const reminderContent = await generateReminderFromEmail(
						thread,
						todo.summary,
					);

					// Create reminder with Claude-generated content
					createReminderFromTodo(todo, defaultList, {
						title: reminderContent.title,
						notes: reminderContent.notes,
					});
				} catch {
					// Fall back to simple reminder on error
					createReminderFromTodo(todo, defaultList);
				}
			})();
		}

		// Refresh
		if (input === "r") {
			setLoading({ active: true, message: "Connecting to Gmail", step: 1 });
			setTodos([]);
			setBacklog([]);
			setSelectedIndex(0);
			setView("main");
			setRefreshTrigger((n) => n + 1);
		}

		// Quit
		if (input === "q") {
			exit();
		}
	});

	if (error) {
		return (
			<Box flexDirection="column" height={terminalHeight} padding={1}>
				<Text color="red">Error: {error}</Text>
				<Text dimColor>Press q to quit</Text>
			</Box>
		);
	}

	if (loading.active) {
		return (
			<Box flexDirection="column" height={terminalHeight} padding={1}>
				<Header groups={accountGroups} selectedGroup={selectedGroup} />
				<Box paddingY={1}>
					<Spinner
						message={loading.message}
						step={loading.step}
						totalSteps={3}
						detail={loading.detail}
					/>
				</Box>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" height={terminalHeight}>
			<Box paddingX={1}>
				<Header
					groups={accountGroups}
					selectedGroup={selectedGroup}
					backlogCount={backlog.length}
					isBacklogView={view === "backlog"}
				/>
			</Box>

			<Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
				{view === "backlog" ? (
					<TodoList
						todos={filteredBacklog}
						selectedIndex={selectedIndex}
						showAccount={selectedGroup === null}
					/>
				) : (
					<TodoList
						todos={filteredTodos}
						selectedIndex={selectedIndex}
						showAccount={selectedGroup === null}
					/>
				)}
			</Box>

			<Box paddingX={1}>
				<StatusBar
					bindings={
						view === "backlog"
							? [
									{ key: "↑↓", label: "Nav" },
									{ key: "Enter", label: "Open" },
									{ key: "d", label: "Done" },
									{ key: "s", label: "Star" },
									{ key: "t", label: "Remind" },
									{ key: "b/Esc", label: "Back" },
									{ key: "q", label: "Quit" },
								]
							: [
									{ key: "↑↓", label: "Nav" },
									{ key: "Enter", label: "Open" },
									{ key: "d", label: "Done" },
									{ key: "s", label: "Star" },
									{ key: "t", label: "Remind" },
									{ key: "b", label: `Backlog (${backlog.length})` },
									{ key: "r", label: "Refresh" },
									{ key: "q", label: "Quit" },
								]
					}
					extraInfo={`${currentList.length} items`}
				/>
			</Box>
		</Box>
	);
}
