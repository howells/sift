/**
 * Core data pipeline — shared by TUI and CLI.
 * Fetches emails, analyzes them, splits into active/backlog.
 */
import type { AccountConfig } from "./auth.ts";
import { getAccountGroupsList, getAccounts } from "./auth.ts";
import { pruneOldEntries, removeCachedAnalysis } from "./cache.ts";
import { analyzeEmails, getActiveProviderLabel } from "./claude.ts";
import { configExists, loadConfig } from "./config.ts";
import type { SiftConfig } from "./config.ts";
import { GmailClient, isGogAvailable } from "./gmail.ts";
import type { Todo } from "./types.ts";

// --- Types ---

export interface SiftData {
  accounts: AccountConfig[];
  active: Todo[];
  backlog: Todo[];
  clients: Map<string, GmailClient>;
  groups: string[];
}

export type ProgressCallback = (step: number, message: string, detail?: string) => void;

// --- Validation ---

/** Check that config and gog are available. */
function validateEnvironment(): {
  config: SiftConfig;
  error: string | null;
} {
  if (!configExists()) {
    return {
      config: null as unknown as SiftConfig,
      error: "No config found. Run 'sift --setup' to configure.",
    };
  }

  if (!isGogAvailable()) {
    return {
      config: null as unknown as SiftConfig,
      error: "'gog' CLI not found. Install it: https://github.com/howells/gog",
    };
  }

  const config = loadConfig();
  if (!config) {
    return {
      config: null as unknown as SiftConfig,
      error: "Failed to load config.",
    };
  }

  return { config, error: null };
}

// --- Core pipeline ---

/** Fetch emails from all accounts, analyze them, and split into active/backlog. */
export async function fetchAndAnalyze(onProgress?: ProgressCallback): Promise<SiftData> {
  const { error } = validateEnvironment();
  if (error) {
    throw new Error(error);
  }

  const accounts = getAccounts();
  const groups = getAccountGroupsList();

  pruneOldEntries(90);

  // Step 1: Connect
  onProgress?.(1, "Connecting to Gmail");
  const clients = new Map<string, GmailClient>();
  for (const account of accounts) {
    clients.set(account.name, new GmailClient(account.email));
  }

  // Step 2: Fetch
  onProgress?.(2, "Fetching emails");
  const allEmails = await Promise.all(
    accounts.map(async (account) => {
      const client = clients.get(account.name);
      if (!client) {
        return { account: account.name, emails: [], group: account.group };
      }
      const [starred, unread] = await Promise.all([
        client.listStarred(200),
        client.listUnread(100),
      ]);
      const starredIds = new Set(starred.map((e) => e.id));
      const combined = [...starred];
      for (const email of unread) {
        if (!starredIds.has(email.id)) {
          combined.push(email);
        }
      }
      return { account: account.name, emails: combined, group: account.group };
    }),
  );

  // Step 3: Analyze
  const totalEmails = allEmails.reduce((sum, a) => sum + a.emails.length, 0);
  const analyzingLabel = `Analyzing with ${getActiveProviderLabel()}`;
  onProgress?.(3, analyzingLabel, `${totalEmails} emails`);

  const result = await analyzeEmails(allEmails, new Date(), (cached, toAnalyze) => {
    if (toAnalyze === 0) {
      onProgress?.(3, analyzingLabel, `All ${cached} from cache`);
    } else if (cached > 0) {
      onProgress?.(3, analyzingLabel, `${cached} cached, analyzing ${toAnalyze} new`);
    } else {
      onProgress?.(3, analyzingLabel, `Analyzing ${toAnalyze} emails`);
    }
  });

  // Split into active/backlog
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const active: Todo[] = [];
  const backlog: Todo[] = [];

  for (const todo of result.todos) {
    if (new Date(todo.date) < thirtyDaysAgo) {
      backlog.push(todo);
    } else {
      active.push(todo);
    }
  }

  return { accounts, active, backlog, clients, groups };
}

// --- Actions (stateless, for CLI use) ---

const urgencyOrder = { overdue: 0, this_week: 1, when_you_can: 2 };

/** Sort todos by urgency: overdue first, then this_week, then when_you_can. */
export function sortByUrgency(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);
}

/** Filter todos to only those belonging to a specific account group. */
export function filterByGroup(todos: Todo[], group: string): Todo[] {
  return todos.filter((t) => t.group === group);
}

export interface ActionResult {
  action: string;
  error?: string;
  id: string;
  success: boolean;
}

/** Find a todo by its ID, email ID, or thread ID. */
export function findTodoById(todos: Todo[], id: string): Todo | undefined {
  return todos.find((t) => t.id === id || t.emailId === id || t.threadId === id);
}

/** Mark a todo as done: unstar and mark read in Gmail. */
export async function executeDone(
  todo: Todo,
  clients: Map<string, GmailClient>,
): Promise<ActionResult> {
  if (todo.source === "email" && todo.emailId) {
    const client = clients.get(todo.account);
    if (!client) {
      return {
        action: "done",
        error: `No client for account: ${todo.account}`,
        id: todo.id,
        success: false,
      };
    }

    // Both are spawnSync-backed, so they are already resolved values.
    const unstarred = client.unstar(todo.emailId);
    const read = client.markRead(todo.emailId);

    if (unstarred && read) {
      removeCachedAnalysis(todo.emailId);
    }

    return { action: "done", id: todo.id, success: unstarred && read };
  }

  return {
    action: "done",
    error: "Unknown source",
    id: todo.id,
    success: false,
  };
}

/** Star an email-backed todo in Gmail. */
export function executeStar(todo: Todo, clients: Map<string, GmailClient>): ActionResult {
  if (!todo.emailId) {
    return {
      action: "star",
      error: "No email ID",
      id: todo.id,
      success: false,
    };
  }

  const client = clients.get(todo.account);
  if (!client) {
    return {
      action: "star",
      error: `No client for account: ${todo.account}`,
      id: todo.id,
      success: false,
    };
  }

  const success = client.star(todo.emailId);
  return { action: "star", id: todo.id, success };
}

/** Return a Gmail web URL for a todo's thread. */
export function executeOpen(todo: Todo, clients: Map<string, GmailClient>): ActionResult {
  if (!todo.threadId) {
    return {
      action: "open",
      error: "No thread ID",
      id: todo.id,
      success: false,
    };
  }

  const client = clients.get(todo.account);
  if (!client) {
    return {
      action: "open",
      error: `No client for account: ${todo.account}`,
      id: todo.id,
      success: false,
    };
  }

  return {
    action: "open",
    id: todo.id,
    success: true,
    // Return URL instead of opening — agent can decide what to do
    error: client.getWebUrl(todo.threadId),
  };
}
