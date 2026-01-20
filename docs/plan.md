# sift

**Sift through your email. Surface what matters.**

A terminal UI that extracts time-aware todos from your Gmail accounts, powered by Claude Code.

---

## The Problem

You have hundreds of starred/unread emails across 3 Gmail accounts. Some are urgent, some are stale, and you can't tell which is which. An email from 7 days ago saying "can we meet next week?" is now overdue, but it looks the same as everything else.

## The Solution

An Ink-based CLI that:
1. Fetches starred + unread emails from all accounts
2. Uses Claude Code to analyze with time-awareness
3. Presents a prioritized todo list in a navigable UI
4. Lets you act on items via natural language commands
5. Integrates with Obsidian for task capture

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         sift (Ink CLI)                              │
│                                                                     │
│  Direct Gmail API:                 Shell out to Claude Code:        │
│  • Fetch starred/unread            • Analyze emails → todos         │
│  • Display UI                      • Natural language commands      │
│  • Star/unstar/archive             • Search query translation       │
│  • Open in browser                 • Obsi integration               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                │                                    │
                ▼                                    ▼
┌───────────────────────────────┐    ┌───────────────────────────────┐
│      Gmail API (direct)       │    │      Claude Code CLI          │
│                               │    │                               │
│  Uses OAuth tokens from:      │    │  Only for LLM reasoning:      │
│  • credentials/               │    │  • "Which emails need action?"│
│                               │    │  • "forward to sarah"         │
│  Fast, no LLM overhead        │    │  • "emails from peter in sept"│
└───────────────────────────────┘    └───────────────────────────────┘

Accounts:
• daniel.howells@gmail.com (personal)
• daniel@danielhowells.com (danielhowells)
• daniel@howellsstudio.com (work)
• mail@siteinspire.com (siteinspire)
```

---

## UI Design

### Main View
```
┌─────────────────────────────────────────────────────────────────────┐
│  sift                                    [1] Personal [2] Work [3]SI│
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  🔴 OVERDUE (2)                                                     │
│  › Catch up with Sarah (7d ago, asked for "next week")             │
│    Review proposal from Tom (10d ago, deadline was Friday)          │
│                                                                     │
│  🟡 THIS WEEK (3)                                                   │
│    Pay Acme Corp invoice (deadline Friday mentioned)                │
│    Reply to Mom re: Sunday lunch                                    │
│    Schedule dentist appointment                                     │
│                                                                     │
│  ⚪ WHEN YOU CAN (5)                                                │
│    Read article from Dan                                            │
│    ...                                                              │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  [↑↓] Nav  [Enter] Open  [d] Done→Obsi  [x] Dismiss  [/] Command   │
│  [b] Backlog (247)  [r] Refresh  [o] Send to Obsi  [q] Quit        │
└─────────────────────────────────────────────────────────────────────┘
```

### Command Prompt
```
┌─────────────────────────────────────────────────────────────────────┐
│  › Catch up with Sarah                                              │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ > forward to daniel@howellsstudio.com "please schedule"     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  [Enter] Execute  [Esc] Cancel                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Backlog View
```
┌─────────────────────────────────────────────────────────────────────┐
│  sift › BACKLOG                          247 items, oldest first    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Page 1/13                                                          │
│                                                                     │
│  [ ] Newsletter from Dense Discovery (84d ago)                      │
│  [x] GitHub: PR review requested (72d ago)                          │
│  [x] Receipt from Amazon (61d ago)                                  │
│  [ ] "Quick question" from Tom (65d ago)                            │
│  ...                                                                │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  [Space] Select  [a] All  [X] Dismiss selected  [n/p] Page         │
│  [Esc] Back                                                         │
└─────────────────────────────────────────────────────────────────────┘
```

