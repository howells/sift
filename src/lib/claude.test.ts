import { describe, expect, it } from "vitest";
import { parseEmailAnalysisResult } from "./claude.ts";

describe("parseEmailAnalysisResult", () => {
	it("accepts todos with valid action types", () => {
		const result = parseEmailAnalysisResult({
			todos: [
				{
					account: "personal",
					actionType: "reply",
					date: "2026-04-07",
					deadline: null,
					emailId: "abc",
					from: "Sarah",
					fromEmail: "sarah@example.com",
					group: "personal",
					id: "abc",
					isStarred: true,
					person: "Sarah",
					reasoning: "Needs a response",
					source: "email",
					subject: "Hello",
					summary: "Reply to Sarah",
					threadId: "thread-1",
					urgency: "this_week",
				},
			],
		});

		expect(result.todos[0]?.actionType).toBe("reply");
	});
});
