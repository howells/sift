---
name: github-triage
description: Auto-resolve GitHub email notifications by checking PR/issue status via gh CLI. Trashes emails for merged/closed items.
version: 1
---

# GitHub Notification Triage

When reading emails (via `gog gmail list` or `sift list`), automatically resolve GitHub notifications against live GitHub state and trash emails that no longer need attention.

## Trigger

Apply this workflow whenever GitHub notification emails appear during email triage or briefing. GitHub notifications come from `notifications@github.com` with subjects referencing repos in `[owner/repo]` format.

## Workflow

1. **Identify GitHub notifications** in the email list by sender (`notifications@github.com`) or subject pattern (`[owner/repo]`).

2. **Parse the reference** from the email subject or body:
   - PR: subject contains `(PR #N)` or body contains `github.com/owner/repo/pull/N`
   - Issue: subject contains `(Issue #N)` or body contains `github.com/owner/repo/issues/N`
   - Discussion / other: skip (no reliable "done" signal)

3. **Check live status** using `gh` CLI:
   ```bash
   # For PRs
   gh pr view <N> --repo <owner/repo> --json state,mergedAt,title --jq '{state,mergedAt,title}'
   
   # For issues
   gh issue view <N> --repo <owner/repo> --json state,title --jq '{state,title}'
   ```
   Run these in parallel when checking multiple notifications.

4. **Resolve completed items**:
   - PR with state `MERGED` or `CLOSED` → **trash the email**
   - Issue with state `CLOSED` → **trash the email**
   - Anything else → **keep it**, report status to user

5. **Trash resolved emails**:
   ```bash
   gog gmail trash <messageId> -a <account> --force
   ```
   Use `--force` to skip confirmation since the status was already verified.

6. **Report** a summary of actions taken:
   - Which notifications were resolved and trashed (with PR/issue title and state)
   - Which notifications are still open and need attention

## Guardrails

- Only trash when the underlying GitHub object is definitively resolved (MERGED or CLOSED).
- Never trash notifications for OPEN PRs or issues, even if you've already reviewed them.
- If `gh` returns an error (auth, not found, rate limit), keep the email and report the error.
- When multiple emails reference the same PR/issue thread, check once and trash all related emails.
- Always report what was trashed so the user can recover from Gmail trash if needed.
