# Sift v2 Implementation Plan

**Spec:** [docs/arc/specs/sift-v2.md](/Users/danielhowells/Sites/sift/docs/arc/specs/sift-v2.md)
**Date:** 2026-04-07
**Scope:** Multi-repo implementation spanning `/Users/danielhowells/Sites/sift`, a new `/Users/danielhowells/Sites/ledger`, and adapter changes expected by `/Users/danielhowells/Sites/offledger`.

## Intent

This plan treats references to "Claude Code" in the spec as "the current coding agent / Codex". The implementation uses a tracer-bullet strategy because the architecture is unproven across repositories: prove one real `ledger -> sift money -> sift today` path first, then widen provider and subcommand coverage.

## File Structure

### `/Users/danielhowells/Sites/ledger`

- `package.json`
  Owns package identity, scripts, local bin, and dependency surface.
- `tsconfig.json`
  Owns NodeNext TypeScript build settings shared by library and CLI.
- `vitest.config.ts`
  Owns test runner setup.
- `src/index.ts`
  Re-exports public library API only.
- `src/cli.ts`
  Owns JSON CLI surface and subcommand routing.
- `src/types.ts`
  Owns normalized `Account`, `Transaction`, `Invoice`, provider names, and query/filter shapes.
- `src/config.ts`
  Owns config file paths, secret loading, token-cache IO, and validation.
- `src/lib/http.ts`
  Owns fetch wrapper, auth headers, JSON parsing, and reusable error formatting.
- `src/providers/stripe.ts`
  Owns Stripe balance fetch + normalization.
- `src/providers/wise.ts`
  Owns Wise balance fetch + normalization.
- `src/providers/starling.ts`
  Owns Starling account, balance, and transaction fetch + normalization.
- `src/providers/xero.ts`
  Owns Xero token management, invoice read/list, and create payload assembly.
- `src/providers/revolut.ts`
  Owns Revolut OAuth token handling and account/balance normalization.
- `src/*.test.ts`, `src/providers/*.test.ts`
  Own all unit coverage for config, normalization, auth, and CLI routing.

### `/Users/danielhowells/Sites/sift`

- `package.json`
  Owns the local dependency on `../ledger`.
- `src/lib/types.ts`
  Extends todo/domain types with `actionType` and daily-briefing shapes.
- `src/lib/cache.ts`
  Owns schema-version migration handling for existing and new cache tables.
- `src/lib/config.ts`
  Extends sift config with `linear` and `calendar` sections.
- `src/lib/claude.ts`
  Extends email analysis extraction to include `actionType`.
- `src/cli.ts`
  Becomes the domain router for `email`, `remind`, `money`, `today`, `help`, and legacy aliases.
- `src/index.tsx`
  Expands CLI mode detection for nested subcommands.
- `src/lib/linear.ts`
  Owns Linear REST client and cache invalidation hooks.
- `src/lib/today.ts`
  Owns per-domain aggregation, timeout handling, and partial-failure assembly.
- `src/lib/calendar.ts`
  Owns `gog calendar` wrapper.
- `src/lib/reminders-cli.ts`
  Owns non-email reminder subcommands.
- `src/*.test.ts`
  Owns router, migration, action-type, and aggregator coverage.

### `/Users/danielhowells/Sites/offledger`

- No immediate invasive rewrite in the first tracer-bullet batch.
- Existing scripts remain source material until `ledger` reaches feature parity.
- Integration boundary is validated by matching normalized provider outputs expected by `offledger`.

## Architecture Notes

- `ledger` is a standalone TypeScript package and CLI at `/Users/danielhowells/Sites/ledger`.
- `sift` consumes `ledger` through a local file dependency (`file:../ledger`) during development.
- `offledger` remains operational during migration; `ledger` ports providers without breaking the existing repo first.
- Every CLI continues to emit structured JSON on stdout and progress/errors on stderr where applicable.

## Test Coverage Plan