### Search View
```
┌─────────────────────────────────────────────────────────────────────┐
│  sift › SEARCH                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  > emails from peter adams in september 2025                        │
│                                                                     │
│  Query: from:peter.adams after:2025/09/01 before:2025/10/01        │
│                                                                     │
│  Found 7 results:                                                   │
│  › Re: Project proposal - Sep 23                                    │
│    Invoice #4521 - Sep 15                                           │
│    Quick question about deadline - Sep 8                            │
│    ...                                                              │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  [↑↓] Nav  [Enter] Open  [Esc] Back  [*] Star  [/] New search      │
└─────────────────────────────────────────────────────────────────────┘
```

**Natural language → Gmail query examples:**
- `emails from peter adams in september 2025` → `from:peter.adams after:2025/09/01 before:2025/10/01`
- `invoices from last month` → `subject:invoice after:2024/12/01 before:2025/01/01`
- `unread with attachments` → `is:unread has:attachment`
- `anything about the bergmeyer project` → `bergmeyer OR "bergmeyer project"`
- `emails I sent to sarah` → `to:sarah from:me`

---

## Key Actions

| Key | Action | Gmail Effect | Obsi Effect |
|-----|--------|--------------|-------------|
| `d` | Done | Unstar | Prompt to add note, save to daily note |
| `x` | Dismiss | Unstar | Nothing |
| `o` | Send to Obsi | Keep starred | Add to daily note/tasks |
| `Enter` | Open | - | Opens in browser |
| `/` | Command | Varies | Natural language action |
| `s` | Search | - | Natural language email search |

### Command Examples
- `forward to sarah@x.com` → Forward email
- `forward to sarah@x.com "please review"` → Forward with note
- `reply "thanks, will do"` → Send reply
- `archive` → Archive email
- `snooze until friday` → Label + reminder
- `label invoices` → Add label

---

## Technical Stack

```
sift/
├── src/
│   ├── app.tsx                 # Main Ink app
│   ├── components/
│   │   ├── TodoList.tsx        # Main todo list view
│   │   ├── TodoItem.tsx        # Single todo item
│   │   ├── Backlog.tsx         # Backlog view
│   │   ├── Search.tsx          # Natural language search
│   │   ├── CommandPrompt.tsx   # Natural language input
│   │   ├── ConfirmDialog.tsx   # Confirm before send (forward/reply)
│   │   ├── Spinner.tsx         # Loading state during Claude calls
│   │   ├── StatusBar.tsx       # Keybindings footer
│   │   └── AccountTabs.tsx     # Account switcher
│   ├── hooks/
│   │   ├── useClaude.ts        # Shell out to claude CLI (analysis only)
│   │   ├── useKeyboard.ts      # Keyboard handling
│   │   ├── useGmail.ts         # Direct Gmail API access
│   │   └── useTodos.ts         # Todo state management
│   ├── lib/
│   │   ├── gmail.ts            # Gmail API client (shared with auth)
│   │   ├── auth.ts             # OAuth handling
│   │   ├── claude.ts           # Claude CLI wrapper (stdin-based)
│   │   ├── types.ts            # TypeScript types
│   │   └── prompts.ts          # Prompt templates for analysis
│   └── index.tsx               # Entry point
├── credentials/                # OAuth tokens (gitignored)
├── package.json
├── tsconfig.json
└── docs/
    └── plan.md                 # This file
```

### Dependencies

**Ink CLI:**
- `ink` - React for CLI
- `ink-text-input` - Text input component
- `ink-select-input` - Selection component
- `zustand` - State management
- `open` - Open URLs in browser
- `clipboardy` - Copy to clipboard

**MCP Server:**
- `@modelcontextprotocol/sdk` - MCP SDK
- `googleapis` - Gmail API
- `google-auth-library` - OAuth

---

## Implementation Phases

### Phase 1: Gmail MCP Server
1. Set up Google Cloud project + OAuth credentials
2. Build MCP server with basic tools:
   - `gmail_list_starred`
   - `gmail_list_unread`
   - `gmail_get_thread`
   - `gmail_unstar`
3. Test with Claude Code directly

