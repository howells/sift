import { describe, expect, it } from "vitest";
import { relativeDeadline, relativeTime } from "./time.ts";

describe("relativeTime", () => {
  it("shows 'just now' for very recent dates", () => {
    const now = new Date();
    expect(relativeTime(now.toISOString())).toBe("just now");
  });

  it("shows minutes for < 1 hour", () => {
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60_000);
    expect(relativeTime(thirtyMinsAgo.toISOString())).toBe("30m ago");
  });

  it("shows hours for < 24 hours", () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 3_600_000);
    expect(relativeTime(fiveHoursAgo.toISOString())).toBe("5h ago");
  });

  it("shows 'yesterday' for 1 day ago", () => {
    const yesterday = new Date(Date.now() - 1 * 86_400_000);
    expect(relativeTime(yesterday.toISOString())).toBe("yesterday");
  });

  it("shows days for < 7 days", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
    expect(relativeTime(threeDaysAgo.toISOString())).toBe("3d ago");
  });

  it("shows weeks for < 30 days", () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 86_400_000);
    expect(relativeTime(twoWeeksAgo.toISOString())).toBe("2w ago");
  });

  it("shows month + day for > 30 days", () => {
    const result = relativeTime("2025-01-15T12:00:00Z");
    expect(result).toBe("Jan 15");
  });
});

describe("relativeDeadline", () => {
  it("returns 'ASAP' as-is", () => {
    expect(relativeDeadline("ASAP")).toBe("ASAP");
  });

  it("returns unparseable strings as-is", () => {
    expect(relativeDeadline("not a date")).toBe("not a date");
  });

  it("returns 'overdue' for past dates", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(relativeDeadline(yesterday.toISOString())).toBe("overdue");
  });

  it("returns 'today' for today", () => {
    const today = new Date();
    expect(relativeDeadline(today.toISOString())).toBe("today");
  });

  it("returns 'tomorrow' for tomorrow", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(relativeDeadline(tomorrow.toISOString())).toBe("tomorrow");
  });

  it("returns 'in Nd' for < 7 days", () => {
    const inThreeDays = new Date();
    inThreeDays.setDate(inThreeDays.getDate() + 3);
    expect(relativeDeadline(inThreeDays.toISOString())).toBe("in 3d");
  });

  it("returns 'in Nw' for < 30 days", () => {
    const inTwoWeeks = new Date();
    inTwoWeeks.setDate(inTwoWeeks.getDate() + 14);
    expect(relativeDeadline(inTwoWeeks.toISOString())).toBe("in 2w");
  });
});