### Unit Tests

| Task | Test File | What to Test |
|------|-----------|--------------|
| Ledger scaffold + config | `/Users/danielhowells/Sites/ledger/src/config.test.ts` | config path resolution, validation, token cache IO |
| Ledger normalized types | `/Users/danielhowells/Sites/ledger/src/types.test.ts` | schema parsing and normalization helpers |
| Stripe provider | `/Users/danielhowells/Sites/ledger/src/providers/stripe.test.ts` | balance aggregation by currency |
| Wise provider | `/Users/danielhowells/Sites/ledger/src/providers/wise.test.ts` | profile selection and balance normalization |
| Starling provider | `/Users/danielhowells/Sites/ledger/src/providers/starling.test.ts` | account mapping, balance normalization, transaction sign handling |
| Xero provider | `/Users/danielhowells/Sites/ledger/src/providers/xero.test.ts` | token cache, invoice normalization, create payloads |
| Revolut provider | `/Users/danielhowells/Sites/ledger/src/providers/revolut.test.ts` | token refresh logic and account normalization |
| Ledger CLI | `/Users/danielhowells/Sites/ledger/src/cli.test.ts` | routing and JSON response shape |
| Sift router | `/Users/danielhowells/Sites/sift/src/cli.test.ts` | nested command routing and alias compatibility |
| Sift cache migration | `/Users/danielhowells/Sites/sift/src/lib/cache.test.ts` | schema version upgrades and new columns/tables |
| Sift actionType extraction | `/Users/danielhowells/Sites/sift/src/lib/claude.test.ts` | structured output includes valid action types |
| Sift today aggregator | `/Users/danielhowells/Sites/sift/src/lib/today.test.ts` | per-domain timeout, partial failure, response assembly |
| Linear integration | `/Users/danielhowells/Sites/sift/src/lib/linear.test.ts` | issue caching and invalidation |

### Integration Tests

| Feature | Test File | What to Test |
|---------|-----------|--------------|
| `ledger balance` -> `sift money balance` | `/Users/danielhowells/Sites/sift/src/lib/money.integration.test.ts` | sift delegates to ledger and preserves JSON contract |
| `sift today` aggregation | `/Users/danielhowells/Sites/sift/src/lib/today.integration.test.ts` | email/reminder/money/calendar/linear partial failure behavior |

### E2E Tests

None in the initial batch. Both CLIs are primarily JSON-oriented and are better covered through unit/integration tests first.

## Tasks

<task id="1" depends="" type="auto">
  <name>Scaffold the new ledger package</name>
  <files>
    <create>/Users/danielhowells/Sites/ledger/package.json</create>
    <create>/Users/danielhowells/Sites/ledger/tsconfig.json</create>
    <create>/Users/danielhowells/Sites/ledger/vitest.config.ts</create>
    <create>/Users/danielhowells/Sites/ledger/src/index.ts</create>
    <create>/Users/danielhowells/Sites/ledger/src/cli.ts</create>
    <create>/Users/danielhowells/Sites/ledger/src/cli.test.ts</create>
  </files>
  <read_first>
    /Users/danielhowells/Sites/sift/package.json
    /Users/danielhowells/Sites/sift/tsconfig.json
    /Users/danielhowells/Sites/offledger/package.json
  </read_first>
  <action>
    Create a standalone TypeScript package named @howells/ledger with NodeNext modules, a ledger CLI bin, vitest, biome-compatible formatting, and build/test/typecheck scripts.
    Export a minimal CLI router that supports help, status, accounts, balance, transactions, invoice list, invoice create, and sync subcommands, returning JSON objects to stdout.
    Keep the initial command handlers stubbed but typed so later provider tasks can fill them in without changing the CLI contract.
  </action>
  <test_code>
    import { describe, expect, it } from "vitest";
    import { runCli } from "./cli";

    describe("ledger CLI", () => {
      it("returns help payload for help command", async () => {
        const result = await runCli(["help"]);
        expect(result.ok).toBe(true);
        expect(result.data).toHaveProperty("commands");
        expect(result.data.commands).toHaveProperty("balance");
      });

      it("returns validation error for unknown command", async () => {
        const result = await runCli(["wat"]);
        expect(result.ok).toBe(false);
        expect(result.code).toBe("VALIDATION_ERROR");
      });
    });
  </test_code>
  <verify>
    cd /Users/danielhowells/Sites/ledger && pnpm vitest run src/cli.test.ts — all pass
    cd /Users/danielhowells/Sites/ledger && pnpm tsc --noEmit — no type errors
  </verify>
  <done>Ledger package exists with installable scripts, typed CLI router, and passing scaffold tests</done>
  <commit>feat(ledger): scaffold standalone package and cli router</commit>
