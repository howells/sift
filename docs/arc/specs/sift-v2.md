# Sift v2: Personal Operations Toolkit

**Status:** Draft (post-review)
**Date:** 2026-04-07

## Vision

Sift is a CLI toolkit that gives Claude Code everything it needs to help Daniel
navigate his day-to-day life. Email, reminders, and Linear are the **input** (what
needs doing). Financial operations, calendar, and other tools are the
**output** (how to do it).

The primary interface is Claude Code. The TUI is a secondary, interactive fallback.

All CLIs in this ecosystem follow agentic CLI best practices: structured JSON on
stdout, progress on stderr, `--help` for discovery, `--dry-run` for previewing
destructive actions, field masking to control output size. Claude Code can figure
out how to use well-documented tools — sift provides structure and aggregation,
not hand-holding.

## Three-Package Architecture

```
sift                          CLI toolkit for Claude Code
  |
  +-- @howells/ledger          Canonical financial I/O (library + CLI)
  |
  +-- offledger                Financial analysis & budgeting (consumes ledger)
```

### @howells/ledger

New TypeScript package at `~/Sites/ledger`. Library and CLI.
Owns all financial provider communication.

**What it does:**
- Talks to Starling, Xero, Revolut, Stripe, Wise
- Normalises accounts, balances, transactions, invoices into uniform types
- Handles auth (tokens, OAuth refresh) centrally
- Provides both programmatic API and CLI

**What it does NOT do:**
- No forecasting, no runway, no burn rate (offledger)
- No budgeting, no tax planning (offledger)
- No email, no reminders, no LLM analysis (sift)

### offledger (updated)

Replaces its `/scripts/` sync layer with `@howells/ledger`. Keeps:
- 12-month forecasting with event-based modeling
- Tax schedule and planning (HMRC monthly vs lump sum)
- Net worth tracking with fractional ownership
- Burn rate by tier (essential/lifestyle/discretionary)
- Runway calculation
- Budget reconciliation
- Scenario modeling
- Household/person financial views
- MCP server and CLI

### sift (restructured)

Reorganises around domain subcommands. Claude Code discovers capabilities via
`sift help --json` and each subcommand's own `--help`.

---

## Sift Subcommands

Sift wraps tools that benefit from structured output, caching, or aggregation
into `sift today`. Tools that Claude Code can use directly (bird, falcon, vercel,
gh, etc.) are documented in `sift help --json` but not wrapped.

### Email (`sift email`)

Source: `gog` CLI (spawnSync)
Already built. Current email triage pipeline stays intact.

```
sift email list [--group=X] [--fields=f1,f2] [--backlog]
sift email done <id> [--dry-run]
sift email star <id>
sift email remind <id>
sift email open <id>
sift email refresh
```

### Reminders (`sift remind`)

Source: `remindctl` CLI (spawnSync)
Existing integration, promoted to subcommand.

> **Migration note:** The current `sift remind <id>` command (create reminder
> from email) moves to `sift email remind <id>`. The top-level `sift remind`
> becomes the reminders subcommand. Backward compat alias kept during transition.

```
sift remind list [--due=today|week|overdue|all] [--list=X]
sift remind add "..." [--due=DATE] [--list=X] [--notes="..."]
sift remind done <id>
sift remind delete <id>
```

### Linear (`sift linear`)

Source: Linear REST API (direct HTTP)
Auth: `LINEAR` token from `~/dotfiles/.secrets`

```
sift linear mine [--status=in-progress|todo|done] [--team=X]
sift linear issue <id>
sift linear update <id> [--status=X] [--assignee=X] [--priority=X]
sift linear create --team=X --title="..." [--priority=X] [--desc="..."]
sift linear search "query"
```

Cache: linear issues cached in SQLite with short TTL. `sift linear update`
invalidates the cache for the affected issue.

### Money (`sift money`)

Source: `@howells/ledger` (library import) + `offledger` CLI (spawnSync)
Ledger handles I/O. Offledger handles analysis.

