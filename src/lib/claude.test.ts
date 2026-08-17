import { describe, expect, it } from "vitest";
import { parseEmailAnalysisResult } from "./claude.ts";

describe(parseEmailAnalysisResult, () => {
  it("accepts verdicts with valid action types", () => {
    const result = parseEmailAnalysisResult({
      todos: [
        {
          actionType: "reply",
          deadline: null,
          emailId: "abc",
          person: "Sarah",
          reasoning: "Needs a response",
          summary: "Reply to Sarah",
          urgency: "this_week",
        },
      ],
    });

    expect(result.todos[0]?.actionType).toBe("reply");
    expect(result.todos[0]?.emailId).toBe("abc");
  });

  it("rejects a verdict carrying an unknown action type", () => {
    expect(() =>
      parseEmailAnalysisResult({
        todos: [
          {
            actionType: "teleport",
            deadline: null,
            emailId: "abc",
            person: "Sarah",
            reasoning: "n/a",
            summary: "n/a",
            urgency: "this_week",
          },
        ],
      }),
    ).toThrow(/actionType/);
  });
});