</task>

<task id="2" depends="1" type="auto">
  <name>Create normalized ledger types and config management</name>
  <files>
    <create>/Users/danielhowells/Sites/ledger/src/types.ts</create>
    <create>/Users/danielhowells/Sites/ledger/src/config.ts</create>
    <create>/Users/danielhowells/Sites/ledger/src/types.test.ts</create>
    <create>/Users/danielhowells/Sites/ledger/src/config.test.ts</create>
    <modify>/Users/danielhowells/Sites/ledger/src/index.ts</modify>
  </files>
  <read_first>
    /Users/danielhowells/Sites/offledger/scripts/starling.mjs
    /Users/danielhowells/Sites/offledger/scripts/xero.mjs
    /Users/danielhowells/Sites/sift/src/lib/config.ts
  </read_first>
  <action>
    Define normalized Account, Transaction, Invoice, ProviderName, and query/filter interfaces in src/types.ts.
    Implement config helpers that read ~/.config/ledger/config.json, expose token-cache paths for xero and revolut, validate required provider credentials, and support dependency injection of config paths in tests.
    Re-export the public types and config helpers from src/index.ts.
  </action>
  <test_code>
    import { describe, expect, it } from "vitest";
    import { validateConfig } from "./config";

    describe("validateConfig", () => {
      it("requires xero client credentials when xero is configured", () => {
        const result = validateConfig({ xero: {} as never });
        expect(result).toContain("xero.clientId");
        expect(result).toContain("xero.clientSecret");
      });

      it("allows unrelated providers to be omitted", () => {
        const result = validateConfig({
          stripe: { secretKey: "sk_test_123" },
        });
        expect(result).toEqual([]);
      });
    });
  </test_code>
  <verify>
    cd /Users/danielhowells/Sites/ledger && pnpm vitest run src/types.test.ts src/config.test.ts — all pass
    cd /Users/danielhowells/Sites/ledger && pnpm tsc --noEmit — no type errors
  </verify>
  <done>Ledger exports normalized financial types and config/token-cache helpers with validation tests</done>
  <commit>feat(ledger): add normalized types and config management</commit>
</task>

<task id="3" depends="2" type="auto">
  <name>Add shared HTTP and provider contract utilities</name>
  <files>
    <create>/Users/danielhowells/Sites/ledger/src/lib/http.ts</create>
    <create>/Users/danielhowells/Sites/ledger/src/lib/http.test.ts</create>
    <modify>/Users/danielhowells/Sites/ledger/src/index.ts</modify>
  </files>
  <read_first>
    /Users/danielhowells/Sites/offledger/scripts/starling.mjs
    /Users/danielhowells/Sites/offledger/scripts/xero.mjs
    /Users/danielhowells/Sites/offledger/scripts/revolut.mjs
  </read_first>
  <action>
    Create a shared fetchJson helper with structured API errors, timeout support, header merging, and JSON parsing guards.
    Export reusable helpers for bearer auth, form-encoded requests, and safe response text inclusion on failure.
    Keep it provider-agnostic so every provider task can reuse the same surface.
  </action>
  <test_code>
    import { describe, expect, it, vi } from "vitest";
    import { fetchJson } from "./lib/http";

    describe("fetchJson", () => {
      it("returns parsed JSON for ok responses", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ ok: true }),
        });
        const result = await fetchJson("https://example.com", {}, fetchMock as never);
        expect(result).toEqual({ ok: true });
      });
    });
  </test_code>
  <verify>
    cd /Users/danielhowells/Sites/ledger && pnpm vitest run src/lib/http.test.ts — all pass
    cd /Users/danielhowells/Sites/ledger && pnpm tsc --noEmit — no type errors
  </verify>
  <done>Ledger has shared HTTP utilities used consistently by provider modules</done>
  <commit>feat(ledger): add shared http utilities for providers</commit>
