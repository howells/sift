import { Box, Text, useStdout } from "ink";
import type { Todo } from "../lib/types.ts";
import { TodoItem } from "./todo-item.tsx";

interface TodoListProps {
  todos: Todo[];
  selectedIndex: number;
  showAccount?: boolean;
}

type ListItem =
  | {
      type: "header";
      title: string;
      icon: string;
      color: string;
      count: number;
    }
  | { type: "todo"; todo: Todo; globalIndex: number };

function buildFlatList(
  overdue: Todo[],
  thisWeek: Todo[],
  whenYouCan: Todo[]
): ListItem[] {
  const flatList: ListItem[] = [];
  let globalIndex = 0;

  const addSection = (
    title: string,
    icon: string,
    items: Todo[],
    color: string
  ) => {
    if (items.length === 0) {
      return;
    }
    flatList.push({ type: "header", title, icon, color, count: items.length });
    for (const todo of items) {
      flatList.push({ type: "todo", todo, globalIndex });
      globalIndex++;
    }
  };

  addSection("OVERDUE", "🔴", overdue, "red");
  addSection("THIS WEEK", "🟡", thisWeek, "yellow");
  addSection("WHEN YOU CAN", "🔵", whenYouCan, "cyan");

  return flatList;
}

function findFlatListWindow(
  flatList: ListItem[],
  windowStart: number,
  windowEnd: number
): { flatStart: number; flatEnd: number } {
  let todoCount = 0;
  let flatStart = 0;
  let flatEnd = flatList.length;

  // Find flat index where windowStart todo begins
  for (let i = 0; i < flatList.length; i++) {
    const item = flatList[i];
    if (item.type === "todo") {
      if (todoCount === windowStart) {
        flatStart = i > 0 && flatList[i - 1].type === "header" ? i - 1 : i;
        break;
      }
      todoCount++;
    }
  }

  // Find flat index where windowEnd todo ends
  todoCount = 0;
  for (let i = 0; i < flatList.length; i++) {
    const item = flatList[i];
    if (item.type === "todo") {
      if (todoCount === windowEnd - 1) {
        flatEnd = i + 1;
        break;
      }
      todoCount++;
    }
  }

  return { flatStart, flatEnd };
}

export function TodoList({
  todos,
  selectedIndex,
  showAccount = true,
}: TodoListProps) {
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;

  // Reserve space for header (2 lines) + status bar (2 lines) + padding
  const VISIBLE_ITEMS = Math.max(5, terminalHeight - 8);

  // Calculate window to show - keep selected item near the middle
  const halfWindow = Math.floor(VISIBLE_ITEMS / 2);
  let windowStart = Math.max(0, selectedIndex - halfWindow);
  let windowEnd = windowStart + VISIBLE_ITEMS;

  // Adjust if we're near the end
  if (windowEnd > todos.length) {
    windowEnd = todos.length;
    windowStart = Math.max(0, windowEnd - VISIBLE_ITEMS);
  }

  const overdue = todos.filter((t) => t.urgency === "overdue");
  const thisWeek = todos.filter((t) => t.urgency === "this_week");
  const whenYouCan = todos.filter((t) => t.urgency === "when_you_can");

  const flatList = buildFlatList(overdue, thisWeek, whenYouCan);

  const { flatStart, flatEnd } = findFlatListWindow(
    flatList,
    windowStart,
    windowEnd
  );

  const visibleItems = flatList.slice(flatStart, flatEnd);

  if (todos.length === 0) {
    return (
      <Box alignItems="center" flexDirection="column" paddingY={2}>
        <Text color="green">✓ All caught up!</Text>
        <Text dimColor>No emails need your attention right now.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {windowStart > 0 && <Text dimColor> ↑ {windowStart} more above</Text>}
      {visibleItems.map((item, i) => {
        if (item.type === "header") {
          return (
            <Box key={`header-${item.title}`} marginTop={i > 0 ? 1 : 0}>
              <Text>{"  "}</Text>
              <Text bold color={item.color}>
                {item.icon} {item.title} ({item.count})
              </Text>
            </Box>
          );
        }
        return (
          <TodoItem
            isSelected={item.globalIndex === selectedIndex}
            key={item.todo.id}
            showAccount={showAccount}
            todo={item.todo}
          />
        );
      })}
      {windowEnd < todos.length && (
        <Text dimColor> ↓ {todos.length - windowEnd} more below</Text>
      )}
    </Box>
  );
}
