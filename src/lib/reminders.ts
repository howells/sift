import { execSync } from "node:child_process";
import type { Todo, Urgency } from "./types.js";

const SIFT_PREFIX = "sift:email:";

interface Reminder {
	id: string;
	title: string;
	notes?: string;
	isCompleted: boolean;
	listName: string;
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
			if (reminder.notes?.startsWith(SIFT_PREFIX)) {
				const firstLine = reminder.notes.split("\n")[0];
				const emailId = firstLine.replace(SIFT_PREFIX, "");
				if (emailId) {
					states.set(emailId, reminder.isCompleted ? "completed" : "pending");
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
			if (reminder.notes?.startsWith(SIFT_PREFIX)) {
				const firstLine = reminder.notes.split("\n")[0];
				const id = firstLine.replace(SIFT_PREFIX, "");
				if (id === emailId) {
					return reminder.id;
				}
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

function urgencyToDue(urgency: Urgency): string | undefined {
	switch (urgency) {
		case "overdue":
			return "today";
		case "this_week":
			return "friday";
		case "when_you_can":
			return undefined;
	}
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

export function createReminderFromTodo(
	todo: Todo,
	list = "Work",
): CreateReminderResult {
	// Check for duplicate by querying Apple Reminders
	if (hasReminder(todo.emailId, list)) {
		return { success: false, alreadyExists: true, list };
	}

	const due = urgencyToDue(todo.urgency);
	const priority = urgencyToPriority(todo.urgency);

	// Notes with email ID on first line for reconciliation
	const notes = [
		`${SIFT_PREFIX}${todo.emailId}`,
		"---",
		`From: ${todo.from} <${todo.fromEmail}>`,
		`Subject: ${todo.subject}`,
	].join("\n");

	// Build command
	const args = [
		"add",
		JSON.stringify(todo.summary),
		"--list",
		JSON.stringify(list),
	];
	if (due) args.push("--due", due);
	if (priority) args.push("--priority", priority);
	args.push("--notes", JSON.stringify(notes));

	try {
		execSync(`remindctl ${args.join(" ")}`, { stdio: "pipe" });
		return { success: true, alreadyExists: false, list };
	} catch (err) {
		return {
			success: false,
			alreadyExists: false,
			error: err instanceof Error ? err.message : "Unknown error",
		};
	}
}