</task>

<task id="4" depends="3" type="auto">
  <name>Implement Stripe and Wise balance providers in ledger</name>
  <files>
    <create>/Users/danielhowells/Sites/ledger/src/providers/stripe.ts</create>
    <create>/Users/danielhowells/Sites/ledger/src/providers/wise.ts</create>
    <create>/Users/danielhowells/Sites/ledger/src/providers/stripe.test.ts</create>
    <create>/Users/danielhowells/Sites/ledger/src/providers/wise.test.ts</create>
    <modify>/Users/danielhowells/Sites/ledger/src/index.ts</modify>
  </files>
  <read_first>
    /Users/danielhowells/Sites/offledger/scripts/stripe.mjs
    /Users/danielhowells/Sites/offledger/scripts/wise.mjs
    /Users/danielhowells/Sites/ledger/src/types.ts
    /Users/danielhowells/Sites/ledger/src/lib/http.ts
  </read_first>
  <action>
    Port the existing Stripe and Wise balance-fetch logic into ledger providers that return normalized Account records and source metadata without writing to any database.
    Preserve currency-specific balance aggregation from offledger while converting all results into the normalized Account shape.
    Make both providers dependency-injectable for tests by accepting a fetch implementation.
  </action>
  <test_code>
    import { describe, expect, it } from "vitest";
    import { normalizeStripeBalances } from "./providers/stripe";

    describe("normalizeStripeBalances", () => {
      it("aggregates available balances by currency", () => {
        const result = normalizeStripeBalances({
          available: [
            { currency: "gbp", amount: 1000 },
            { currency: "gbp", amount: 500 },
            { currency: "usd", amount: 2500 },
          ],
        });
        expect(result.map((entry) => [entry.currency, entry.balance])).toEqual([
          ["GBP", 15],
          ["USD", 25],
        ]);
      });
    });
  </test_code>
  <verify>
    cd /Users/danielhowells/Sites/ledger && pnpm vitest run src/providers/stripe.test.ts src/providers/wise.test.ts — all pass
    cd /Users/danielhowells/Sites/ledger && pnpm tsc --noEmit — no type errors
  </verify>
  <done>Ledger can fetch and normalize Stripe and Wise balances through tested providers</done>
  <commit>feat(ledger): port stripe and wise balance providers</commit>
</task>

