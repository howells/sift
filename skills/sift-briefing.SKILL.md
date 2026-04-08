---
name: sift-briefing
description: Build a concise daily briefing from sift without wasting tokens.
version: 1
---

# sift Briefing Skill

Use this when assembling a daily summary from multiple sift surfaces.

## Recommended sequence

1. `sift today --fields=date,calendar,actions,linear,money,reminders`
2. If more detail is needed, fan out narrowly:
   - `sift list --fields=id,summary,urgency,deadline --limit=10`
   - `sift cal today --fields=time,end,title,calendar --limit=20`
   - `sift money balance --fields=id,balance,currency --limit=10`

## Guardrails

- Start with `today` before hitting each sub-surface individually.
- Do not fetch reasoning text unless a decision depends on it.
- Prefer IDs plus summaries over raw email metadata for summarization tasks.