### Phase 2: Core Ink UI
1. Scaffold Ink app
2. Build TodoList component
3. Implement Claude CLI wrapper for todo extraction
4. Basic keyboard navigation
5. Open in browser action

### Phase 3: Actions
1. Done action (unstar + Obsi prompt)
2. Dismiss action (unstar)
3. Send to Obsi action
4. Account switching

### Phase 4: Command Prompt
1. Command input UI
2. Route commands to Claude Code
3. Implement forward, reply, archive via MCP

### Phase 5: Backlog
1. Backlog view with pagination
2. Multi-select
3. Batch dismiss
4. Smart pre-selection of obvious dismissals

### Phase 6: Search
1. Search input UI
2. Natural language → Gmail query translation via Claude
3. Search results display
4. Actions on search results (star, open, etc.)

---

## OAuth Setup (Manual Step)

Before the MCP server works, you need to:

1. Go to Google Cloud Console
2. Create project "sift"
3. Enable Gmail API
4. Create OAuth 2.0 credentials (Desktop app)
5. Download credentials.json to `mcp-server/credentials/`
6. First run will open browser for auth for each account

---

## Design Decisions (Post-Review)

### Why Shell Out to Claude Code?

Calling MCP servers directly from Node would require API calls (OpenRouter/Anthropic), which cost money per request. By shelling out to `claude` CLI, all LLM operations go through the existing Claude Code subscription at no incremental cost.

**Tradeoff accepted:** Higher latency per operation (process spawn overhead) in exchange for zero API costs.

### Todo → Email ID Mapping

Claude's analysis returns structured data that includes email IDs:

```typescript
interface AnalysisResult {
  todos: {
    id: string;           // Generated todo ID
    emailId: string;      // Gmail thread ID
    account: string;      // Which account
    summary: string;      // "Catch up with Sarah"
    urgency: 'overdue' | 'this_week' | 'when_you_can';
    reasoning: string;    // "Asked for 'next week' 7 days ago"
  }[];
}
```

Ink stores this mapping in state. When user presses `d` on a todo, we know exactly which `gmail_unstar(emailId)` to call.

### Shell Command Safety

**Never interpolate email content into shell commands.**

Bad:
```typescript
execSync(`claude -p "Analyze: ${emailSubject}"`)  // DANGER: injection risk
```

Good:
```typescript
// Pass data via stdin
const child = spawn('claude', ['-p', '-']);
child.stdin.write(JSON.stringify({ emails }));
child.stdin.end();
```

Or use a temp file for large payloads.

### Confirmation Before Send

Any outbound action (forward, reply) requires explicit confirmation:

```
┌─────────────────────────────────────────────────────────────────┐
│  CONFIRM FORWARD                                                │
│                                                                 │
│  To: daniel@howellsstudio.com                                   │
│  Message: "please handle this"                                  │
│                                                                 │
│  Original: Invoice overdue - Acme Corp                          │
│                                                                 │
│  [Enter] Send    [Esc] Cancel                                   │
└─────────────────────────────────────────────────────────────────┘
```

No email leaves without the user pressing Enter on a confirmation screen.

### Latency Handling

Shell-out operations will take 1-3 seconds. The UI shows a spinner:

```
┌─────────────────────────────────────────────────────────────────┐
│  sift                                    [1] Personal [2] Work  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                    ◐ Analyzing emails...                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Actions that don't need Claude (open in browser, quit) remain instant.

### Obsidian Integration

Obsi plugin is optional. If not configured:
- `[d] Done` simply unstars (no Obsi prompt)
- `[o] Send to Obsi` shows "Obsi not configured" message

Detection: Check if `claude -p "test obsi"` succeeds or fails.

---

## Open Questions

1. **Snooze implementation** - Gmail doesn't have native snooze API. Options:
   - Use labels + periodic re-check
   - Just push to Obsi with date instead

2. **Rate limits** - With hundreds of emails, may need to batch/cache

3. **Refresh strategy** - Full refresh vs incremental?

4. **Account colors** - Color-code by account in UI?
