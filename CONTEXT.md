# sift — Agent Context

AI-powered email triage CLI. Fetches starred/unread emails from Gmail, analyzes urgency with Claude, and outputs prioritized todos.

## Quick Start

```bash
sift list --json --fields=id,summary,urgency,person,deadline
```

## Commands

| Command | Description | Flags |
|---------|-------------|-------|
| `sift list` | List prioritized todos | `--group`, `--fields`, `--backlog`, `--json` |
| `sift done <id>` | Mark done (unstar + read) | `--dry-run`, `--json` |
| `sift star <id>` | Star email | `--dry-run`, `--json` |
| `sift remind <id>` | Create Apple Reminder | `--dry-run`, `--json` |
| `sift open <id>` | Get email URL | `--json` |
| `sift status` | Account + cache status | `--json` |
| `sift refresh` | Clear cache, re-fetch | `--json` |
| `sift help` | Schema + field list | `--json` |

## Invariants

- **Always use `--fields`** to limit output. Full todos have 18 fields; most tasks need only `id,summary,urgency`.
- **Always use `--dry-run`** before `done` or `remind`. These are irreversible.
- **IDs are Gmail thread IDs** — alphanumeric hex strings like `19d42c92f393e035`.
- **Urgency values**: `overdue`, `this_week`, `when_you_can` (sorted in that order).
- **Sources**: `email` (from Gmail) or `reminder` (from Apple Reminders). Only email-sourced todos can be starred or opened.
- **Groups** match account config (e.g., `personal`, `siteinspire`). Use `sift status` to discover valid groups.
- **Progress** goes to stderr as NDJSON. stdout is always clean JSON.
- **Exit codes**: 0 = success, 1 = error, 2 = validation error.
- Non-TTY (piped) contexts default to JSON output.

## Field Names

`id`, `emailId`, `threadId`, `account`, `group`, `subject`, `from`, `fromEmail`, `summary`, `urgency`, `reasoning`, `date`, `isStarred`, `person`, `deadline`, `reminderState`, `source`, `reminderId`

## Recommended Field Masks

| Task | Fields |
|------|--------|
| Quick overview | `id,summary,urgency` |
| Triage decision | `id,summary,urgency,person,deadline,account` |
| Full context | `id,summary,urgency,person,deadline,reasoning,from,date` |
| Action prep | `id,emailId,threadId,account,source` |

## Error Format

```json
{"error": "message", "code": "ERROR|NOT_FOUND|VALIDATION_ERROR"}
```

## Example Workflows

### Triage inbox
```bash
sift list --json --fields=id,summary,urgency,person,deadline
# → Review items, then:
sift done <id> --dry-run --json
sift done <id> --json
```

### Check specific group
```bash
sift list --json --group=personal --fields=id,summary,urgency
```

### Create reminder for later
```bash
sift remind <id> --dry-run --json
sift remind <id> --json
```