<task id="5" depends="3" type="auto">
  <name>Implement Starling accounts balances and transactions provider</name>
  <files>
    <create>/Users/danielhowells/Sites/ledger/src/providers/starling.ts</create>
    <create>/Users/danielhowells/Sites/ledger/src/providers/starling.test.ts</create>
    <modify>/Users/danielhowells/Sites/ledger/src/index.ts</modify>
  </files>
  <read_first>
    /Users/danielhowells/Sites/offledger/scripts/starling.mjs
    /Users/danielhowells/Sites/ledger/src/types.ts
    /Users/danielhowells/Sites/ledger/src/lib/http.ts
  </read_first>
  <action>
    Port Starling token iteration, account discovery, balance retrieval, and transaction-between fetching into a provider module.
    Normalize account names, currencies, balances, and signed transactions while keeping account/category IDs available internally for follow-up requests.
    Do not port offledger's SQLite writes; the provider should only fetch and normalize.
  </action>
  <test_code>
    import { describe, expect, it } from "vitest";
    import { normalizeStarlingTransaction } from "./providers/starling";

    describe("normalizeStarlingTransaction", () => {
      it("marks outgoing transactions as negative", () => {
        const result = normalizeStarlingTransaction({
          feedItemUid: "tx_1",
          amount: { minorUnits: 1234, currency: "GBP" },
          direction: "OUT",
          transactionTime: "2026-04-01T10:00:00.000Z",
          counterPartyName: "Acme",
          reference: "Invoice 42",
        } as never, "account-1", "starling");

        expect(result.amount).toBe(-12.34);
        expect(result.description).toContain("Acme");
      });
    });
  </test_code>
  <verify>
    cd /Users/danielhowells/Sites/ledger && pnpm vitest run src/providers/starling.test.ts — all pass
    cd /Users/danielhowells/Sites/ledger && pnpm tsc --noEmit — no type errors
  </verify>
  <done>Ledger exposes a tested Starling provider for accounts balances and transactions</done>
  <commit>feat(ledger): port starling provider for accounts and transactions</commit>
</task>

<task id="6" depends="3" type="auto">
  <name>Implement Xero and Revolut auth-aware providers</name>
  <files>
    <create>/Users/danielhowells/Sites/ledger/src/providers/xero.ts</create>
    <create>/Users/danielhowells/Sites/ledger/src/providers/revolut.ts</create>
    <create>/Users/danielhowells/Sites/ledger/src/providers/xero.test.ts</create>
    <create>/Users/danielhowells/Sites/ledger/src/providers/revolut.test.ts</create>
    <modify>/Users/danielhowells/Sites/ledger/src/index.ts</modify>
  </files>
  <read_first>
    /Users/danielhowells/Sites/offledger/scripts/xero.mjs
    /Users/danielhowells/Sites/offledger/scripts/revolut.mjs
    /Users/danielhowells/Sites/ledger/src/config.ts
    /Users/danielhowells/Sites/ledger/src/lib/http.ts
  </read_first>
  <action>
    Port Xero custom-connection token caching, invoice listing, and invoice-create payload assembly into src/providers/xero.ts.
    Port Revolut token-cache handling and account/balance listing into src/providers/revolut.ts, but keep the browser/OAuth manual flow surfaced as an auth-required error rather than embedding prompts.
    Normalize both providers onto the common Account and Invoice shapes.
  </action>
  <test_code>
    import { describe, expect, it } from "vitest";
    import { buildInvoiceCreatePayload } from "./providers/xero";

    describe("buildInvoiceCreatePayload", () => {
      it("creates a GBP sales invoice payload", () => {
        const payload = buildInvoiceCreatePayload({
          client: "Acme",
          amount: 1000,
          description: "March retainer",
          currency: "GBP",
        });

        expect(payload.Type).toBe("ACCREC");
        expect(payload.LineItems[0].UnitAmount).toBe(1000);
      });
    });
  </test_code>
  <verify>
    cd /Users/danielhowells/Sites/ledger && pnpm vitest run src/providers/xero.test.ts src/providers/revolut.test.ts — all pass
    cd /Users/danielhowells/Sites/ledger && pnpm tsc --noEmit — no type errors
  </verify>
  <done>Ledger exposes tested Xero and Revolut providers with reusable auth-aware logic</done>
  <commit>feat(ledger): port xero and revolut providers</commit>
</task>

