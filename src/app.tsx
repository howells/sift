import { Box, Text, useApp, useInput, useStdout } from "ink";
import { Header } from "./components/Header.js";
import { Spinner } from "./components/Spinner.js";
import { StatusBar } from "./components/StatusBar.js";
import { TodoList } from "./components/TodoList.js";
import { useSiftData } from "./hooks/useSiftData.js";

export function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const terminalHeight = (stdout?.rows || 24) - 1;

  const sift = useSiftData();

  useInput((input, key) => {
    if (sift.loading.active) {
      return;
    }

    if (key.upArrow || input === "k") {
      sift.moveUp();
    }
    if (key.downArrow || input === "j") {
      sift.moveDown();
    }
    if (input === "b") {
      sift.toggleBacklog();
    }
    if (key.escape) {
      sift.dismissBacklog();
    }

    const num = Number.parseInt(input, 10);
    if (num >= 1 && num <= sift.accountGroups.length) {
      sift.toggleGroup(num);
    }

    if (key.return) {
      sift.openTodo();
    }
    if (input === "d") {
      sift.markDone();
    }
    if (input === "s") {
      sift.starTodo();
    }
    if (input === "t") {
      sift.createReminder();
    }
    if (input === "r") {
      sift.refresh();
    }
    if (input === "q") {
      exit();
    }
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
        <Header
          groups={sift.accountGroups}
          selectedGroup={sift.selectedGroup}
        />
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
                  { key: "↑↓", label: "Nav" },
                  { key: "Enter", label: "Open" },
                  { key: "d", label: "Done" },
                  { key: "s", label: "Star" },
                  { key: "t", label: "Remind" },
                  { key: "b/Esc", label: "Back" },
                  { key: "q", label: "Quit" },
                ]
              : [
                  { key: "↑↓", label: "Nav" },
                  { key: "Enter", label: "Open" },
                  { key: "d", label: "Done" },
                  { key: "s", label: "Star" },
                  { key: "t", label: "Remind" },
                  { key: "b", label: `Backlog (${sift.backlogCount})` },
                  { key: "r", label: "Refresh" },
                  { key: "q", label: "Quit" },
                ]
          }
          extraInfo={`${sift.currentList.length} items`}
        />
      </Box>
    </Box>
  );
}
