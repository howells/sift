import { Box, Text, useStdout } from "ink";
import type { ReminderState, Todo, TodoSource } from "../lib/types.js";

function reminderIcon(state: ReminderState, source: TodoSource): string {
	if (source === "reminder") return "📌";
	switch (state) {
		case "pending":
			return "☐ ";
		case "completed":
			return "✓ ";
		default:
			return "  ";
	}
}

function reminderColor(
	state: ReminderState,
	source: TodoSource,
): string | undefined {
	if (source === "reminder") return "magenta";
	if (state === "completed") return "green";
	if (state === "pending") return "blue";
	return undefined;
}

interface TodoItemProps {
	todo: Todo;
	isSelected: boolean;
	showAccount?: boolean;
}

function truncate(str: string | undefined, maxLen: number): string {
	if (!str) return "".padEnd(maxLen);
	if (str.length <= maxLen) return str.padEnd(maxLen);
	return `${str.slice(0, maxLen - 1)}…`;
}

// Fixed column widths
const COL_PERSON = 16;
const COL_DATE = 12;
const COL_ACCOUNT = 14;

export function TodoItem({
	todo,
	isSelected,
	showAccount = true,
}: TodoItemProps) {
	const { stdout } = useStdout();
	// Subtract 2 for the paddingX={1} on the parent Box in app.tsx
	const availableWidth = (stdout?.columns || 80) - 2;

	// Calculate how much space the summary column gets
	// 2 (selector) + 2 (reminder) + 2 (star) + 1+person + 1+date + 1+account?
	const fixedWidth =
		2 +
		2 +
		2 +
		1 +
		COL_PERSON +
		1 +
		COL_DATE +
		(showAccount ? 1 + COL_ACCOUNT : 0);
	const summaryWidth = Math.max(20, availableWidth - fixedWidth);

	return (
		<Box>
			{/* Selector */}
			<Text color={isSelected ? "cyan" : undefined}>
				{isSelected ? "▸ " : "  "}
			</Text>

			{/* Reminder indicator */}
			<Text color={reminderColor(todo.reminderState, todo.source)}>
				{reminderIcon(todo.reminderState, todo.source)}
			</Text>

			{/* Summary - manually truncated */}
			<Text>{truncate(todo.summary, summaryWidth)}</Text>

			{/* Star */}
			<Text color="yellow">{todo.isStarred ? " ★" : "  "}</Text>

			{/* Person */}
			<Text dimColor={!isSelected}>
				{" "}
				{truncate(todo.person || todo.from, COL_PERSON)}
			</Text>

			{/* Date */}
			<Text dimColor={!isSelected}>
				{" "}
				{todo.deadline
					? truncate(todo.deadline, COL_DATE)
					: "-".padEnd(COL_DATE)}
			</Text>

			{/* Account */}
			{showAccount && (
				<Text dimColor> {truncate(todo.account, COL_ACCOUNT)}</Text>
			)}
		</Box>
	);
}