<task id="7" depends="4,5,6" type="auto">
  <name>Wire the ledger CLI to real provider-backed commands</name>
  <files>
    <modify>/Users/danielhowells/Sites/ledger/src/cli.ts</modify>
    <modify>/Users/danielhowells/Sites/ledger/src/cli.test.ts</modify>
    <modify>/Users/danielhowells/Sites/ledger/src/index.ts</modify>
  </files>
  <read_first>
    /Users/danielhowells/Sites/ledger/src/providers/stripe.ts
    /Users/danielhowells/Sites/ledger/src/providers/wise.ts
    /Users/danielhowells/Sites/ledger/src/providers/starling.ts
    /Users/danielhowells/Sites/ledger/src/providers/xero.ts
    /Users/danielhowells/Sites/ledger/src/providers/revolut.ts
  </read_first>
  <action>
    Replace the scaffold handlers with real `accounts`, `balance`, `transactions`, `invoice list`, `invoice create`, and `sync` command handlers.
    Keep stdout JSON-only and return structured provider errors instead of throwing raw fetch failures.
    Implement `sync` as a provider fan-out command that returns per-provider sections, not direct side effects into offledger.
  </action>
  <test_code>
    import { describe, expect, it, vi } from "vitest";
    import { runCli } from "./cli";

    describe("ledger balance command", () => {
      it("filters by provider and returns accounts", async () => {
        const services = {
          getBalances: vi.fn().mockResolvedValue([{ id: "1", provider: "stripe" }]),
        };
        const result = await runCli(["balance", "--source=stripe"], services as never);
        expect(result.ok).toBe(true);
        expect(result.data.items).toHaveLength(1);
      });
    });
  </test_code>
  <verify>
    cd /Users/danielhowells/Sites/ledger && pnpm vitest run src/cli.test.ts — all pass
    cd /Users/danielhowells/Sites/ledger && pnpm tsc --noEmit — no type errors
  </verify>
  <done>Ledger CLI commands are backed by real provider modules and emit stable JSON payloads</done>
  <commit>feat(ledger): wire cli commands to provider services</commit>
</task>

<task id="8" depends="1" type="auto">
  <name>Prepare sift for v2 command routing and local ledger consumption</name>
  <files>
    <modify>/Users/danielhowells/Sites/sift/package.json</modify>
    <modify>/Users/danielhowells/Sites/sift/src/index.tsx</modify>
    <modify>/Users/danielhowells/Sites/sift/src/cli.ts</modify>
    <create>/Users/danielhowells/Sites/sift/src/cli.test.ts</create>
  </files>
  <read_first>
    /Users/danielhowells/Sites/sift/src/index.tsx
    /Users/danielhowells/Sites/sift/src/cli.ts
    /Users/danielhowells/Sites/ledger/package.json
  </read_first>
  <action>
    Add a local dependency on file:../ledger in sift/package.json.
    Refactor the sift CLI parser so nested subcommands like `email list`, `money balance`, and `today` are routable while preserving the existing top-level aliases (`list`, `done`, `star`, `open`, `remind`, `refresh`, `status`).
    Keep human help and JSON help behavior intact.
  </action>
  <test_code>
    import { describe, expect, it } from "vitest";
    import { parseArgs } from "./cli";

    describe("parseArgs", () => {
      it("supports nested domain subcommands", () => {
        expect(parseArgs(["money", "balance", "--source=stripe"]).commandPath).toEqual([
          "money",
          "balance",
        ]);
      });
    });
  </test_code>
  <verify>
    cd /Users/danielhowells/Sites/sift && pnpm vitest run src/cli.test.ts — all pass
    cd /Users/danielhowells/Sites/sift && pnpm tsc --noEmit — no type errors
  </verify>
  <done>Sift can route nested v2 subcommands while preserving legacy aliases and linking to ledger locally</done>
  <commit>feat(sift): add v2 command router and local ledger dependency</commit>
</task>

