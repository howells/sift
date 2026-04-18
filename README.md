# sift

AI-powered email triage for the terminal.

Pulls starred and unread emails from multiple Gmail accounts, analyzes urgency with Claude, and presents a prioritized action list. Supports Apple Reminders, Things, Linear, calendar, and financial data -- all in one daily briefing.

## Features

- **Multi-account Gmail** -- fetches starred and unread emails across accounts
- **AI analysis** -- Claude classifies urgency, extracts deadlines, and summarizes action items
- **SQLite cache** -- avoids re-analyzing unchanged emails
- **Reminder integration** -- creates Apple Reminders or Things todos from email actions
- **Daily briefing** -- aggregates email, calendar, Linear issues, and balances into one view
- **Agent-friendly CLI** -- structured JSON output with field masks, pagination, and NDJSON streaming
- **Interactive TUI** -- Ink-based terminal UI for browsing and acting on todos

## Install

```bash
pnpm install
pnpm build
```

The `sift` binary is available after build via the `bin` field in package.json, or run directly with:

```bash
pnpm dev
```

## Setup

```bash
sift --setup
```

This creates `~/.config/sift/config.json` with your Gmail accounts, groups, and API key.

### Requirements

- [gog](https://github.com/howells/gog) -- Gmail and Google Calendar access
- An Anthropic API key, or the [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) installed
- Node.js >= 18

### Optional

- [remindctl](https://github.com/howells/remindctl) -- Apple Reminders integration
- [Things 3](https://culturedcode.com/things/) -- alternative task backend
- [goplaces](https://github.com/howells/goplaces) -- Google Places search
- A Linear API key for issue tracking

## Usage

### Interactive TUI

```bash
sift
```

### CLI commands

```bash
# List prioritized todos
sift list
sift list --fields=id,summary,urgency --limit=10
sift list --group=personal --format=ndjson

# Act on items
sift done <id>
sift star <id>
sift remind <id>
sift open <id>

# Apple Reminders
sift remind list --due=today
sift remind add "Follow up with Jane" --list=Work --due=2026-05-01
sift remind done <id>

# Daily briefing (email + calendar + Linear + balances)
sift today

# Calendar
sift cal today

# Linear issues
sift linear mine

# Financial data
sift money balance
sift money transactions --source=starling --from=2026-01-01

# Places
sift places search "coffee near me" --open-now --limit=5
sift places resolve "Soho, London"
sift places details <place_id> --reviews

# Utilities
sift status
sift refresh
sift describe
sift help
```

### Agent flags

All read commands support structured output controls:

| Flag | Description |
|------|-------------|
| `--fields=f1,f2` | Select specific fields |
| `--limit=n` | Limit results |
| `--offset=n` | Offset for pagination |
| `--page-all` | Return all pages |
| `--format=ndjson` | Stream as newline-delimited JSON |
| `--dry-run` | Preview mutations without executing |
| `--input=JSON` | Pass a JSON payload (or `-` for stdin) |

## License

MIT
