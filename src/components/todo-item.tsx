import { Box, Text, useStdout } from "ink";
import { relativeDeadline, relativeTime } from "../lib/time.ts";
import type { ReminderState, Todo, TodoSource } from "../lib/types.ts";

function sourceIndicator(
  state: ReminderState,
  source: TodoSource
): { icon: string; color: string | undefined } {
  if (source === "reminder") {
    return { icon: "◉", color: "magenta" };
  }
  switch (state) {
    case "pending":
      return { icon: "◻", color: "blue" };
    case "completed":
      return { icon: "◼", color: "green" };
    default:
      return { icon: " ", color: undefined };
  }
}

interface TodoItemProps {
  isSelected: boolean;
  showAccount?: boolean;
  todo: Todo;
}

function truncate(str: string | undefined, maxLen: number): string {
  if (!str) {
    return "".padEnd(maxLen);
  }
  if (str.length <= maxLen) {
    return str.padEnd(maxLen);
  }
  return `${str.slice(0, maxLen - 1)}…`;
}

function timeDisplay(todo: Todo): { text: string; color: string | undefined } {
  if (todo.deadline) {
    const rel = relativeDeadline(todo.deadline);
    if (rel === "overdue" || rel === "today") {
      return { text: rel, color: "red" };
    }
    if (rel === "tomorrow") {
      return { text: rel, color: "yellow" };
    }
    if (rel === "ASAP") {
      return { text: rel, color: "red" };
    }
    return { text: rel, color: undefined };
  }
  return { text: relativeTime(todo.date), color: undefined };
}

const COL_PERSON = 14;
const COL_TIME = 10;
const COL_ACCOUNT = 12;

export function TodoItem({
  isSelected,
  showAccount = true,
  todo,
}: TodoItemProps) {
  const { stdout } = useStdout();
  const availableWidth = (stdout?.columns || 80) - 2;

  const fixedWidth =
    2 + // selector
    2 + // source indicator
    1 +
    COL_PERSON +
    1 +
    COL_TIME +
    2 + // star
    (showAccount ? 1 + COL_ACCOUNT : 0);
  const summaryWidth = Math.max(20, availableWidth - fixedWidth);

  const { icon, color: indicatorColor } = sourceIndicator(
    todo.reminderState,
    todo.source
  );
  const time = timeDisplay(todo);

  return (
    <Box>
      {/* Selector */}
      <Text color={isSelected ? "cyan" : undefined}>
        {isSelected ? "▸ " : "  "}
      </Text>

      {/* Source/reminder indicator */}
      <Text color={indicatorColor}>{icon} </Text>

      {/* Summary */}
      <Text bold={isSelected}>{truncate(todo.summary, summaryWidth)}</Text>

      {/* Star */}
      <Text color="yellow">{todo.isStarred ? " ★" : "  "}</Text>

      {/* Person */}
      <Text dimColor={!isSelected}>
        {" "}
        {truncate(todo.person || todo.from, COL_PERSON)}
      </Text>

      {/* Time */}
      <Text color={isSelected ? time.color : undefined} dimColor={!isSelected}>
        {" "}
        {truncate(time.text, COL_TIME)}
      </Text>

      {/* Account */}
      {showAccount && (
        <Text dimColor> {truncate(todo.account, COL_ACCOUNT)}</Text>
      )}
    </Box>
  );
}
