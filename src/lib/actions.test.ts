import { describe, expect, it } from "vitest";
import { previewTodoAction, selectTodos } from "./actions.ts";
import type { TodoSelection, TodoView } from "./actions.ts";
import type { SiftData } from "./pipeline.ts";
import type { Todo } from "./types.ts";

function todo(overrides: Partial<Todo>): Todo {
  return {
    account: "personal",
    date: "2026-05-01",
    deadline: null,
    from: "Ada",
    fromEmail: "ada@example.com",
    group: "personal",
    id: "todo-1",
    isStarred: false,
    person: "Ada",
    reasoning: "Needs a reply",
    source: "email",
    subject: "Hello",
    summary: "Reply to Ada",
    urgency: "when_you_can",
    ...overrides,
  };
}

function data(active: Todo[], backlog: Todo[]): SiftData {
  return {
    accounts: [],
    active,
    backlog,
    clients: new Map(),
    groups: ["personal", "work"],
  };
}

describe(selectTodos, () => {
  it("filters by group and sorts active todos by urgency", () => {
    const input = data(
      [
        todo({ group: "personal", id: "later", urgency: "when_you_can" }),
        todo({ group: "work", id: "work", urgency: "overdue" }),
        todo({ group: "personal", id: "now", urgency: "overdue" }),
      ],
      [],
    );
    const selection: TodoSelection = { group: "personal", view: "active" };

    expect(selectTodos(input, selection).map((item) => item.id)).toStrictEqual(["now", "later"]);
  });

  it("sorts backlog todos by oldest date first", () => {
    const input = data(
      [],
      [todo({ date: "2026-05-10", id: "newer" }), todo({ date: "2026-04-20", id: "older" })],
    );
    const view: TodoView = "backlog";

    expect(selectTodos(input, { view }).map((item) => item.id)).toStrictEqual(["older", "newer"]);
  });
});

describe(previewTodoAction, () => {
  it("describes email completion side effects", () => {
    const preview = previewTodoAction("done", todo({ emailId: "email-1" }));

    expect(preview.wouldDo).toStrictEqual(["Unstar email", "Remove from cache"]);
  });
});
