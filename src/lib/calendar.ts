import { spawnSync } from "node:child_process";

export interface CalendarEvent {
	calendar?: string;
	end?: string;
	time?: string;
	title: string;
}

export function getCalendarToday(): CalendarEvent[] | { error: string } {
	const result = spawnSync("gog", ["calendar", "today", "--json"], {
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
		timeout: 30_000,
	});

	if (result.error) {
		return { error: result.error.message };
	}

	if (result.status !== 0) {
		return { error: (result.stderr || "calendar command failed").trim() };
	}

	try {
		return JSON.parse(result.stdout) as CalendarEvent[];
	} catch {
		return { error: "Failed to parse calendar output" };
	}
}
