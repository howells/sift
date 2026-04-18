import { spawnSync } from "node:child_process";
import { loadConfig } from "./config.ts";

export interface CalendarEvent {
	calendar?: string;
	end?: string;
	time?: string;
	title: string;
}

interface GogCalendarEvent {
	calendarId?: string;
	end?: {
		date?: string;
		dateTime?: string;
	};
	organizer?: {
		displayName?: string;
		email?: string;
	};
	start?: {
		date?: string;
		dateTime?: string;
	};
	summary?: string;
}

function getCalendarAccounts(): string[] {
	const config = loadConfig();
	const candidates = [
		config?.calendar?.account,
		...(config?.accounts.map((account) => account.email) ?? []),
	];

	return Array.from(
		new Set(
			candidates.filter(
				(value): value is string =>
					typeof value === "string" && value.length > 0,
			),
		),
	);
}

function formatEventTime(value?: string): string | undefined {
	if (!value) {
		return undefined;
	}

	if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return "All day";
	}

	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return value;
	}

	return parsed.toLocaleTimeString("en-GB", {
		hour: "2-digit",
		minute: "2-digit",
	});
}

function normalizeEvents(
	account: string,
	events: GogCalendarEvent[],
): CalendarEvent[] {
	return events.map((event) => ({
		calendar:
			event.organizer?.displayName ??
			event.organizer?.email ??
			event.calendarId ??
			account,
		end: event.end?.dateTime ?? event.end?.date,
		time: formatEventTime(event.start?.dateTime ?? event.start?.date),
		title: event.summary ?? "(Untitled event)",
	}));
}

/** Fetch today's calendar events from the first available Google account. */
export function getCalendarToday(): CalendarEvent[] | { error: string } {
	const accounts = getCalendarAccounts();
	let lastError = "No calendar account configured";

	for (const account of accounts) {
		const result = spawnSync(
			"gog",
			[
				"calendar",
				"events",
				"--today",
				"--json",
				"--results-only",
				`--account=${account}`,
			],
			{
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
				timeout: 30_000,
			},
		);

		if (result.error) {
			lastError = result.error.message;
			continue;
		}

		if (result.status !== 0) {
			lastError = (result.stderr || "calendar command failed").trim();
			continue;
		}

		try {
			const parsed = JSON.parse(result.stdout) as GogCalendarEvent[];
			return normalizeEvents(account, parsed);
		} catch {
			lastError = "Failed to parse calendar output";
		}
	}

	return { error: lastError };
}
