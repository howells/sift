# sift

**Sift through your email. Surface what matters.**

A terminal UI that extracts time-aware todos from your Gmail accounts, powered by Claude.

---

## The Problem

You have hundreds of starred/unread emails across multiple Gmail accounts. Some are urgent, some are stale, and you can't tell which is which. An email from 7 days ago saying "can we meet next week?" is now overdue, but it looks the same as everything else.

## The Solution

An Ink-based CLI that:
1. Fetches starred + unread emails from all accounts via `gog`
2. Uses Claude to analyze with time-awareness
3. Presents a prioritized todo list grouped by urgency
4. Lets you act on items: mark done, star, create Apple Reminders
5. Caches analysis in SQLite so repeat runs are fast

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      sift (Ink CLI)                           │
│                                                               │
│  gog CLI:                        Claude (via envelope):       │
│  • Fetch starred/unread          • Analyze emails → todos     │
│  • Star/unstar/archive           • Generate reminder content  │
│  • Open in browser               • Natural language search    │
│  • Mark read                                                  │
│                                                               │
│  remindctl CLI:                  SQLite cache:                │
│  • Create Apple Reminders        • Avoid re-analyzing         │
│  • Complete reminders            • Content-hash based         │
│  • Fetch pending reminders       • 90-day auto-prune          │
└──────────────────────────────────────────────────────────────┘

Accounts:
• daniel.howells@gmail.com (personal)
• daniel@danielhowells.com (personal)
• mail@siteinspire.com (siteinspire)
```

---

## UI

### Main View

```
sift · 12 items                                  1 personal · 2 siteinspire

  ● Overdue (2)
▸ ◻ Reply to Sarah re: project timeline  ★ Sarah Chen    overdue    personal
    Send contract to Tom                     Tom Blake     3d ago     personal

  ● This week (3)
    Pay Acme Corp invoice                    Acme Corp     tomorrow   personal
    Review PR from Mike                      Mike Ross     in 2d      siteinspire
    Schedule call with Amy                   Amy Tan       in 4d      personal

  ● When you can (5)
    Read article from Dan                    Dan Kim       1w ago     siteinspire
    ...

─────────────────────────────────────────────────────────────────────────────
j/k nav  ⏎ open  d done  s star  t remind  r refresh  q quit
```

### Key Actions

| Key | Action | Effect |
|-----|--------|--------|
| `j/k` or `↑/↓` | Navigate | Move selection |
| `Enter` | Open | Opens email thread in browser |
| `d` | Done | Unstar + mark read + remove from cache |
| `s` | Star | Star the email in Gmail |
| `t` | Remind | Create Apple Reminder with Claude-generated title |
| `b` | Backlog | Toggle backlog view (emails > 30 days old) |
| `1-N` | Filter | Filter by account group |
| `r` | Refresh | Re-fetch all emails |
| `q` | Quit | Exit |

---

## Technical Stack

```
sift/
├── src/
│   ├── index.tsx              # Entry point (alternate screen buffer)
│   ├── app.tsx                # Main Ink app + keyboard handler
│   ├── setup.tsx              # Interactive setup wizard
│   ├── components/
│   │   ├── header.tsx         # Title bar + account group tabs
│   │   ├── todo-list.tsx      # Grouped, windowed todo list
│   │   ├── todo-item.tsx      # Single todo row with relative time
│   │   ├── status-bar.tsx     # Keybinding hints
│   │   └── spinner.tsx        # Loading state with progress bar
│   ├── hooks/
│   │   └── use-sift-data.ts   # All state management + data loading
│   └── lib/
│       ├── auth.ts            # Account config reader
│       ├── cache.ts           # SQLite analysis cache
│       ├── claude.ts          # Claude CLI/API wrapper (structured output)
│       ├── config.ts          # Config file management
│       ├── gmail.ts           # GmailClient (wraps gog CLI)
│       ├── reminders.ts       # Apple Reminders integration (wraps remindctl)
│       ├── time.ts            # Relative time formatting
│       └── types.ts           # TypeScript types
├── credentials/               # OAuth tokens (gitignored)
├── .cache/                    # SQLite database (gitignored)
└── docs/
    └── plan.md                # This file
```

### Dependencies

- **ink** 6 + **react** 19 — React for CLI
- **better-sqlite3** — Analysis cache
- **@howells/envelope** — Claude Code CLI client
- **@anthropic-ai/sdk** — Anthropic API fallback
- **zod** 4 — Schema validation for LLM output
- **gog** (external) — Gmail CLI
- **remindctl** (external) — Apple Reminders CLI

---

## Design Decisions

### Why gog CLI?
Direct Gmail API access via `gog` avoids managing OAuth tokens and refresh flows. gog handles auth storage in the system keychain and provides a clean JSON output mode.

### Why Claude CLI first?
Shelling out to `claude` CLI means all LLM operations go through the existing Claude Code subscription at no incremental API cost. Falls back to Anthropic API if configured.

### SQLite cache
Emails are hashed by content (subject + from + date + snippet + flags). If the hash matches a cached entry, we skip analysis entirely. This makes repeat runs near-instant.

### Alternate screen buffer
The app uses the terminal's alternate screen buffer (like vim/less) so quitting restores the previous terminal state cleanly.
