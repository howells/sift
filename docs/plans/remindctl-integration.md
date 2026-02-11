# Ideation: Sift → Apple Reminders Integration

## Context

**Sift** is a terminal UI app that surfaces actionable emails from Gmail accounts. It uses Claude to analyze emails and present them as a prioritized todo list with urgency levels (overdue, this_week, when_you_can).

**remindctl** is a CLI tool for managing Apple Reminders, already installed and working.

**Goal**: Add the ability to create Apple Reminders directly from emails in Sift, so tasks extracted from emails flow into the native Apple Reminders ecosystem (synced across devices, Siri accessible, etc.).

---

## Current Sift Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Sift TUI (Ink/React)                                   │
│  ┌─────────────────────────────────────────────────────┐│
│  │  TodoList Component                                 ││
│  │  - Shows emails as Todo items                       ││
│  │  - Keyboard: d=done, s=star, Enter=open, q=quit     ││
│  └─────────────────────────────────────────────────────┘│
│                                                         │
│  Todo Interface:                                        │
│  - id, emailId, threadId, account, group                │
│  - subject, from, fromEmail, summary                    │
│  - urgency, reasoning, date, isStarred                  │
│  - person, deadline                                     │
└─────────────────────────────────────────────────────────┘
```

---

## Approaches

### Approach A: New Keybinding (t = "to-do")

Add a single keybinding that creates a reminder from the selected email.

**Flow:**
```
User presses 't' on a todo item
  → Sift calls: remindctl add "<summary>" --list Work --notes "<email context>"
  → Show brief confirmation in status bar
  → Optionally mark as done in Sift (unstar email)
```

**Pros:**
- Minimal UI change (one new keybinding)
- Fast single-action workflow
- Uses existing Todo data (summary, deadline, person)

**Cons:**
- No choice of list without extra UI
- No due date mapping without heuristics

---

### Approach B: Quick Menu (t → submenu)

Pressing 't' opens a mini-menu for options before creating the reminder.

**Flow:**
```
User presses 't'
  → Overlay appears with options:
    [1] Work (default)
    [2] Personal
    [3] Shopping
    [Enter] Confirm with defaults
    [Esc] Cancel
  → Creates reminder with selected list
```

**Pros:**
- User can choose destination list
- Still keyboard-driven
- Could add due date presets

**Cons:**
- More complex UI
- Slower than single keypress

---

### Approach C: Inline Command Mode

Add a command input (like vim's `:`) for more control.

**Flow:**
```
User presses ':'
  → Command input appears at bottom
  → User types: "todo Work" or "todo Personal friday"
  → Parses command and creates reminder
```

**Pros:**
- Maximum flexibility
- Extensible for future commands
- Familiar to vim users

**Cons:**
- Steeper learning curve
- More typing than needed for common case

---

## Recommendation: Approach A with Smart Defaults

Start simple with a single keybinding, using smart defaults:

1. **Title**: Use `todo.summary` (Claude's extracted action item)
2. **List**: Default to "Work" (configurable in sift config)
3. **Due date**: Map from `todo.urgency`:
   - `overdue` → today
   - `this_week` → end of week (Friday)
   - `when_you_can` → no due date
4. **Notes**: Include email context (from, subject, link)
5. **Post-action**: Optionally mark email as done

### Keybinding Choice

| Key | Meaning | Conflict? |
|-----|---------|-----------|
| `t` | "to-do" / "task" | None |
| `a` | "add" | None |
| `+` | "add" | None |
| `r` | Already used for refresh | Yes |

**Recommendation**: `t` for "to-do"

---

## Implementation Sketch

### 1. Add remindctl wrapper

```typescript
// src/lib/reminders.ts
import { execSync } from "child_process";

interface ReminderOptions {
  title: string;
  list?: string;
  due?: string;
  notes?: string;
  priority?: "none" | "low" | "medium" | "high";
}

