import { describe, expect, it, vi } from "vitest";
import { fetchAndAnalyze } from "./pipeline.ts";
import { aggregateToday } from "./today.ts";

vi.mock("./pipeline.ts", async () => {
	const actual =
		await vi.importActual<typeof import("./pipeline.ts")>("./pipeline.ts");
	return {
		...actual,
		fetchAndAnalyze: vi.fn(),
	};
});

describe("aggregateToday", () => {
	it("preserves successful sections when one domain fails", async () => {
		vi.mocked(fetchAndAnalyze).mockResolvedValue({
			accounts: [],
			active: [
				{
					account: "personal",
					actionType: "review",
					date: "2026-04-07",
					from: "A",
					fromEmail: "a@example.com",
					group: "personal",
					id: "1",
					person: "A",
					reminderState: "none",
					source: "email",
					subject: "Test",
					summary: "Review PR",
					urgency: "this_week",
				},
			] as never,
			backlog: [],
			clients: new Map(),
			groups: [],
		});

		const result = await aggregateToday({
			calendar: async () => [{ title: "Call", time: "10:00" }],
			money: () => {
				throw new Error("ledger not available");
			},
		});

		expect(result.calendar).toHaveLength(1);
		expect(result.money).toEqual({ error: "ledger not available" });
	});
});
