import { Box, Text, useStdout } from "ink";
import { relativeDeadline, relativeTime } from "../lib/time.ts";
import type { Todo } from "../lib/types.ts";

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
      return { color: "red", text: rel };
    }
    if (rel === "tomorrow") {
      return { color: "yellow", text: rel };
    }
    if (rel === "ASAP") {
      return { color: "red", text: rel };
    }
    return { color: undefined, text: rel };
  }
  return { color: undefined, text: relativeTime(todo.date) };
}

const COL_PERSON = 14;
const COL_TIME = 10;
const COL_ACCOUNT = 12;

export function TodoItem({ isSelected, showAccount = true, todo }: TodoItemProps) {
  const { stdout } = useStdout();
  const availableWidth = (stdout?.columns || 80) - 2;

  const fixedWidth =
    2 + // selector
    1 +
    COL_PERSON +
    1 +
    COL_TIME +
    2 + // star
    (showAccount ? 1 + COL_ACCOUNT : 0);
  const summaryWidth = Math.max(20, availableWidth - fixedWidth);

  const time = timeDisplay(todo);

  return (
    <Box>
      {/* Selector */}
      <Text color={isSelected ? "cyan" : undefined}>{isSelected ? "▸ " : "  "}</Text>

      {/* Summary */}
      <Text bold={isSelected}>{truncate(todo.summary, summaryWidth)}</Text>

      {/* Star */}
      <Text color="yellow">{todo.isStarred ? " ★" : "  "}</Text>

      {/* Person */}
      <Text dimColor={!isSelected}> {truncate(todo.person || todo.from, COL_PERSON)}</Text>

      {/* Time */}
      <Text color={isSelected ? time.color : undefined} dimColor={!isSelected}>
        {" "}
        {truncate(time.text, COL_TIME)}
      </Text>

      {/* Account */}
      {showAccount && <Text dimColor> {truncate(todo.account, COL_ACCOUNT)}</Text>}
    </Box>
  );
}
