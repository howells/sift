#!/usr/bin/env node
import { render } from "ink";

const args = process.argv.slice(2);

// Known CLI subcommands
const CLI_COMMANDS = new Set([
	"cal",
	"list",
	"ls",
	"done",
	"describe",
	"email",
	"help",
	"linear",
	"money",
	"notes",
	"star",
	"remind",
	"today",
	"open",
	"refresh",
	"status",
]);

// Determine if this is a CLI invocation:
// - First arg is a known subcommand, OR
// - --json flag is present, OR
// - Not a TTY (piped to another process)
const firstArg = args[0] ?? "";
const isCliMode =
	CLI_COMMANDS.has(firstArg) ||
	args.includes("--json") ||
	(!(process.stdout.isTTY || args.includes("--setup")) && args.length > 0);

if (args.includes("--setup") || args.includes("-s")) {
	import("./setup.tsx");
} else if (
	isCliMode ||
	(args.includes("--help") && !process.stdout.isTTY) ||
	(args.includes("-h") && !process.stdout.isTTY)
) {
	// CLI mode — structured JSON output
	const { runCli } = await import("./cli.ts");

	// If --help/-h, route to CLI help
	const cliArgs =
		args.includes("--help") || args.includes("-h") ? ["help"] : args;
	await runCli(cliArgs);
} else if (
	args.includes("--help") ||
	args.includes("-h") ||
	firstArg === "help"
) {
	// Human help — show both TUI and CLI usage
	const { runCli } = await import("./cli.ts");
	await runCli(["help"]);
	process.exit(0);
} else {
	// TUI mode — interactive terminal UI
	const { App } = await import("./app.tsx");

	process.stdout.write("\x1b[?1049h"); // Alternate screen buffer
	process.stdout.write("\x1b[?25l"); // Hide cursor
	process.stdout.write("\x1b[H"); // Cursor to top-left

	const { waitUntilExit } = render(<App />);

	waitUntilExit().then(() => {
		process.stdout.write("\x1b[?25h"); // Show cursor
		process.stdout.write("\x1b[?1049l"); // Restore screen
	});
}
