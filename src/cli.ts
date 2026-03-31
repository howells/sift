/**
 * CLI surface for agent consumption.
 * All output is JSON to stdout. Errors are JSON to stderr.
 * Exit codes: 0 = success, 1 = error, 2 = validation error.
 */
import { getAccountGroupsList, getAccounts } from "./lib/auth.ts";
import { clearCache, getCacheStats } from "./lib/cache.ts";
import { configExists, loadConfig } from "./lib/config.ts";
import { isGogAvailable } from "./lib/gmail.ts";
import {
  executeDone,
  executeOpen,
  executeRemind,
  executeStar,
  fetchAndAnalyze,
  filterByGroup,
  findTodoById,
  sortByUrgency,
} from "./lib/pipeline.ts";
import type { Todo } from "./lib/types.ts";
import { validateFields, validateGroup, validateId } from "./lib/validate.ts";

// --- Output helpers ---

function jsonOut(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data)}\n`);
}

function jsonErr(error: string, code = "ERROR"): never {
  process.stderr.write(`${JSON.stringify({ error, code })}\n`);
  process.exit(1);
}

function validationErr(error: string): never {
  process.stderr.write(
    `${JSON.stringify({ error, code: "VALIDATION_ERROR" })}\n`
  );
  process.exit(2);
}

// --- Field mask ---

const TODO_FIELDS = [
  "id",
  "emailId",
  "threadId",
  "account",
  "group",
  "subject",
  "from",
  "fromEmail",
  "summary",
  "urgency",
  "reasoning",
  "date",
  "isStarred",
  "person",
  "deadline",
  "reminderState",
  "source",
  "reminderId",
];

function applyFieldMask(
  todos: Todo[],
  fields: string | undefined
): Record<string, unknown>[] {
  if (!fields) {
    return todos as unknown as Record<string, unknown>[];
  }

  const fieldList = fields.split(",").map((f) => f.trim());
  return todos.map((todo) => {
    const masked: Record<string, unknown> = {};
    for (const field of fieldList) {
      if (field in todo) {
        masked[field] = todo[field as keyof Todo];
      }
    }
    return masked;
  });
}

// --- Arg parsing ---

interface ParsedArgs {
  args: string[];
  command: string;
  flags: Map<string, string | true>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[0] || "help";
  const args: string[] = [];
  const flags = new Map<string, string | true>();

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eqIndex = arg.indexOf("=");
      if (eqIndex > 0) {
        flags.set(arg.slice(2, eqIndex), arg.slice(eqIndex + 1));
      } else {
        flags.set(arg.slice(2), true);
      }
    } else if (arg.startsWith("-")) {
      flags.set(arg.slice(1), true);
    } else {
      args.push(arg);
    }
  }

  return { command, args, flags };
}

// --- Commands ---

async function cmdList(flags: Map<string, string | true>): Promise<void> {
  const group = flags.get("group") as string | undefined;
  const fields = flags.get("fields") as string | undefined;
  const showBacklog = flags.has("backlog");

  // Validate
  if (group) {
    const groups = getAccountGroupsList();
    const result = validateGroup(group, groups);
    if (!result.valid) {
      validationErr(result.error);
    }
  }

  if (fields) {
    const result = validateFields(fields, TODO_FIELDS);
    if (!result.valid) {
      validationErr(result.error);
    }
  }

  const data = await fetchAndAnalyze((step, message, detail) => {
    // In JSON mode, progress goes to stderr so it doesn't pollute stdout
    process.stderr.write(
      `${JSON.stringify({ progress: { step, message, detail } })}\n`
    );
  });

  let todos = showBacklog ? data.backlog : data.active;

  if (group) {
    todos = filterByGroup(todos, group);
  }

  todos = sortByUrgency(todos);

  const output = applyFieldMask(todos, fields);

  jsonOut({
    count: output.length,
    groups: data.groups,
    items: output,
    view: showBacklog ? "backlog" : "active",
  });
}

async function cmdDone(
  args: string[],
  flags: Map<string, string | true>
): Promise<void> {
  const id = args[0];
  if (!id) {
    validationErr("Usage: sift done <id>");
  }

  const idCheck = validateId(id);
  if (!idCheck.valid) {
    validationErr(idCheck.error);
  }

  const dryRun = flags.has("dry-run");
  const data = await fetchAndAnalyze();
  const allTodos = [...data.active, ...data.backlog];
  const todo = findTodoById(allTodos, id);

  if (!todo) {
    jsonErr(`Todo not found: ${id}`, "NOT_FOUND");
  }

  if (dryRun) {
    jsonOut({
      action: "done",
      dryRun: true,
      id: todo.id,
      summary: todo.summary,
      wouldDo: [
        todo.source === "email" ? "Unstar email" : "Complete reminder",
        todo.source === "email" ? "Mark as read" : null,
        todo.reminderState === "none" ? null : "Complete associated reminder",
        todo.source === "email" ? "Remove from cache" : null,
      ].filter(Boolean),
    });
    return;
  }

  const result = await executeDone(todo, data.clients);
  jsonOut(result);
}

async function cmdStar(
  args: string[],
  flags: Map<string, string | true>
): Promise<void> {
  const id = args[0];
  if (!id) {
    validationErr("Usage: sift star <id>");
  }

  const idCheck = validateId(id);
  if (!idCheck.valid) {
    validationErr(idCheck.error);
  }

  const dryRun = flags.has("dry-run");
  const data = await fetchAndAnalyze();
  const allTodos = [...data.active, ...data.backlog];
  const todo = findTodoById(allTodos, id);

  if (!todo) {
    jsonErr(`Todo not found: ${id}`, "NOT_FOUND");
  }

  if (dryRun) {
    jsonOut({
      action: "star",
      dryRun: true,
      id: todo.id,
      summary: todo.summary,
      wouldDo: ["Star email in Gmail"],
    });
    return;
  }

  const result = executeStar(todo, data.clients);
  jsonOut(result);
}

async function cmdRemind(
  args: string[],
  flags: Map<string, string | true>
): Promise<void> {
  const id = args[0];
  if (!id) {
    validationErr("Usage: sift remind <id>");
  }

  const idCheck = validateId(id);
  if (!idCheck.valid) {
    validationErr(idCheck.error);
  }

  const dryRun = flags.has("dry-run");
  const data = await fetchAndAnalyze();
  const allTodos = [...data.active, ...data.backlog];
  const todo = findTodoById(allTodos, id);

  if (!todo) {
    jsonErr(`Todo not found: ${id}`, "NOT_FOUND");
  }

  if (dryRun) {
    jsonOut({
      action: "remind",
      dryRun: true,
      id: todo.id,
      summary: todo.summary,
      wouldDo: [
        "Fetch email thread for context",
        "Generate reminder title with Claude",
        "Create Apple Reminder",
      ],
    });
    return;
  }

  const result = await executeRemind(todo, data.clients);
  jsonOut(result);
}

async function cmdOpen(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    validationErr("Usage: sift open <id>");
  }

  const idCheck = validateId(id);
  if (!idCheck.valid) {
    validationErr(idCheck.error);
  }

  const data = await fetchAndAnalyze();
  const allTodos = [...data.active, ...data.backlog];
  const todo = findTodoById(allTodos, id);

  if (!todo) {
    jsonErr(`Todo not found: ${id}`, "NOT_FOUND");
  }

  const result = executeOpen(todo, data.clients);
  // For agents, return the URL rather than opening a browser
  if (result.success && result.error) {
    jsonOut({ action: "open", id: todo.id, success: true, url: result.error });
  } else {
    jsonOut(result);
  }
}

function cmdStatus(): void {
  const hasConfig = configExists();
  const config = hasConfig ? loadConfig() : null;
  const gogAvailable = isGogAvailable();
  const accounts = hasConfig ? getAccounts() : [];
  const groups = hasConfig ? getAccountGroupsList() : [];
  const cacheStats = getCacheStats();

  jsonOut({
    accounts: accounts.map((a) => ({
      email: a.email,
      group: a.group,
      name: a.name,
    })),
    cache: {
      oldestAnalysis: cacheStats.oldestAnalysis,
      todosCount: cacheStats.todosCount,
      totalCached: cacheStats.totalCached,
    },
    config: hasConfig,
    gogAvailable,
    groups,
    preferClaudeCli: config?.preferClaudeCli ?? false,
  });
}

async function cmdRefresh(): Promise<void> {
  clearCache();
  process.stderr.write(
    `${JSON.stringify({ progress: { step: 0, message: "Cache cleared" } })}\n`
  );

  const data = await fetchAndAnalyze((step, message, detail) => {
    process.stderr.write(
      `${JSON.stringify({ progress: { step, message, detail } })}\n`
    );
  });

  jsonOut({
    activeCount: data.active.length,
    backlogCount: data.backlog.length,
    groups: data.groups,
    refreshed: true,
  });
}

function cmdHelp(): void {
  const isJson = !process.stdout.isTTY;

  if (isJson) {
    jsonOut({
      commands: {
        done: {
          args: ["<id>"],
          description: "Mark todo as done (unstar + mark read)",
          flags: ["--dry-run", "--json"],
        },
        help: { args: [], description: "Show this help", flags: ["--json"] },
        list: {
          args: [],
          description: "List prioritized todos",
          flags: ["--group=<name>", "--fields=<f1,f2>", "--backlog", "--json"],
        },
        open: {
          args: ["<id>"],
          description: "Get URL for todo",
          flags: ["--json"],
        },
        refresh: {
          args: [],
          description: "Clear cache and re-fetch",
          flags: ["--json"],
        },
        remind: {
          args: ["<id>"],
          description: "Create Apple Reminder from todo",
          flags: ["--dry-run", "--json"],
        },
        star: {
          args: ["<id>"],
          description: "Star email in Gmail",
          flags: ["--dry-run", "--json"],
        },
        status: {
          args: [],
          description: "Show account and cache status",
          flags: ["--json"],
        },
      },
      fields: TODO_FIELDS,
      version: "0.2.0",
    });
  } else {
    console.log(`
