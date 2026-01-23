import { Box, Text } from "ink";
import type { ReminderState, Todo } from "../lib/types.js";

function getReminderIndicator(state: ReminderState): string {
	switch (state) {
		case "none":
			return "  "; // 2 spaces for alignment
		case "pending":
			return "☐ "; // unchecked box
		case "completed":
			return "✓ "; // checkmark
	}
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

export function TodoItem({
	todo,
	isSelected,
	showAccount = true,
}: TodoItemProps) {
	return (
		<Box>
			{/* Selector */}
			<Text color={isSelected ? "cyan" : undefined}>
				{isSelected ? "▸ " : "  "}
			</Text>

			{/* Reminder indicator */}
			<Text
				color={
					todo.reminderState === "completed"
						? "green"
						: todo.reminderState === "pending"
							? "blue"
							: undefined
				}
			>
				{getReminderIndicator(todo.reminderState)}
			</Text>

			{/* Summary - flex width */}
			<Box flexGrow={1} flexShrink={1}>
				<Text wrap="truncate">
					{todo.summary}
					{todo.isStarred && <Text color="yellow"> ★</Text>}
				</Text>
			</Box>

			{/* Person - 14 chars */}
			<Box width={14} marginLeft={1}>
				<Text dimColor={!isSelected}>{truncate(todo.person || "", 14)}</Text>
			</Box>

			{/* Deadline - 12 chars */}
			<Box width={12} marginLeft={1}>
				<Text dimColor={!isSelected}>
					{todo.deadline ? truncate(todo.deadline, 12) : "—".padEnd(12)}
				</Text>
			</Box>

			{/* Account - 14 chars */}
			{showAccount && (
				<Box width={14} marginLeft={1}>
					<Text dimColor>{truncate(todo.account, 14)}</Text>
				</Box>
			)}
		</Box>
	);
}
