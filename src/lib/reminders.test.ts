import { describe, expect, it } from "vitest";
import type { Reminder } from "./reminders.ts";
import {
  formatDeadline,
  reminderToUrgency,
  urgencyToDue,
  urgencyToPriority,
} from "./reminders.ts";

describe("urgencyToPriority", () => {
  it("returns 'high' for overdue", () => {
    expect(urgencyToPriority("overdue")).toBe("high");
  });

  it("returns undefined for this_week", () => {
    expect(urgencyToPriority("this_week")).toBeUndefined();
  });

  it("returns undefined for when_you_can", () => {
    expect(urgencyToPriority("when_you_can")).toBeUndefined();
  });
});

describe("urgencyToDue", () => {
  it("returns undefined for null deadline", () => {
    expect(urgencyToDue("overdue", null)).toBeUndefined();
  });

  it("returns undefined for ASAP deadline", () => {
    expect(urgencyToDue("this_week", "ASAP")).toBeUndefined();
  });

  it("returns deadline string for specific dates", () => {
    expect(urgencyToDue("this_week", "Fri Jan 24")).toBe("Fri Jan 24");
  });
});

describe("formatDeadline", () => {
  it("returns null for undefined", () => {
    expect(formatDeadline(undefined)).toBeNull();
  });

  it("formats a date correctly", () => {
    // 2025-01-24 is a Friday
    const result = formatDeadline("2025-01-24");
    expect(result).toBe("Fri Jan 24");
  });

  it("handles month boundaries", () => {
    // 2025-02-01 is a Saturday
    const result = formatDeadline("2025-02-01");
    expect(result).toBe("Sat Feb 1");
  });
});

describe("reminderToUrgency", () => {
  const baseReminder: Reminder = {
    id: "test-1",
    title: "Test reminder",
    isCompleted: false,
    listName: "Work",
  };

  it("returns overdue for past due date", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const reminder = { ...baseReminder, dueDate: yesterday.toISOString() };
    expect(reminderToUrgency(reminder)).toBe("overdue");
  });

  it("returns this_week for upcoming due date", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const reminder = { ...baseReminder, dueDate: tomorrow.toISOString() };
    expect(reminderToUrgency(reminder)).toBe("this_week");
  });

  it("returns when_you_can for far future due date", () => {
    const farFuture = new Date();
    farFuture.setDate(farFuture.getDate() + 30);
    const reminder = { ...baseReminder, dueDate: farFuture.toISOString() };
    expect(reminderToUrgency(reminder)).toBe("when_you_can");
  });

  it("returns this_week for high priority without due date", () => {
    const reminder = { ...baseReminder, priority: 1 };
    expect(reminderToUrgency(reminder)).toBe("this_week");
  });

  it("returns when_you_can for no due date and no priority", () => {
    expect(reminderToUrgency(baseReminder)).toBe("when_you_can");
  });

  it("returns when_you_can for low priority without due date", () => {
    const reminder = { ...baseReminder, priority: 9 };
    expect(reminderToUrgency(reminder)).toBe("when_you_can");
  });
});