```
# Via ledger (I/O)
sift money balance [--account=X] [--source=starling|revolut|wise|stripe|xero]
sift money transactions [--account=X] [--from] [--to] [--search] [--min] [--max]
sift money invoice list [--status=draft|sent|paid|overdue]
sift money invoice create --client=X --amount=Y --desc=Z [--currency=GBP]
sift money sync [--source=all|starling|xero|...]

# Via offledger (analysis)
sift money status              # liquid, net worth, runway, burn, next tax
sift money runway              # months of runway
sift money forecast [--months=12]
sift money tax [--next|--schedule]
sift money burn                # monthly burn by tier
sift money networth            # asset/liability breakdown
```

Degradation: if offledger is unavailable, `sift money` commands that depend on it
return `{ "error": "offledger not available" }` in the relevant section rather
than failing the entire command.

### Calendar (`sift cal`)

Source: `gog calendar` (spawnSync). No caching — always fetched live.

```
sift cal today                 # today's events
sift cal week                  # this week
sift cal tomorrow              # tomorrow
sift cal free [--duration=30m] [--date=DATE]
sift cal add --title="..." --date=DATE --time=TIME [--duration=1h]
```

---

## Tools Not Wrapped by Sift

These tools are documented in `sift help --json` so Claude Code knows they exist.
Claude Code invokes them directly — sift doesn't add value by wrapping them.

| Tool | Purpose | Discovery |
|------|---------|-----------|
| `bird` | Twitter/X (post, read, search) | `bird --help` |
| `ledger` | Financial I/O (Starling, Xero, Stripe, Wise, Revolut) | `ledger --help` |
| `starlingcli` | Starling Bank CLI (read-only) | `starlingcli help` |
| `revolutcli` | Revolut Business CLI (read-only) | `revolutcli help` |
| `wisecli` | Wise (TransferWise) CLI (read-only) | `wisecli help` |
| `motif` | Agent-first AI image generation (fal.ai) | `motif --help` |
| `falcon` | AI image generation (fal.ai) | `falcon --help` |
| `granola` | Meeting notes export | `granola --help` |
| `granola-sync` | Sync meetings to Obsidian | `granola-sync --help` |
| `vercel` | Deployment, env vars, domains | `vercel --help` |
| `gh` | GitHub PRs, issues, actions | `gh --help` |
| `godaddy` | DNS record management | `godaddy --help` |
| `sentry-cli` | Error tracking, releases | `sentry-cli --help` |
| `stripe` | Payment operations, webhooks | `stripe --help` |
| `neonctl` | Serverless Postgres | `neonctl --help` |
| `doctl` | DigitalOcean | `doctl --help` |
| `forge` | Laravel Forge servers | `forge --help` |
| `gog` | Google Workspace (beyond what sift wraps) | `gog --help` |

The `sift help --json` output includes a `tools` section listing these with
binary paths and one-line descriptions, so Claude Code can discover them without
prior knowledge.

---

## The Action Model

### Current State

Email analysis extracts: `summary, urgency, person, deadline, reasoning`

### New State

Analysis adds a single `actionType` field. Claude Code uses the action type
combined with the summary and its knowledge of available tools to determine
what command to run. No pre-computed commands or entity bags — Claude Code
is better at in-context reasoning than a pre-baked extraction.

```typescript
type ActionType =
  | 'invoice'        // create/send invoice
  | 'check-payment'  // verify payment received
  | 'pay'            // make a payment
  | 'reply'          // respond to someone
  | 'schedule'       // book meeting/event
  | 'review'         // review PR, doc, contract
  | 'expense'        // log an expense
  | 'reconcile'      // cross-check financial records
  | 'follow-up'      // chase someone
  | 'delegate'       // assign to someone else
  | 'note'           // capture information
  | 'other'          // doesn't fit a category
```

The `ActionType` is extracted during the email analysis LLM call (minimal
additional tokens) and cached alongside the existing todo fields.

---

## `sift today` — Unified Daily Briefing

The central command. Aggregates all domains into a single structured response.
Each domain is fetched independently with a per-domain timeout. If a domain
fails, its section contains an `error` field and the rest of the briefing
still returns.

```
sift today [--group=X]
```

### Output Structure

