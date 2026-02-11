import { afterEach, describe, expect, it } from "vitest";
import {
  cacheAnalysis,
  cacheAnalysisBatch,
  clearCache,
  getCachedAnalysis,
  getCachedTodos,
  getCacheStats,
  hashEmail,
  pruneOldEntries,
  removeCachedAnalysis,
} from "./cache.ts";
import type { Todo } from "./types.ts";

const HEX_REGEX = /^[0-9a-f]{16}$/;

describe("hashEmail", () => {
  const baseEmail = {
    subject: "Test Subject",
    from: "sender@example.com",
    date: "2025-01-20",
    snippet: "This is a test email",
    isStarred: true,
    isUnread: false,
  };

  it("returns consistent hash for same email", () => {
    const hash1 = hashEmail(baseEmail);
    const hash2 = hashEmail(baseEmail);
    expect(hash1).toBe(hash2);
  });

  it("returns a 16-char hex string", () => {
    const hash = hashEmail(baseEmail);
    expect(hash).toMatch(HEX_REGEX);
  });

  it("returns different hash when subject changes", () => {
    const hash1 = hashEmail(baseEmail);
    const hash2 = hashEmail({ ...baseEmail, subject: "Different Subject" });
    expect(hash1).not.toBe(hash2);
  });

  it("returns different hash when from changes", () => {
    const hash1 = hashEmail(baseEmail);
    const hash2 = hashEmail({ ...baseEmail, from: "other@example.com" });
    expect(hash1).not.toBe(hash2);
  });

  it("returns different hash when starred status changes", () => {
    const hash1 = hashEmail(baseEmail);
    const hash2 = hashEmail({ ...baseEmail, isStarred: false });
    expect(hash1).not.toBe(hash2);
  });

  it("returns different hash when unread status changes", () => {
    const hash1 = hashEmail(baseEmail);
    const hash2 = hashEmail({ ...baseEmail, isUnread: true });
    expect(hash1).not.toBe(hash2);
  });

  it("produces different hashes for similar emails", () => {
    const email1 = { ...baseEmail, subject: "Meeting tomorrow" };
    const email2 = { ...baseEmail, subject: "Meeting today" };
    expect(hashEmail(email1)).not.toBe(hashEmail(email2));
  });

  it("handles empty fields", () => {
    const hash = hashEmail({
      ...baseEmail,
      subject: "",
      snippet: "",
    });
    expect(hash).toMatch(HEX_REGEX);
  });
});

