---
name: vercel-triage
description: Auto-resolve Vercel email notifications by checking deployment status via vercel CLI. Trashes resolved failures and routine confirmations.
version: 1
---

# Vercel Notification Triage

When reading emails, automatically classify Vercel notifications and trash those that don't need attention.

## Trigger

Apply this workflow whenever Vercel emails appear during email triage or briefing. Vercel notifications typically come from `*@vercel.com` or `*@info.vercel.com` senders.

## Classification

### Trash immediately (noise)

- **Preview deployment failures** — visible in PR checks already
- **Preview deployment successes** — informational only
- **Production deployment successes** — just confirmations

### Check then trash (resolved)

- **Production deployment failures** — check if a newer successful production deploy exists:
  ```bash
  vercel list <project> --environment production --status READY -F json --yes
  ```
  If the latest READY production deployment is newer than the failure email, the issue is resolved → trash.
  If the failure is still the latest production state → **keep it, flag as urgent**.

### Always keep (actionable)

- **Domain expiration or DNS issues**
- **Billing and usage alerts**
- **Security advisories**
- **Rate limit or abuse warnings**

### Marketing — keep only if astonishingly interesting

Vercel marketing emails (from `ship@info.vercel.com`, `news@info.vercel.com`, etc.) are mostly noise. Only keep one if it meets ALL of these:

- Announces a genuinely new capability or paradigm shift (not a minor update or "best practices" rehash)
- Directly relevant to the user's stack: AI SDK, Edge/serverless primitives, CLI tooling, design-forward web dev
- OR is a London/UK event the user could actually attend

Trash everything else: generic webinars, case studies, "tips and tricks", partner spotlights, and feature reminders for things already shipped.

## Workflow

1. **Identify Vercel emails** by sender domain (`vercel.com`, `info.vercel.com`).

2. **Classify** by subject line:
   - Contains "failed" + a project name → deployment failure
   - Contains "deployed" / "ready" / "promoted" → deployment success
   - Contains "domain", "DNS", "expir" → domain issue (keep)
   - Contains "invoice", "billing", "usage", "limit" → billing (keep)
   - Everything else → marketing or informational

3. **For deployment failures**, parse the project name from the subject/body and check:
   ```bash
   vercel list <project> --environment production --status READY -F json --yes
   ```
   Compare the latest successful deployment timestamp against the email date.

4. **Trash resolved emails**:
   ```bash
   gog gmail trash <messageId> -a <account> --force
   ```

5. **Report** a summary: what was trashed, what needs attention, and why.

## Guardrails

- Never trash domain, billing, or security emails regardless of apparent resolution.
- If `vercel list` fails (auth, project not found), keep the email and report the error.
- When in doubt about a marketing email's interest level, trash it — the bar is "astonishingly interesting."
- Always report what was trashed so the user can recover from Gmail trash if needed.
