#!/usr/bin/env node
import { render } from "ink";

const args = process.argv.slice(2);

if (args.includes("--setup") || args.includes("-s")) {
	// Run setup wizard
	import("./setup.js");
} else if (args.includes("--help") || args.includes("-h")) {
	console.log(`
sift - AI-powered email triage

Usage:
  sift            Start the email triage interface
  sift --setup    Configure accounts and credentials
  sift --help     Show this help message

Keyboard shortcuts (in app):
  ↑/↓ or j/k     Navigate
  Enter          Open email in browser
  d              Mark done (unstar + mark read)
  1-N            Filter by group
  r              Refresh
  q              Quit
`);
	process.exit(0);
} else {
	// Run main app
	const { App } = await import("./app.js");

	// Enter alternate screen buffer (like vim/less) - prevents scrollback pollution
	process.stdout.write("\x1b[?1049h");
	// Hide cursor
	process.stdout.write("\x1b[?25l");
	// Move cursor to top-left
	process.stdout.write("\x1b[H");

	const { waitUntilExit } = render(<App />);

	waitUntilExit().then(() => {
		// Show cursor
		process.stdout.write("\x1b[?25h");
		// Exit alternate screen buffer - restores previous terminal content
		process.stdout.write("\x1b[?1049l");
	});
}
