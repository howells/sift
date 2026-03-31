import { Box, Text, useStdout } from "ink";
import type { Todo } from "../lib/types.ts";
import { TodoItem } from "./todo-item.tsx";

interface TodoListProps {
  selectedIndex: number;
  showAccount?: boolean;
  todos: Todo[];
}

type ListItem =
  | {
      color: string;
      count: number;
      icon: string;
      title: string;
      type: "header";
    }
  | { globalIndex: number; todo: Todo; type: "todo" };

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

  addSection("Overdue", "●", overdue, "red");
  addSection("This week", "●", thisWeek, "yellow");
  addSection("When you can", "●", whenYouCan, "cyan");

  return flatList;
}

function findFlatListWindow(
  flatList: ListItem[],
  windowStart: number,
  windowEnd: number
): { flatEnd: number; flatStart: number } {
  let todoCount = 0;
  let flatStart = 0;
  let flatEnd = flatList.length;

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
  selectedIndex,
  showAccount = true,
  todos,
}: TodoListProps) {
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  const VISIBLE_ITEMS = Math.max(5, terminalHeight - 8);

  const halfWindow = Math.floor(VISIBLE_ITEMS / 2);
  let windowStart = Math.max(0, selectedIndex - halfWindow);
  let windowEnd = windowStart + VISIBLE_ITEMS;

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
        <Text color="green">✓ All clear</Text>
        <Text dimColor>Nothing needs your attention right now.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {windowStart > 0 && <Text dimColor> ↑ {windowStart} more</Text>}
      {visibleItems.map((item, i) => {
        if (item.type === "header") {
          return (
            <Box key={`header-${item.title}`} marginTop={i > 0 ? 1 : 0}>
              <Text> </Text>
              <Text color={item.color}>{item.icon}</Text>
              <Text bold dimColor>
                {" "}
                {item.title}
              </Text>
              <Text dimColor> ({item.count})</Text>
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
        <Text dimColor> ↓ {todos.length - windowEnd} more</Text>
      )}
    </Box>
  );
}
