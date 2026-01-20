import { describe, it, expect } from "vitest";
import { hashEmail } from "./cache.js";

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

  it("returns a string hash", () => {
    const hash = hashEmail(baseEmail);
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });
});