```json
{
  "date": "2026-04-07",
  "calendar": [
    { "time": "10:00", "end": "10:30", "title": "Call with Acme", "calendar": "Work" },
    { "time": "14:00", "end": "15:00", "title": "School pickup", "calendar": "Personal" }
  ],
  "actions": [
    {
      "id": "abc123",
      "source": "email",
      "summary": "Send invoice to Acme for March",
      "urgency": "this_week",
      "actionType": "invoice",
      "person": "Sarah (Acme)"
    },
    {
      "id": "def456",
      "source": "reminder",
      "summary": "Check if school fees payment landed",
      "urgency": "overdue",
      "actionType": "check-payment"
    },
    {
      "id": "ghi789",
      "source": "linear",
      "summary": "Review: Auth refactor PR #42",
      "urgency": "this_week",
      "actionType": "review"
    }
  ],
  "money": {
    "runway_months": 8.2,
    "burn_rate": 6800,
    "next_tax": { "amount": 12500, "due": "2026-07-31", "type": "poa2" },
    "overdue_invoices": 2,
    "liquid_gbp": 45000
  },
  "reminders": {
    "overdue": 1,
    "today": 3,
    "this_week": 7
  },
  "linear": {
    "in_progress": 2,
    "todo": 5
  }
}
```

---

## @howells/ledger — Detailed Design

### Package Structure

```
~/Sites/ledger/
  src/
    index.ts                 # Library exports
    cli.ts                   # CLI entry point
    types.ts                 # Normalised financial types
    config.ts                # Auth config management
    providers/
      starling.ts            # Starling Bank API
      xero.ts                # Xero API (OAuth + invoice CRUD)
      revolut.ts             # Revolut Business API
      stripe.ts              # Stripe API
      wise.ts                # Wise API
    lib/
      http.ts                # Shared HTTP client
      auth.ts                # Token refresh, OAuth flows
      currency.ts            # Currency conversion
  tests/
    providers/
      starling.test.ts
      xero.test.ts
      ...
```

### Normalised Types

```typescript
interface Account {
  id: string
  name: string
  provider: 'starling' | 'xero' | 'revolut' | 'stripe' | 'wise'
  type: 'current' | 'savings' | 'business' | 'payment' | 'credit'
  currency: 'GBP' | 'USD' | 'EUR' | 'SEK'
  balance: number
  lastSynced: string     // ISO date
}

interface Transaction {
  id: string
  accountId: string
  provider: string
  date: string           // ISO date
  description: string
  amount: number         // signed (negative = outgoing)
  currency: string
  counterparty?: string
  reference?: string
  category?: string
}

interface Invoice {
  id: string
  provider: 'xero'
  number: string
  client: string
  entity: string         // runtime string, not hardcoded union
  amount: number
  currency: string
  status: 'draft' | 'sent' | 'authorised' | 'paid' | 'voided' | 'overdue'
  date: string
  dueDate?: string
}
```

### Auth Config

Location: `~/.config/ledger/config.json`

```json
{
  "starling": {
    "personal": "token...",
    "businessGbp": "token...",
    "businessUsd": "token...",
    "rental": "token...",
    "joint": "token..."
  },
  "xero": {
    "clientId": "...",
    "clientSecret": "..."
  },
  "revolut": {
    "clientId": "...",
    "privateKeyPath": "~/.config/ledger/revolut-private.pem"
  },
  "stripe": {
    "secretKey": "..."
  },
  "wise": {
    "apiToken": "..."
  }
}
```

Token caches (Xero, Revolut) stored alongside: `~/.config/ledger/xero-tokens.json`, etc.

### CLI Surface

```
ledger accounts [--provider=starling|xero|revolut|stripe|wise]
ledger balance [account-name] [--all]
ledger transactions [--account=X] [--from=DATE] [--to=DATE] [--search=Q] [--min=N] [--max=N]
ledger invoice list [--status=draft|sent|paid|overdue] [--client=X]
ledger invoice create --client=X --amount=N --description="..." [--currency=GBP] [--entity=halling-howells]
ledger invoice send <id>
ledger sync [--provider=all|starling|xero|revolut|stripe|wise] [--dry-run]
ledger status                    # all balances + last sync times
ledger setup                     # interactive config wizard
```

All output is JSON to stdout. Progress on stderr.

---

## Sift Config Updates

Sift's config expands to include new domains:

