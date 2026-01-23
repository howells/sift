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
import { analyzeEmails } from "./lib/claude.js";
import { configExists } from "./lib/config.js";
import { type Email, GmailClient } from "./lib/gmail.js";
import {
	completeReminderByEmail,
	createReminderFromTodo,
	getEmailReminderStates,
} from "./lib/reminders.js";
import type { ReminderState, Todo, View } from "./lib/types.js";

export function App() {
	const { exit } = useApp();
	const { stdout } = useStdout();
	const terminalHeight = stdout?.rows || 24;

	const [view, setView] = useState<View>("main");
	const [todos, setTodos] = useState<Todo[]>([]);
	const [backlog, setBacklog] = useState<Todo[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [loadingMessage, setLoadingMessage] = useState("Initializing...");
	const [loadingStep, setLoadingStep] = useState(1);
	const [loadingDetail, setLoadingDetail] = useState<string | undefined>();
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
					setIsLoading(false);
					return;
				}

				// Step 1: Connect to accounts
				setLoadingStep(1);
				setLoadingMessage("Connecting to Gmail");
				const clients = new Map<string, GmailClient>();

				for (let i = 0; i < accounts.length; i++) {
					const account = accounts[i];
					setLoadingDetail(`${account.name} (${i + 1}/${accounts.length})`);
					const auth = await getAuthenticatedClient(account.name);
					clients.set(account.name, new GmailClient(auth, account.email));
				}

				setGmailClients(clients);

				// Step 2: Fetch emails
				setLoadingStep(2);
				setLoadingMessage("Fetching emails");
				const allEmails: { account: string; group: string; emails: Email[] }[] =
					[];
				let totalEmails = 0;

				for (let i = 0; i < accounts.length; i++) {
					const account = accounts[i];
					setLoadingDetail(`${account.name} (${i + 1}/${accounts.length})`);
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
				setLoadingStep(3);
				setLoadingMessage("Analyzing with Claude");
				setLoadingDetail(`${totalEmails} emails to check`);

				// Analyze with Claude (uses cache for unchanged emails)
				const result = await analyzeEmails(
					allEmails,
					new Date(),
					(cached, toAnalyze) => {
						if (toAnalyze === 0) {
							setLoadingDetail(`All ${cached} from cache`);
						} else if (cached > 0) {
							setLoadingDetail(`${cached} cached, analyzing ${toAnalyze} new`);
						} else {
							setLoadingDetail(`Analyzing ${toAnalyze} emails`);
						}
					},
				);

				// Split into active todos and backlog (older than 30 days)
				const thirtyDaysAgo = new Date();
				thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

				const active: Todo[] = [];
				const old: Todo[] = [];

				// Get reminder states from Apple Reminders (single source of truth)
				const reminderStates = getEmailReminderStates("Work");

				for (const todo of result.todos) {
					// Hydrate reminder state from Apple Reminders
					const todoWithReminder = {
						...todo,
						reminderState:
							reminderStates.get(todo.emailId) ?? ("none" as ReminderState),
					};

					const todoDate = new Date(todo.date);
					if (todoDate < thirtyDaysAgo) {
						old.push(todoWithReminder);
					} else {
						active.push(todoWithReminder);
					}
				}

				setTodos(active);
				setBacklog(old);
				setIsLoading(false);
			} catch (err) {
				setError(err instanceof Error ? err.message : "Unknown error");
				setIsLoading(false);
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
		if (isLoading) return;

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

		// Open in browser
		if (key.return && currentList[selectedIndex]) {
			const todo = currentList[selectedIndex];
			const client = gmailClients.get(todo.account);
			if (client) {
				client.openInBrowser(todo.threadId);
			}
		}

		// Done (unstar + mark read + remove from cache + complete reminder)
		if (input === "d" && currentList[selectedIndex]) {
			const todo = currentList[selectedIndex];
			const client = gmailClients.get(todo.account);
			if (client) {
				// Complete associated reminder if it exists
				if (todo.reminderState !== "none") {
					completeReminderByEmail(todo.emailId, "Work");
				}

				Promise.all([
					client.unstar(todo.emailId),
					client.markRead(todo.emailId),
				]).then(() => {
					removeCachedAnalysis(todo.emailId);
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
							if (newTodos.length < 5 && !isLoading) {
								setTimeout(() => {
									setIsLoading(true);
									setLoadingStep(1);
									setLoadingMessage("Fetching more emails");
									setLoadingDetail(undefined);
									setRefreshTrigger((n) => n + 1);
								}, 100);
							}
							return newTodos;
						});
					}
					setSelectedIndex((i) => Math.min(i, Math.max(0, newListLength - 1)));
				});
			}
		}

		// Star (save for later)
		if (input === "s" && currentList[selectedIndex]) {
			const todo = currentList[selectedIndex];
			if (!todo.isStarred) {
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

		// Create Apple Reminder (t = "to-do")
		if (input === "t" && currentList[selectedIndex]) {
			const todo = currentList[selectedIndex];

			// Already has reminder (pending or completed) - no action
			if (todo.reminderState !== "none") {
				return;
			}

			const result = createReminderFromTodo(todo, "Work");

			if (result.success) {
				// Update local state to show ☐ indicator
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
		}

		// Refresh
		if (input === "r") {
			setIsLoading(true);
			setLoadingStep(1);
			setLoadingMessage("Connecting to Gmail");
			setLoadingDetail(undefined);
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

	if (isLoading) {
		return (
			<Box flexDirection="column" height={terminalHeight} padding={1}>
				<Header groups={accountGroups} selectedGroup={selectedGroup} />
				<Box justifyContent="center" paddingY={2}>
					<Spinner
						message={loadingMessage}
						step={loadingStep}
						totalSteps={3}
						detail={loadingDetail}
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