sift - AI-powered email triage

Commands:
  sift                  Start the interactive TUI
  sift list             List prioritized todos (JSON)
  sift done <id>        Mark todo as done
  sift star <id>        Star email in Gmail
  sift remind <id>      Create Apple Reminder
  sift open <id>        Get email URL
  sift refresh          Clear cache and re-fetch
  sift status           Show account and cache status
  sift help             Show this help

Flags:
  --json                Force JSON output (default in non-TTY)
  --group=<name>        Filter by account group
  --fields=<f1,f2,...>  Select specific fields (protects context window)
  --backlog             Show backlog instead of active items
  --dry-run             Preview action without executing
  --setup               Run setup wizard
  --help, -h            Show this help

Field names:
  ${TODO_FIELDS.join(", ")}

Examples:
  sift list --json --fields=id,summary,urgency,person
  sift done abc123 --dry-run
  sift list --group=personal --fields=id,summary,deadline
`);
  }
}

// --- Router ---

export async function runCli(argv: string[]): Promise<void> {
  const { command, args, flags } = parseArgs(argv);

  try {
    switch (command) {
      case "list":
      case "ls":
        await cmdList(flags);
        break;
      case "done":
        await cmdDone(args, flags);
        break;
      case "star":
        await cmdStar(args, flags);
        break;
      case "remind":
        await cmdRemind(args, flags);
        break;
      case "open":
        await cmdOpen(args);
        break;
      case "status":
        cmdStatus();
        break;
      case "refresh":
        await cmdRefresh();
        break;
      case "help":
      case "--help":
      case "-h":
        cmdHelp();
        break;
      default:
        jsonErr(`Unknown command: ${command}. Run 'sift help' for usage.`);
    }
  } catch (err) {
    jsonErr(err instanceof Error ? err.message : "Unknown error");
  }
}
