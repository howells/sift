---
name: sift-write
description: Execute sift mutations safely with raw payloads, dry-runs, and validation-first behavior.
version: 1
---

# sift Write Skill

## Workflow

1. Resolve the target with a read command first.
2. Prefer raw JSON input for repeatable automation:
   - `sift done --input='{"id":"..."}' --dry-run`
   - `sift remind add --input='{"title":"...","list":"Work"}' --dry-run`
3. Inspect the dry-run payload.
4. Re-run without `--dry-run` only after the target and effect are confirmed.

## Guardrails

- Never mutate from a guessed ID.
- IDs must be copied from prior structured output.
- Reminder priorities must be one of `0`, `1`, `5`, or `9`.
- Reminder list filters are restricted; do not invent new due filter values.
- `refresh` is also a write surface because it invalidates cached analysis. Dry-run it first.