<task id="9" depends="2,8" type="auto">
  <name>Add actionType and cache migration support to sift</name>
  <files>
    <modify>/Users/danielhowells/Sites/sift/src/lib/types.ts</modify>
    <modify>/Users/danielhowells/Sites/sift/src/lib/cache.ts</modify>
    <modify>/Users/danielhowells/Sites/sift/src/lib/cache.test.ts</modify>
    <modify>/Users/danielhowells/Sites/sift/src/lib/claude.ts</modify>
    <create>/Users/danielhowells/Sites/sift/src/lib/claude.test.ts</create>
  </files>
  <read_first>
    /Users/danielhowells/Sites/sift/src/lib/types.ts
    /Users/danielhowells/Sites/sift/src/lib/cache.ts
    /Users/danielhowells/Sites/sift/src/lib/claude.ts
  </read_first>
  <action>
    Extend Todo with the spec's actionType union.
    Replace the ad-hoc cache schema boot with explicit schema-version migration logic using SQLite user_version, adding action_type to analyzed_emails and preserving existing data.
    Update the Claude email analysis envelope schema and prompt so extracted todos include actionType.
  </action>
  <test_code>
    import { describe, expect, it } from "vitest";
    import { migrateSchema } from "./cache";

    describe("migrateSchema", () => {
      it("upgrades analyzed_emails to include action_type", () => {
        const db = migrateSchema(":memory:");
        const columns = db.prepare("PRAGMA table_info(analyzed_emails)").all() as Array<{ name: string }>;
        expect(columns.some((column) => column.name === "action_type")).toBe(true);
      });
    });
  </test_code>
  <verify>
    cd /Users/danielhowells/Sites/sift && pnpm vitest run src/lib/cache.test.ts src/lib/claude.test.ts — all pass
    cd /Users/danielhowells/Sites/sift && pnpm tsc --noEmit — no type errors
  </verify>
  <done>Sift stores actionType in its todo model and migrates cache schema safely</done>
  <commit>feat(sift): add action type extraction and cache migrations</commit>
</task>

<task id="10" depends="7,8" type="auto">
  <name>Implement sift money balance and transactions via ledger</name>
  <files>
    <create>/Users/danielhowells/Sites/sift/src/lib/money.ts</create>
    <create>/Users/danielhowells/Sites/sift/src/lib/money.integration.test.ts</create>
    <modify>/Users/danielhowells/Sites/sift/src/cli.ts</modify>
  </files>
  <read_first>
    /Users/danielhowells/Sites/ledger/src/index.ts
    /Users/danielhowells/Sites/ledger/src/cli.ts
    /Users/danielhowells/Sites/sift/src/cli.ts
  </read_first>
  <action>
    Add a money adapter in sift that imports ledger services directly where possible and falls back to ledger CLI invocation only if needed.
    Implement `sift money balance` and `sift money transactions` first, preserving JSON output and filter flags from the spec.
    Return structured degradation errors when ledger is unavailable rather than crashing the whole command.
  </action>
  <test_code>
    import { describe, expect, it } from "vitest";
    import { buildMoneyUnavailable } from "./money";

    describe("buildMoneyUnavailable", () => {
      it("returns a stable offledger/ledger unavailable payload", () => {
        expect(buildMoneyUnavailable("ledger")).toEqual({
          error: "ledger not available",
          source: "ledger",
        });
      });
    });
  </test_code>
  <verify>
    cd /Users/danielhowells/Sites/sift && pnpm vitest run src/lib/money.integration.test.ts — all pass
    cd /Users/danielhowells/Sites/sift && pnpm tsc --noEmit — no type errors
  </verify>
  <done>Sift exposes working money balance and transactions commands through ledger</done>
  <commit>feat(sift): add money balance and transactions via ledger</commit>
</task>

