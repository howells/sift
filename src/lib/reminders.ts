import { execSync, spawnSync } from "node:child_process";
import type { ReminderListConfig } from "./config.js";
import type { Todo, Urgency } from "./types.js";

const SIFT_PREFIX = "sift:email:";

interface Reminder {
	id: string;
	title: string;
	notes?: string;
	isCompleted: boolean;
	listName: string;
	dueDate?: string; // ISO date string
	priority?: number; // 0 = none, 1 = high, 5 = medium, 9 = low
}

export type ReminderState = "none" | "pending" | "completed";

/**
 * Get all reminders from a list and extract email IDs + completion state.
 * Returns a Map of emailId → ReminderState.
 */
export function getEmailReminderStates(
	list = "Work",
): Map<string, ReminderState> {
	try {
		const output = execSync(`remindctl list "${list}" --json`, {
			stdio: ["pipe", "pipe", "pipe"],
			encoding: "utf-8",
		});

		const reminders: Reminder[] = JSON.parse(output);
		const states = new Map<string, ReminderState>();

		for (const reminder of reminders) {
			if (reminder.notes?.includes(SIFT_PREFIX)) {
				// Find the sift:email: line anywhere in notes
				const match = reminder.notes.match(
					new RegExp(`${SIFT_PREFIX}([a-zA-Z0-9]+)`),
				);
				if (match?.[1]) {
					states.set(match[1], reminder.isCompleted ? "completed" : "pending");
				}
			}
		}

		return states;
	} catch {
		return new Map();
	}
}

/**
 * Check if a specific email already has a reminder.
 */
export function hasReminder(emailId: string, list = "Work"): boolean {
	const states = getEmailReminderStates(list);
	return states.has(emailId);
}

/**
 * Find reminder ID by email ID (for completing reminders).
 */
export function findReminderIdByEmail(
	emailId: string,
	list = "Work",
): string | null {
	try {
		const output = execSync(`remindctl list "${list}" --json`, {
			stdio: ["pipe", "pipe", "pipe"],
			encoding: "utf-8",
		});

		const reminders: Reminder[] = JSON.parse(output);

		for (const reminder of reminders) {
			// Search for sift:email:{emailId} anywhere in notes
			if (reminder.notes?.includes(`${SIFT_PREFIX}${emailId}`)) {
				return reminder.id;
			}
		}

		return null;
	} catch {
		return null;
	}
}

/**
 * Complete a reminder by email ID.
 */
export function completeReminderByEmail(
	emailId: string,
	list = "Work",
): boolean {
	const reminderId = findReminderIdByEmail(emailId, list);
	if (!reminderId) return false;

	try {
		execSync(`remindctl complete "${reminderId}"`, { stdio: "pipe" });
		return true;
	} catch {
		return false;
	}
}

function urgencyToDue(
	_urgency: Urgency,
	deadline: string | null,
): string | undefined {
	// Only set due date if there's a specific deadline from the email
	if (!deadline || deadline === "ASAP") return undefined;
	// Return the deadline as-is (e.g., "Fri Jan 24")
	return deadline;
}

function urgencyToPriority(urgency: Urgency): string | undefined {
	return urgency === "overdue" ? "high" : undefined;
}

interface CreateReminderResult {
	success: boolean;
	alreadyExists: boolean;
	list?: string;
	error?: string;
}

interface ReminderOptions {
	title?: string; // Custom title (default: todo.summary)
	notes?: string; // Custom notes (default: from/subject)
}

export function createReminderFromTodo(
	todo: Todo,
	list = "Work",
	options?: ReminderOptions,
): CreateReminderResult {
	// Only email-sourced todos can create reminders
	if (!todo.emailId) {
		return { success: false, alreadyExists: false, error: "No email ID" };
	}

	// Check for duplicate by querying Apple Reminders
	if (hasReminder(todo.emailId, list)) {
		return { success: false, alreadyExists: true, list };
	}

	const due = urgencyToDue(todo.urgency, todo.deadline);
	const priority = urgencyToPriority(todo.urgency);

	// Use custom title or fall back to summary
	const title = options?.title || todo.summary;

	// Gmail thread URL (clickable in Reminders)
	const gmailUrl = todo.threadId
		? `https://mail.google.com/mail/u/0/#inbox/${todo.threadId}`
		: null;

	// Build notes with context + email ID for reconciliation
	const noteLines: string[] = [];

	// Add Gmail link at top for easy access
	if (gmailUrl) {
		noteLines.push(gmailUrl, "");
	}

	if (options?.notes) {
		// Claude-generated notes - add context header
		noteLines.push(options.notes, "", `From: ${todo.from}`);
	} else {
		// Default notes
		noteLines.push(`From: ${todo.from}`);
		if (todo.reasoning) {
			noteLines.push("", todo.reasoning);
		}
	}
	// Email ID at end for reconciliation
	noteLines.push("", `${SIFT_PREFIX}${todo.emailId}`);

	// Build notes with actual newlines
	const notes = noteLines.join("\n");

	// Build args array - avoids shell escaping issues
	const args = ["add", title, "--list", list, "--notes", notes];
	if (due) args.push("--due", due);
	if (priority) args.push("--priority", priority);

	try {
		const result = spawnSync("remindctl", args, { stdio: "pipe" });
		if (result.status !== 0) {
			return {
				success: false,
				alreadyExists: false,
				error: result.stderr?.toString() || "remindctl failed",
			};
		}
		return { success: true, alreadyExists: false, list };
	} catch (err) {
		return {
			success: false,
			alreadyExists: false,
			error: err instanceof Error ? err.message : "Unknown error",
		};
	}
}