```json
{
  "accounts": [...],           // existing gmail accounts
  "reminderLists": [...],      // existing reminder lists
  "anthropicApiKey": "...",    // existing
  "preferClaudeCli": true,     // existing

  "linear": {
    "apiKey": "from-dotfiles-secrets",
    "defaultTeam": "engineering",
    "userId": "..."            // for "mine" queries
  },

  "calendar": {
    "account": "daniel.howells@gmail.com",
    "calendars": ["Work", "Personal", "Family"]
  }
}
```

---

## Cache Schema Updates

Sift's SQLite cache expands for new data. Migrations are applied via a
`schema_version` integer stored in the SQLite `user_version` pragma. On startup,
sift checks the version and applies any pending ALTER TABLE or CREATE TABLE
statements sequentially.

```sql
-- schema version 1 (existing)
CREATE TABLE analyzed_emails (...);

-- schema version 2
ALTER TABLE analyzed_emails ADD COLUMN action_type TEXT;

-- schema version 3
CREATE TABLE linear_issues (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,       -- e.g. "ENG-123"
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  priority INTEGER,
  assignee TEXT,
  team TEXT,
  url TEXT,
  cached_at INTEGER NOT NULL
);
```

---

## Implementation Phases

### Phase 1: @howells/ledger

Create the package from scratch. Port offledger's sync scripts into typed
TypeScript providers.

1. Scaffold package (TypeScript, vitest, biome, NodeNext modules)
2. Implement types.ts with normalised Account, Transaction, Invoice
3. Implement config.ts with auth management
4. Port Starling provider (balances + transactions)
5. Port Xero provider (invoices read + create, director loan, bank txns)
6. Port Revolut provider (balances, OAuth/JWT)
7. Port Stripe provider (balances)
8. Port Wise provider (balances)
9. Implement CLI with subcommands
10. Tests for each provider

### Phase 2: Sift CLI restructure

Reorganise sift's CLI without breaking existing functionality.

1. Move current CLI commands under `sift email` subcommand
2. Keep `sift list`, `sift done`, `sift star`, `sift open` as aliases
3. Move `sift remind <id>` to `sift email remind <id>` (resolve naming collision)
4. Add subcommand routing in cli.ts
5. Promote reminders to `sift remind` subcommand (list, add, done, delete)
6. Add schema migration framework (user_version pragma)
7. Update `sift help --json` with new structure + tools list
8. Update config schema for new domains

### Phase 3: New integrations

Add remaining subcommands. These are independent and can be built in any order.

1. `sift linear` — Linear REST API client, issues cache
2. `sift money` — ledger library import + offledger CLI wrapper
3. `sift cal` — gog calendar wrapper (no cache)

### Phase 4: `sift today` + action model

The unified daily briefing and enriched email analysis.

1. Add `actionType` to email analysis prompt
2. Update cache schema (migration v2)
3. Implement `sift today` aggregating all domains
4. Per-domain timeout + partial-failure handling
5. Update TUI to show action types

### Phase 5: Offledger migration

Replace offledger's sync scripts with ledger.

1. Add @howells/ledger as offledger dependency
2. Replace /scripts/ calls with ledger library calls
3. Update MCP tools to use ledger
4. Remove duplicated sync code
5. Verify all offledger commands still work

---

## Backward Compatibility

- `sift list` → alias for `sift email list`
- `sift done <id>` → alias for `sift email done <id>`
- `sift star <id>` → alias for `sift email star <id>`
- `sift remind <id>` → alias for `sift email remind <id>` (NOT `sift remind`)
- `sift open <id>` → alias for `sift email open <id>`
- `sift status` → alias for `sift email status`
- `sift refresh` → alias for `sift email refresh`
- TUI (no subcommand, TTY mode) → continues to launch email triage view
- `offledger` CLI → continues to work throughout migration

## Non-Goals

- Sift is NOT a product for other users. No auth, no multi-tenancy, no onboarding.
- Sift does NOT replace offledger's forecasting/analysis. It delegates.
- Sift does NOT replace individual CLIs. It wraps tools that benefit from
  structured aggregation and documents the rest for Claude Code discovery.
- No web UI. No API server. CLI only.
- No pre-computed commands or entity extraction in the action model. Claude Code
  does the reasoning — sift provides the data.
