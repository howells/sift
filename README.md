# sift

Sift through your email. Surface what matters.

AI-powered email triage for the terminal. Pulls starred and unread emails from multiple Gmail accounts, analyzes urgency with Claude, and presents a prioritized todo list you can act on.

## Setup

```bash
pnpm install
sift --setup     # configure accounts
sift             # run
```

Requires [gog](https://github.com/howells/gog) for Gmail access and optionally [remindctl](https://github.com/howells/remindctl) for Apple Reminders integration.
