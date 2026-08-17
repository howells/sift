import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { Key } from "ink";
import { Header } from "./components/header.tsx";
import { Spinner } from "./components/spinner.tsx";
import { StatusBar } from "./components/status-bar.tsx";
import { TodoList } from "./components/todo-list.tsx";
import { useSiftData } from "./hooks/use-sift-data.ts";

function handleKey(
  input: string,
  key: Key,
  sift: ReturnType<typeof useSiftData>,
  exit: () => void,
) {
  if (sift.loading.active) {
    return;
  }

  if (key.upArrow || input === "k") {
    sift.moveUp();
    return;
  }
  if (key.downArrow || input === "j") {
    sift.moveDown();
    return;
  }
  if (input === "b") {
    sift.toggleBacklog();
    return;
  }
  if (key.escape) {
    sift.dismissBacklog();
    return;
  }

  const num = Number.parseInt(input, 10);
  if (num >= 1 && num <= sift.accountGroups.length) {
    sift.toggleGroup(num);
    return;
  }

  if (key.return) {
    sift.openTodo();
    return;
  }
  if (input === "d") {
    sift.markDone();
    return;
  }
  if (input === "s") {
    sift.starTodo();
    return;
  }
  if (input === "r") {
    sift.refresh();
    return;
  }
  if (input === "q") {
    exit();
  }
}

export function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const terminalHeight = (stdout?.rows || 24) - 1;

  const sift = useSiftData();

  useInput((input, key) => {
    handleKey(input, key, sift, exit);
  });

  if (sift.error) {
    return (
      <Box flexDirection="column" height={terminalHeight} padding={1}>
        <Text color="red">Error: {sift.error}</Text>
        <Text dimColor>Press q to quit</Text>
      </Box>
    );
  }

  if (sift.loading.active) {
    return (
      <Box flexDirection="column" height={terminalHeight} padding={1}>
        <Header groups={sift.accountGroups} selectedGroup={sift.selectedGroup} />
        <Box paddingY={1}>
          <Spinner
            detail={sift.loading.detail}
            message={sift.loading.message}
            step={sift.loading.step}
            totalSteps={3}
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={terminalHeight}>
      <Box paddingX={1}>
        <Header
          backlogCount={sift.backlogCount}
          groups={sift.accountGroups}
          isBacklogView={sift.view === "backlog"}
          selectedGroup={sift.selectedGroup}
          totalItems={sift.currentList.length}
        />
      </Box>

      <Box flexDirection="column" flexGrow={1} overflow="hidden" paddingX={1}>
        <TodoList
          selectedIndex={sift.selectedIndex}
          showAccount={sift.selectedGroup === null}
          todos={sift.currentList}
        />
      </Box>

      <Box paddingX={1}>
        <StatusBar
          bindings={
            sift.view === "backlog"
              ? [
                  { key: "j/k", label: "nav" },
                  { key: "⏎", label: "open" },
                  { key: "d", label: "done" },
                  { key: "s", label: "star" },
                  { key: "esc", label: "back" },
                  { key: "q", label: "quit" },
                ]
              : [
                  { key: "j/k", label: "nav" },
                  { key: "⏎", label: "open" },
                  { key: "d", label: "done" },
                  { key: "s", label: "star" },
                  { key: "r", label: "refresh" },
                  { key: "q", label: "quit" },
                ]
          }
        />
      </Box>
    </Box>
  );
}