export function addReminder(options: ReminderOptions): boolean {
  const args = [`add`, `"${options.title}"`];

  if (options.list) args.push(`--list`, `"${options.list}"`);
  if (options.due) args.push(`--due`, options.due);
  if (options.notes) args.push(`--notes`, `"${options.notes}"`);
  if (options.priority) args.push(`--priority`, options.priority);

  try {
    execSync(`remindctl ${args.join(" ")}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
```

### 2. Map urgency to due date

```typescript
function urgencyToDue(urgency: Urgency): string | undefined {
  switch (urgency) {
    case "overdue": return "today";
    case "this_week": return "friday";
    case "when_you_can": return undefined;
  }
}
```

### 3. Add keybinding in app.tsx

```typescript
// In useInput handler
if (input === "t" && currentList[selectedIndex]) {
  const todo = currentList[selectedIndex];
  const success = addReminder({
    title: todo.summary,
    list: "Work", // or from config
    due: urgencyToDue(todo.urgency),
    notes: `From: ${todo.from}\nSubject: ${todo.subject}\nEmail: ${todo.fromEmail}`,
    priority: todo.urgency === "overdue" ? "high" : undefined,
  });

  if (success) {
    // Show confirmation, optionally mark done
  }
}
```

### 4. Update StatusBar

Add `{ key: "t", label: "Remind" }` to bindings.

---

## Future Enhancements

1. **Config option**: Default reminder list per account group
2. **Confirmation toast**: Brief "Added to Work ✓" message
3. **Batch action**: Select multiple emails, add all as reminders
4. **Two-way sync**: Mark reminder complete → mark email done (complex)

---

## Duplicate Prevention (Apple Reminders as Source of Truth)

Instead of tracking in a local SQLite table (which could drift out of sync), we store the email ID in the reminder's **notes field** and query Apple Reminders directly.

### Notes Format

```
sift:email:<emailId>
---
From: John Smith <john@example.com>
Subject: Contract renewal discussion
```

The `sift:email:<id>` prefix on the first line allows us to find reminders by email ID.

### Flow with Duplicate Check

```
User presses 't' on a todo
  → Query: remindctl list Work --json
  → Parse JSON, search for note starting with "sift:email:<emailId>"
  → If found:
      Show "Already in Work" (no action)
  → If not found:
      Create reminder with notes containing email ID
      Show "Added to Work ✓"
```

### Why This Works

- **Single source of truth**: Apple Reminders, not a local DB
- **Survives sync**: If user completes/deletes reminder on iPhone, Sift sees the change
- **No drift**: No local state to get out of sync
- **Portable**: Works if user reinstalls Sift or clears cache

### Visual Indicator (Checkbox Style)

Three states for each todo item:

```
     [this week]  Send invoice to Bergmeyer      ← no reminder
  ☐  [this week]  Review Phase design            ← reminder created, not done
  ✓  [overdue]    Reply to Craig about contract  ← reminder completed
```

**User flow:**
1. Email appears in Sift (no indicator)
2. Press `t` → creates reminder → shows `☐`
3. User completes reminder on iPhone/Mac
4. Sift refresh → shows `✓` (reminder done)
5. Press `d` → marks email done, removes from Sift

This bridges the two systems: Sift surfaces emails, Reminders tracks the task, user closes the loop in Sift.

**Bidirectional sync:**
- Press `t` in Sift → creates reminder in Apple Reminders
- Complete reminder on iPhone → Sift shows `✓` on refresh
- Press `d` in Sift → completes reminder in Apple Reminders (if exists)

---

## Refined Implementation

### 1. New file: src/lib/reminders.ts

```typescript
import { execSync } from "child_process";
import type { Todo, Urgency } from "./types.js";

const SIFT_PREFIX = "sift:email:";

interface Reminder {
  id: string;
  title: string;
  notes?: string;
  isCompleted: boolean;
  listName: string;
}

export type ReminderState = "none" | "pending" | "completed";

interface ReminderInfo {
  emailId: string;
  isCompleted: boolean;
}

/**
 * Get all reminders from a list and extract email IDs + completion state.
 * Returns a Map of emailId → ReminderState.
 */
export function getEmailReminderStates(list = "Work"): Map<string, ReminderState> {
  try {
    const output = execSync(`remindctl list "${list}" --json`, {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    });

    const reminders: Reminder[] = JSON.parse(output);
    const states = new Map<string, ReminderState>();

    for (const reminder of reminders) {
      if (reminder.notes?.startsWith(SIFT_PREFIX)) {
        const firstLine = reminder.notes.split("\n")[0];
        const emailId = firstLine.replace(SIFT_PREFIX, "");
        if (emailId) {
          states.set(emailId, reminder.isCompleted ? "completed" : "pending");
        }
      }
    }

    return states;
  } catch {
    return new Map();
  }
}

/**
 * Check if a specific email already has a reminder.
 */
export function hasReminder(emailId: string, list = "Work"): boolean {
  const states = getEmailReminderStates(list);
  return states.has(emailId);
}

/**
 * Find reminder ID by email ID (for completing reminders).
 */
export function findReminderIdByEmail(emailId: string, list = "Work"): string | null {
  try {
    const output = execSync(`remindctl list "${list}" --json`, {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    });

    const reminders: Reminder[] = JSON.parse(output);

    for (const reminder of reminders) {
      if (reminder.notes?.startsWith(SIFT_PREFIX)) {
        const firstLine = reminder.notes.split("\n")[0];
        const id = firstLine.replace(SIFT_PREFIX, "");
        if (id === emailId) {
          return reminder.id;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Complete a reminder by email ID.
 */
export function completeReminderByEmail(emailId: string, list = "Work"): boolean {
  const reminderId = findReminderIdByEmail(emailId, list);
  if (!reminderId) return false;

  try {
    execSync(`remindctl complete "${reminderId}"`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function urgencyToDue(urgency: Urgency): string | undefined {
  switch (urgency) {
    case "overdue": return "today";
    case "this_week": return "friday";
    case "when_you_can": return undefined;
  }
}

function urgencyToPriority(urgency: Urgency): string | undefined {
  return urgency === "overdue" ? "high" : undefined;
}

interface CreateReminderResult {
  success: boolean;
  alreadyExists: boolean;
  list?: string;
  error?: string;
}

export function createReminderFromTodo(todo: Todo, list = "Work"): CreateReminderResult {
  // Check for duplicate by querying Apple Reminders
  if (hasReminder(todo.emailId, list)) {
    return { success: false, alreadyExists: true, list };
  }

  const due = urgencyToDue(todo.urgency);
  const priority = urgencyToPriority(todo.urgency);

  // Notes with email ID on first line for reconciliation
  const notes = [
    `${SIFT_PREFIX}${todo.emailId}`,
    "---",
    `From: ${todo.from} <${todo.fromEmail}>`,
    `Subject: ${todo.subject}`,
  ].join("\n");

  // Build command
  const args = ["add", JSON.stringify(todo.summary), "--list", JSON.stringify(list)];
  if (due) args.push("--due", due);
  if (priority) args.push("--priority", priority);
  args.push("--notes", JSON.stringify(notes));

  try {
    execSync(`remindctl ${args.join(" ")}`, { stdio: "pipe" });
    return { success: true, alreadyExists: false, list };
  } catch (err) {
    return {
      success: false,
      alreadyExists: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
```

### 2. Update Todo type

```typescript
// Add to types.ts
export type ReminderState = "none" | "pending" | "completed";

export interface Todo {
  // ... existing fields
  reminderState: ReminderState;  // Populated by checking Apple Reminders
}
```

### 3. Hydrate reminderState on load (in app.tsx init)

```typescript
import { getEmailReminderStates } from "./lib/reminders.js";

// In init(), after analyzing emails:
const reminderStates = getEmailReminderStates("Work");
const activeWithReminders = active.map((t) => ({
  ...t,
  reminderState: reminderStates.get(t.emailId) ?? "none",
}));
setTodos(activeWithReminders);
```

### 4. Add keybinding in app.tsx

```typescript
import { createReminderFromTodo } from "./lib/reminders.js";

// In useInput handler
if (input === "t" && currentList[selectedIndex]) {
  const todo = currentList[selectedIndex];

  // Already has reminder (pending or completed) - no action
  if (todo.reminderState !== "none") {
    return;
  }

  const result = createReminderFromTodo(todo, "Work");

  if (result.success) {
    // Update local state to show ☐ indicator
    const updateTodo = (t: Todo) =>
      t.id === todo.id ? { ...t, reminderState: "pending" as const } : t;

    if (view === "backlog") {
      setBacklog((prev) => prev.map(updateTodo));
    } else {
      setTodos((prev) => prev.map(updateTodo));
    }
  }
}
```

### 5. Update TodoList component

```typescript
// In TodoList row rendering
function getReminderIndicator(state: ReminderState): string {
  switch (state) {
    case "none": return "   ";      // 3 spaces for alignment
    case "pending": return " ☐ ";   // unchecked box
    case "completed": return " ✓ "; // checkmark
  }
}

// Render:
<Text>
  {getReminderIndicator(todo.reminderState)}
  <Text color={urgencyColor}>[{todo.urgency}]</Text>
  {" "}{todo.summary}
</Text>
```

### 6. Update 'd' (done) handler to sync reminders

```typescript
// In existing 'd' handler, add reminder completion
if (input === "d" && currentList[selectedIndex]) {
  const todo = currentList[selectedIndex];
  const client = gmailClients.get(todo.account);

  if (client) {
    // Complete associated reminder if it exists
    if (todo.reminderState !== "none") {
      completeReminderByEmail(todo.emailId, "Work");
    }

    // Existing logic: unstar + mark read
    Promise.all([
      client.unstar(todo.emailId),
      client.markRead(todo.emailId),
    ]).then(() => {
      // ... existing removal logic
    });
  }
}
```

### 7. Update StatusBar

```typescript
// Dynamic binding based on current item's reminder state
const todo = currentList[selectedIndex];
const reminderBinding = todo?.reminderState === "none"
  ? { key: "t", label: "Remind" }
  : todo?.reminderState === "pending"
  ? { key: "t", label: "Reminded", dimmed: true }
  : { key: "t", label: "Done ✓", dimmed: true };
```

---

## Decision Log

| Question | Decision | Rationale |
|----------|----------|-----------|
| Approach | A (single key) | Fast, simple, user preference |
| Keybinding | `t` | Intuitive, no conflicts |
| Duplicate handling | Notes field + query | Apple Reminders as source of truth, no sync drift |
| Default list | "Work" | Matches migrated tasks |
| Visual indicator | ☐/✓ checkbox | Shows state: none → pending → completed |
| Post-action | Keep in Sift | Reminder ≠ done, but 'd' syncs both |
| Bidirectional sync | Yes | 'd' in Sift completes reminder too |

---

## Performance Consideration

Querying `remindctl list Work --json` on every keypress could be slow. Options:

1. **Cache on startup** - Query once when loading, store Set of email IDs in state
2. **Lazy refresh** - Re-query after creating a reminder, or on 'r' refresh
3. **Background refresh** - Periodically re-sync (overkill for this use case)

**Recommendation**: Cache on startup (#1), refresh after 't' action.

---

## Open Questions

1. **Toast/notification UI** - How to show "Added to Work ✓" briefly?
   - Temporary status bar message
   - Inline flash on the item

2. **List selection** - Hard-code "Work" for now, or configurable?