/**
 * Convert reminder priority (1=high, 5=medium, 9=low) and due date to urgency.
 */
function reminderToUrgency(reminder: Reminder): Urgency {
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

	if (reminder.dueDate) {
		const dueDate = new Date(reminder.dueDate);
		const dueDateOnly = new Date(
			dueDate.getFullYear(),
			dueDate.getMonth(),
			dueDate.getDate(),
		);

		// Overdue if due date is before today
		if (dueDateOnly < today) {
			return "overdue";
		}

		// Due this week (within 7 days)
		const weekFromNow = new Date(today);
		weekFromNow.setDate(weekFromNow.getDate() + 7);
		if (dueDateOnly <= weekFromNow) {
			return "this_week";
		}
	}

	// High priority = this_week even without due date
	if (reminder.priority === 1) {
		return "this_week";
	}

	return "when_you_can";
}

/**
 * Format due date as "Ddd Mmm DD" (e.g., "Fri Jan 24")
 */
function formatDeadline(dueDate?: string): string | null {
	if (!dueDate) return null;

	const date = new Date(dueDate);
	const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
	const months = [
		"Jan",
		"Feb",
		"Mar",
		"Apr",
		"May",
		"Jun",
		"Jul",
		"Aug",
		"Sep",
		"Oct",
		"Nov",
		"Dec",
	];

	return `${days[date.getDay()]} ${months[date.getMonth()]} ${date.getDate()}`;
}

/**
 * Check if a reminder is relevant (pending/overdue and not email-sourced).
 */
function isRelevantReminder(reminder: Reminder): boolean {
	// Skip completed reminders
	if (reminder.isCompleted) return false;

	// Skip email-sourced reminders (they show up via email analysis)
	if (reminder.notes?.startsWith(SIFT_PREFIX)) return false;

	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

	// If has due date, check if overdue or due within a week
	if (reminder.dueDate) {
		const dueDate = new Date(reminder.dueDate);
		const dueDateOnly = new Date(
			dueDate.getFullYear(),
			dueDate.getMonth(),
			dueDate.getDate(),
		);

		const weekFromNow = new Date(today);
		weekFromNow.setDate(weekFromNow.getDate() + 7);

		// Include if overdue or due within a week
		return dueDateOnly <= weekFromNow;
	}

	// Include high priority items even without due date
	if (reminder.priority === 1) return true;

	// Skip items with no due date and no high priority
	return false;
}

/**
 * Fetch pending/overdue reminders from Apple Reminders and convert to Todos.
 */
export function fetchPendingReminders(
	reminderLists: ReminderListConfig[],
): Todo[] {
	const todos: Todo[] = [];

	for (const config of reminderLists) {
		try {
			const output = execSync(`remindctl list "${config.list}" --json`, {
				stdio: ["pipe", "pipe", "pipe"],
				encoding: "utf-8",
			});

			const reminders: Reminder[] = JSON.parse(output);

			for (const reminder of reminders) {
				if (!isRelevantReminder(reminder)) continue;

				const urgency = reminderToUrgency(reminder);
				const deadline = formatDeadline(reminder.dueDate);

				todos.push({
					source: "reminder",
					id: `reminder-${reminder.id}`,
					reminderId: reminder.id,
					account: config.list, // Use list name as "account"
					group: config.group,
					subject: reminder.title,
					from: "",
					fromEmail: "",
					summary: reminder.title,
					urgency,
					reasoning: reminder.dueDate ? `Due: ${deadline}` : "High priority",
					date: reminder.dueDate || new Date().toISOString(),
					isStarred: false,
					person: "",
					deadline,
					reminderState: "pending", // All fetched reminders are pending
				});
			}
		} catch {
			// Silently skip failed lists
		}
	}

	return todos;
}

/**
 * Complete a reminder by its ID (for reminder-sourced todos).
 */
export function completeReminderById(reminderId: string): boolean {
	try {
		execSync(`remindctl complete "${reminderId}"`, { stdio: "pipe" });
		return true;
	} catch {
		return false;
	}
}

/**
 * Open the Reminders app.
 */
export function openRemindersApp(): void {
	try {
		execSync("open -a Reminders", { stdio: "pipe" });
	} catch {
		// Silently fail
	}
}
