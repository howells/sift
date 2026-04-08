import { getCalendarToday } from "./calendar.ts";
import { getLinearSummary } from "./linear.ts";
import { executeLedgerMoneyCommand } from "./money.ts";
import { fetchAndAnalyze, sortByUrgency } from "./pipeline.ts";

interface TodayDependencies {
	calendar?: () => Promise<unknown> | unknown;
	linear?: () => Promise<unknown> | unknown;
	money?: () => Promise<unknown> | unknown;
}

function summarizeReminderCounts(
	todos: Array<{ source: string; urgency: string }>,
): { overdue: number; this_week: number; today: number } {
	const reminders = todos.filter((todo) => todo.source === "reminder");
	return {
		overdue: reminders.filter((todo) => todo.urgency === "overdue").length,
		this_week: reminders.filter((todo) => todo.urgency === "this_week").length,
		today: reminders.filter((todo) => todo.urgency !== "when_you_can").length,
	};
}

function summarizeMoneySection(input: unknown): unknown {
	if (typeof input !== "object" || input === null) {
		return input;
	}

	if ("error" in input) {
		return input;
	}

	const items = Array.isArray((input as { items?: unknown[] }).items)
		? ((input as { items?: Array<{ balance?: number; currency?: string }> })
				.items ?? [])
		: [];

	const liquidGbp = items
		.filter((item) => item.currency === "GBP")
		.reduce((sum, item) => sum + (item.balance ?? 0), 0);

	return {
		liquid_gbp: liquidGbp,
		items,
	};
}

async function toSection(
	loader: () => Promise<unknown> | unknown,
): Promise<unknown> {
	try {
		return await loader();
	} catch (error) {
		return {
			error: error instanceof Error ? error.message : "Unknown error",
		};
	}
}

export async function aggregateToday(
	dependencies: TodayDependencies = {},
): Promise<Record<string, unknown>> {
	const data = await fetchAndAnalyze();
	const actions = sortByUrgency(data.active).map((todo) => ({
		actionType: todo.actionType ?? "other",
		id: todo.id,
		person: todo.person,
		source: todo.source,
		summary: todo.summary,
		urgency: todo.urgency,
	}));

	const [calendar, linear, money] = await Promise.all([
		toSection(async () => dependencies.calendar?.() ?? getCalendarToday()),
		toSection(async () => dependencies.linear?.() ?? getLinearSummary()),
		toSection(async () =>
			summarizeMoneySection(
				await (dependencies.money?.() ??
					executeLedgerMoneyCommand("balance", new Map())),
			),
		),
	]);

	return {
		actions,
		calendar,
		date: new Date().toISOString().slice(0, 10),
		linear,
		money,
		reminders: summarizeReminderCounts(data.active),
	};
}