<task id="11" depends="8,9,10" type="auto">
  <name>Implement sift today aggregation with partial-failure handling</name>
  <files>
    <create>/Users/danielhowells/Sites/sift/src/lib/today.ts</create>
    <create>/Users/danielhowells/Sites/sift/src/lib/today.test.ts</create>
    <modify>/Users/danielhowells/Sites/sift/src/lib/types.ts</modify>
    <modify>/Users/danielhowells/Sites/sift/src/cli.ts</modify>
  </files>
  <read_first>
    /Users/danielhowells/Sites/sift/src/lib/pipeline.ts
    /Users/danielhowells/Sites/sift/src/lib/reminders.ts
    /Users/danielhowells/Sites/sift/src/lib/money.ts
    /Users/danielhowells/Sites/sift/docs/arc/specs/sift-v2.md
  </read_first>
  <action>
    Implement `sift today` as a per-domain aggregator that independently fetches calendar, actions, money, reminders, and linear summary sections with timeouts and error isolation.
    Reuse the existing email/reminder pipeline for actions and reminders.
    If any domain fails, include an `{ error }` object in that section and keep the rest of the response intact.
  </action>
  <test_code>
    import { describe, expect, it } from "vitest";
    import { aggregateToday } from "./today";

    describe("aggregateToday", () => {
      it("preserves successful sections when one domain fails", async () => {
        const result = await aggregateToday({
          calendar: async () => [{ title: "Call", time: "10:00" }],
          money: async () => {
            throw new Error("ledger not available");
          },
        } as never);

        expect(result.calendar).toHaveLength(1);
        expect(result.money).toEqual({ error: "ledger not available" });
      });
    });
  </test_code>
  <verify>
    cd /Users/danielhowells/Sites/sift && pnpm vitest run src/lib/today.test.ts — all pass
    cd /Users/danielhowells/Sites/sift && pnpm tsc --noEmit — no type errors
  </verify>
  <done>Sift exposes a resilient today briefing command with partial-failure semantics</done>
  <commit>feat(sift): add unified today briefing with resilient aggregation</commit>
</task>

<task id="12" depends="8" type="auto">
  <name>Add the remaining v2 subcommand foundations and discovery help</name>
  <files>
    <create>/Users/danielhowells/Sites/sift/src/lib/linear.ts</create>
    <create>/Users/danielhowells/Sites/sift/src/lib/calendar.ts</create>
    <create>/Users/danielhowells/Sites/sift/src/lib/reminders-cli.ts</create>
    <create>/Users/danielhowells/Sites/sift/src/lib/linear.test.ts</create>
    <modify>/Users/danielhowells/Sites/sift/src/lib/config.ts</modify>
    <modify>/Users/danielhowells/Sites/sift/src/cli.ts</modify>
    <modify>/Users/danielhowells/Sites/sift/src/lib/cache.ts</modify>
  </files>
  <read_first>
    /Users/danielhowells/Sites/sift/src/lib/config.ts
    /Users/danielhowells/Sites/sift/src/cli.ts
    /Users/danielhowells/Sites/sift/CONTEXT.md
  </read_first>
  <action>
    Add initial `linear`, `cal`, and top-level `remind` command foundations with stable JSON contracts.
    Implement `sift help --json` so it describes wrapped subcommands plus the non-wrapped tool discovery list from the spec.
    Cache Linear issue lookups in SQLite with explicit invalidation on update commands.
  </action>
  <test_code>
    import { describe, expect, it } from "vitest";
    import { buildToolDiscovery } from "./linear";

    describe("help discovery", () => {
      it("includes non-wrapped tools", () => {
        const tools = buildToolDiscovery();
        expect(tools.some((tool) => tool.name === "gh")).toBe(true);
        expect(tools.some((tool) => tool.name === "vercel")).toBe(true);
      });
    });
  </test_code>
  <verify>
    cd /Users/danielhowells/Sites/sift && pnpm vitest run src/lib/linear.test.ts src/cli.test.ts — all pass
    cd /Users/danielhowells/Sites/sift && pnpm tsc --noEmit — no type errors
  </verify>
  <done>Sift exposes the v2 command tree foundations and JSON discovery metadata for wrapped and direct tools</done>
  <commit>feat(sift): add remaining v2 command foundations and discovery help</commit>
</task>
