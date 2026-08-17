#!/usr/bin/env node
import { render } from "ink";

const args = process.argv.slice(2);

// Known CLI subcommands. Anything matching here always routes to the
// structured JSON CLI surface, regardless of TTY state.
const CLI_COMMANDS = new Set([
  "cal",
  "describe",
  "done",
  "email",
  "help",
  "linear",
  "list",
  "ls",
  "money",
  "open",
  "places",
  "refresh",
  "remind",
  "star",
  "status",
  "today",
]);

const firstArg = args[0] ?? "";
const wantsHelp = args.includes("--help") || args.includes("-h");
const wantsAgent = args.includes("--agent") || args.includes("--json");

if (args.includes("--setup") || args.includes("-s")) {
  // Interactive setup wizard.
  await import("./setup.tsx");
} else if (firstArg === "mcp") {
  // MCP stdio server — long-running, talks JSON-RPC on stdio.
  const { startMcpServer } = await import("./mcp.ts");
  await startMcpServer();
} else if (CLI_COMMANDS.has(firstArg) || wantsAgent || wantsHelp || !process.stdout.isTTY) {
  // CLI / agent mode — structured JSON output.
  const { runCli } = await import("./cli.ts");
  const cliArgs = wantsHelp ? ["help"] : args.filter((arg) => arg !== "--agent");
  await runCli(cliArgs);
} else {
  // TUI mode — interactive Ink app.
  const { App } = await import("./app.tsx");

  process.stdout.write("\u001B[?1049h"); // Alternate screen buffer
  process.stdout.write("\u001B[?25l"); // Hide cursor
  process.stdout.write("\u001B[H"); // Cursor to top-left

  const { waitUntilExit } = render(<App />);

  void waitUntilExit().then(() => {
    process.stdout.write("\u001B[?25h"); // Show cursor
    process.stdout.write("\u001B[?1049l"); // Restore screen
  });
}
