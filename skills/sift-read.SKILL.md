---
name: sift-read
description: Read inbox, reminders, calendar, and money surfaces from sift with minimal context waste.
version: 1
---

# sift Read Skill

## Workflow

1. Run `sift describe <command>` if the exact surface is unclear.
2. Start with the narrowest useful `--fields` mask.
3. Add `--limit` and `--offset` for large lists.
4. Use `--format=ndjson` when streaming many rows into another tool.

## Guardrails

- Do not request full todos unless you truly need reasoning text.
- Prefer `sift list --fields=id,summary,urgency` for triage.
- Prefer `sift remind list --fields=id,title,dueDate` for reminder review.
- Prefer `sift status --fields=config,groups,securityPosture` before assuming capabilities.
- Use source filters like `--group` or `--source` before pagination.
