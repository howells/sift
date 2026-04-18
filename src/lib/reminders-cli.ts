import { spawnSync } from "node:child_process";

function runRemindctl(args: string[]): Record<string, unknown> {
	const result = spawnSync("remindctl", args, {
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
		timeout: 30_000,
	});

	if (result.error) {
		return { error: result.error.message };
	}

	if (result.status !== 0) {
		return { error: (result.stderr || "remindctl command failed").trim() };
	}

	try {
		return JSON.parse(result.stdout) as Record<string, unknown>;
	} catch {
		return { ok: true, output: result.stdout.trim() };
	}
}

/** List Apple Reminders via remindctl. */
export function listReminders(args: string[]): Record<string, unknown> {
	return runRemindctl([
		"list",
		...args,
		...(args.includes("--json") ? [] : ["--json"]),
	]);
}

/** Create a new Apple Reminder via remindctl. */
export function addReminder(args: string[]): Record<string, unknown> {
	return runRemindctl(["add", ...args]);
}

/** Mark an Apple Reminder as complete via remindctl. */
export function completeReminder(args: string[]): Record<string, unknown> {
	return runRemindctl(["complete", ...args]);
}

/** Delete an Apple Reminder via remindctl. */
export function deleteReminder(args: string[]): Record<string, unknown> {
	return runRemindctl(["delete", ...args]);
}