describe("cache CRUD", () => {
  afterEach(() => {
    clearCache();
  });

  const makeTodo = (id: string): Todo => ({
    source: "email",
    id: `todo-${id}`,
    emailId: id,
    threadId: `thread-${id}`,
    account: "test-account",
    group: "test",
    subject: "Test subject",
    from: "Test Sender",
    fromEmail: "sender@test.com",
    summary: "Test summary",
    urgency: "this_week",
    reasoning: "Test reasoning",
    date: "2025-01-20",
    isStarred: false,
    person: "Test Person",
    deadline: null,
    reminderState: "none",
  });

  it("caches and retrieves an analysis", () => {
    const todo = makeTodo("email-1");
    cacheAnalysis("email-1", "test-account", "thread-1", "hash123", true, todo);

    const cached = getCachedAnalysis("email-1", "hash123");
    expect(cached).not.toBeNull();
    expect(cached?.emailId).toBe("email-1");
    expect(cached?.isTodo).toBe(true);
    expect(cached?.todo).toEqual(todo);
  });

  it("returns null for uncached email", () => {
    expect(getCachedAnalysis("nonexistent", "hash")).toBeNull();
  });

  it("returns null when hash doesn't match", () => {
    cacheAnalysis("email-1", "test-account", null, "oldhash", false, null);

    const cached = getCachedAnalysis("email-1", "newhash");
    expect(cached).toBeNull();
  });

  it("caches non-todo emails", () => {
    cacheAnalysis("email-2", "test-account", null, "hash456", false, null);

    const cached = getCachedAnalysis("email-2", "hash456");
    expect(cached).not.toBeNull();
    expect(cached?.isTodo).toBe(false);
    expect(cached?.todo).toBeNull();
  });

  it("removes cached analysis", () => {
    cacheAnalysis(
      "email-3",
      "test-account",
      null,
      "hash789",
      true,
      makeTodo("email-3")
    );

    removeCachedAnalysis("email-3");
    expect(getCachedAnalysis("email-3", "hash789")).toBeNull();
  });

  it("clears entire cache", () => {
    cacheAnalysis("a", "acct", null, "h1", false, null);
    cacheAnalysis("b", "acct", null, "h2", false, null);

    clearCache();
    expect(getCachedAnalysis("a", "h1")).toBeNull();
    expect(getCachedAnalysis("b", "h2")).toBeNull();
  });

  it("returns correct cache stats", () => {
    cacheAnalysis("x", "acct", null, "h1", true, makeTodo("x"));
    cacheAnalysis("y", "acct", null, "h2", false, null);
    cacheAnalysis("z", "acct", null, "h3", true, makeTodo("z"));

    const stats = getCacheStats();
    expect(stats.totalCached).toBe(3);
    expect(stats.todosCount).toBe(2);
    expect(stats.oldestAnalysis).toBeTypeOf("number");
  });

  it("gets cached todos by email IDs", () => {
    const todo1 = makeTodo("e1");
    const todo2 = makeTodo("e2");
    cacheAnalysis("e1", "acct", null, "h1", true, todo1);
    cacheAnalysis("e2", "acct", null, "h2", true, todo2);
    cacheAnalysis("e3", "acct", null, "h3", false, null);

    const todos = getCachedTodos(["e1", "e2", "e3"]);
    expect(todos.size).toBe(2);
    expect(todos.get("e1")).toEqual(todo1);
    expect(todos.get("e2")).toEqual(todo2);
    expect(todos.has("e3")).toBe(false);
  });

  it("returns empty map for empty ID list", () => {
    expect(getCachedTodos([]).size).toBe(0);
  });
});

describe("cacheAnalysisBatch", () => {
  afterEach(() => {
    clearCache();
  });

  it("caches multiple results in one transaction", () => {
    cacheAnalysisBatch([
      {
        emailId: "b1",
        account: "acct",
        threadId: null,
        emailHash: "h1",
        isTodo: false,
        todo: null,
      },
      {
        emailId: "b2",
        account: "acct",
        threadId: "t2",
        emailHash: "h2",
        isTodo: true,
        todo: {
          source: "email",
          id: "todo-b2",
          emailId: "b2",
          account: "acct",
          group: "test",
          subject: "S",
          from: "F",
          fromEmail: "f@t.com",
          summary: "Sum",
          urgency: "this_week",
          reasoning: "R",
          date: "2025-01-20",
          isStarred: false,
          person: "P",
          deadline: null,
          reminderState: "none",
        },
      },
    ]);

    expect(getCachedAnalysis("b1", "h1")).not.toBeNull();
    expect(getCachedAnalysis("b2", "h2")?.isTodo).toBe(true);
  });
});

describe("pruneOldEntries", () => {
  afterEach(() => {
    clearCache();
  });

  it("removes entries older than specified days", () => {
    // Cache an entry normally (current timestamp)
    cacheAnalysis("recent", "acct", null, "h1", false, null);

    // Pruning with -1 days (cutoff in the future) should remove everything
    const removed = pruneOldEntries(-1);
    expect(removed).toBe(1);
    expect(getCachedAnalysis("recent", "h1")).toBeNull();
  });

  it("keeps recent entries", () => {
    cacheAnalysis("recent", "acct", null, "h1", false, null);

    // Pruning with 90 days should keep recent entries
    const removed = pruneOldEntries(90);
    expect(removed).toBe(0);
    expect(getCachedAnalysis("recent", "h1")).not.toBeNull();
  });
});
