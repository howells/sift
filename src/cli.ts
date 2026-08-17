/**
 * CLI surface for agent consumption.
 * All output is structured and sanitized for agent use.
 * Exit codes: 0 = success, 1 = error, 2 = validation error.
 */

import {
  findSiftTodo,
  getSiftStatus,
  loadSiftData,
  previewTodoAction,
  refreshSiftData,
  runTodoAction,
  selectTodos,
} from "./lib/actions.ts";
import {
  applyFieldMaskToArray,
  applyFieldMaskToObject,
  getIntegerFlag,
  paginate,
  readJsonInput,
  sanitizeForAgentOutput,
  writeAgentOutput,
} from "./lib/agent.ts";
import type { CommandSchema } from "./lib/agent.ts";
import { getAccountGroupsList } from "./lib/auth.ts";
import { validateFields, validateGroup, validateId } from "./lib/validate.ts";

const VERSION = "0.3.0";
const SUPPORTED_FORMATS = ["json", "ndjson"] as const;
const STATUS_FIELDS = [
  "accounts",
  "cache",
  "config",
  "gogAvailable",
  "groups",
  "securityPosture",
] as const;
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
  "actionType",
  "urgency",
  "reasoning",
  "date",
  "isStarred",
  "person",
  "deadline",
  "source",
] as const;

interface ParsedArgs {
  args: string[];
  command: string;
  commandPath: string[];
  flags: Map<string, string | true>;
}

const DOMAIN_SUBCOMMANDS: Record<string, Set<string>> = {
  email: new Set(["list", "done", "star", "open", "refresh", "status"]),
};

export const COMMAND_SCHEMAS: Record<string, CommandSchema> = {
  describe: {
    args: [
      {
        description: "Optional command key to inspect",
        name: "command",
        required: false,
        type: "string",
      },
    ],
    description: "Return machine-readable command schemas",
    examples: ["sift describe", "sift describe list"],
    flags: {},
    kind: "meta",
    output: {
      supportsFields: false,
      supportsNdjson: false,
      supportsPagination: false,
      type: "object",
    },
  },
  done: {
    args: [
      {
        description: "Todo or thread identifier",
        name: "id",
        required: false,
        type: "string",
      },
    ],
    description: "Mark a todo as done",
    examples: [
      "sift done 19d42c92f393e035 --dry-run",
      'sift done --input=\'{"id":"19d42c92f393e035"}\' --dry-run',
    ],
    flags: {
      "dry-run": {
        description: "Preview the action without side effects",
        type: "boolean",
      },
      input: {
        description: "Raw JSON object or '-' for stdin",
        type: "object",
      },
    },
    input: {
      description: "Raw payload with at least an id field",
      required: false,
      type: "json",
    },
    kind: "write",
    output: {
      supportsFields: false,
      supportsNdjson: false,
      supportsPagination: false,
      type: "object",
    },
  },
  help: {
    args: [],
    description: "Show command summary",
    examples: ["sift help"],
    flags: {},
    kind: "meta",
    output: {
      supportsFields: false,
      supportsNdjson: false,
      supportsPagination: false,
      type: "object",
    },
  },
  list: {
    args: [],
    description: "List prioritized todos",
    examples: [
      "sift list --fields=id,summary,urgency --limit=25",
      "sift list --group=personal --format=ndjson",
    ],
    flags: {
      backlog: { description: "Show backlog items", type: "boolean" },
      fields: { description: "Comma-separated todo fields", type: "string" },
      format: {
        description: "Output format",
        enum: [...SUPPORTED_FORMATS],
        type: "string",
      },
      group: { description: "Account group filter", type: "string" },
      limit: { description: "Maximum items to return", type: "integer" },
      offset: { description: "Zero-based item offset", type: "integer" },
      "page-all": {
        description: "Return every page without slicing",
        type: "boolean",
      },
    },
    kind: "read",
    output: {
      fields: [...TODO_FIELDS],
      supportsFields: true,
      supportsNdjson: true,
      supportsPagination: true,
      type: "array",
    },
  },
  open: {
    args: [
      {
        description: "Todo or thread identifier",
        name: "id",
        required: false,
        type: "string",
      },
    ],
    description: "Return a Gmail URL for a todo",
    examples: ["sift open 19d42c92f393e035"],
    flags: {
      input: {
        description: "Raw JSON object or '-' for stdin",
        type: "object",
      },
    },
    input: {
      description: "Raw payload with at least an id field",
      required: false,
      type: "json",
    },
    kind: "read",
    output: {
      supportsFields: false,
      supportsNdjson: false,
      supportsPagination: false,
      type: "object",
    },
  },
  refresh: {
    args: [],
    description: "Clear cache and re-fetch inbox state",
    examples: ["sift refresh --dry-run"],
    flags: {
      "dry-run": {
        description: "Preview the refresh without clearing cache",
        type: "boolean",
      },
    },
    kind: "write",
    output: {
      supportsFields: false,
      supportsNdjson: false,
      supportsPagination: false,
      type: "object",
    },
  },
  star: {
    args: [
      {
        description: "Todo or thread identifier",
        name: "id",
        required: false,
        type: "string",
      },
    ],
    description: "Star an email-backed todo",
    examples: ["sift star 19d42c92f393e035 --dry-run"],
    flags: {
      "dry-run": {
        description: "Preview the action without side effects",
        type: "boolean",
      },
      input: {
        description: "Raw JSON object or '-' for stdin",
        type: "object",
      },
    },
    input: {
      description: "Raw payload with at least an id field",
      required: false,
      type: "json",
    },
    kind: "write",
    output: {
      supportsFields: false,
      supportsNdjson: false,
      supportsPagination: false,
      type: "object",
    },
  },
  status: {
    args: [],
    description: "Show account and cache status",
    examples: ["sift status --fields=config,groups"],
    flags: {
      fields: {
        description: "Comma-separated top-level status fields",
        type: "string",
      },
      format: {
        description: "Output format",
        enum: [...SUPPORTED_FORMATS],
        type: "string",
      },
    },
    kind: "read",
    output: {
      fields: [...STATUS_FIELDS],
      supportsFields: true,
      supportsNdjson: false,
      supportsPagination: false,
      type: "object",
    },
  },
};

const HELP_COMMANDS = {
  describe: {
    args: ["[command]"],
    description: "Show machine-readable command schemas",
    flags: [],
  },
  done: {
    args: ["<id>"],
    description: "Mark todo as done",
    flags: ["--dry-run", "--input=JSON|-"],
  },
  "email list": {
    args: [],
    description: "List prioritized todos",
    flags: [
      "--group=...",
      "--fields=...",
      "--limit=...",
      "--offset=...",
      "--page-all",
      "--format=json|ndjson",
      "--backlog",
    ],
  },
  help: { args: [], description: "Show this help", flags: [] },
  list: {
    args: [],
    description: "List prioritized todos",
    flags: [
      "--group=...",
      "--fields=...",
      "--limit=...",
      "--offset=...",
      "--page-all",
      "--format=json|ndjson",
      "--backlog",
    ],
  },
  open: {
    args: ["<id>"],
    description: "Get URL for todo",
    flags: ["--input=JSON|-"],
  },
  refresh: {
    args: [],
    description: "Clear cache and re-fetch",
    flags: ["--dry-run"],
  },
  star: {
    args: ["<id>"],
    description: "Star email in Gmail",
    flags: ["--dry-run", "--input=JSON|-"],
  },
  status: {
    args: [],
    description: "Show account and cache status",
    flags: ["--fields=..."],
  },
} satisfies Record<string, { args: string[]; description: string; flags: string[] }>;

function jsonOut(data: object, flags?: Map<string, string | true>): void {
  writeAgentOutput(data, flags);
}

function jsonErr(error: string, code = "ERROR"): never {
  process.stderr.write(`${JSON.stringify(sanitizeForAgentOutput({ code, error }))}\n`);
  process.exit(1);
}

function validationErr(error: string): never {
  process.stderr.write(
    `${JSON.stringify(sanitizeForAgentOutput({ code: "VALIDATION_ERROR", error }))}\n`,
  );
  process.exit(2);
}

function getReadOptions(
  flags: Map<string, string | true>,
  validFields: readonly string[],
): {
  error?: string;
  fields?: string;
  format?: string;
  limit: number | null;
  offset: number | null;
  pageAll: boolean;
} {
  const fields =
    typeof flags.get("fields") === "string" ? (flags.get("fields") as string) : undefined;
  if (fields) {
    const result = validateFields(fields, [...validFields]);
    if (!result.valid) {
      return {
        error: result.error,
        limit: null,
        offset: null,
        pageAll: false,
      };
    }
  }

  const limit = getIntegerFlag(flags, "limit");
  const offset = getIntegerFlag(flags, "offset");

  if (flags.has("limit") && limit === null) {
    return {
      error: "limit must be a non-negative integer",
      limit: null,
      offset: null,
      pageAll: false,
    };
  }

  if (flags.has("offset") && offset === null) {
    return {
      error: "offset must be a non-negative integer",
      limit: null,
      offset: null,
      pageAll: false,
    };
  }

  const format =
    typeof flags.get("format") === "string" ? (flags.get("format") as string) : undefined;
  if (format && !SUPPORTED_FORMATS.includes(format as (typeof SUPPORTED_FORMATS)[number])) {
    return {
      error: `format must be one of: ${SUPPORTED_FORMATS.join(", ")}`,
      limit: null,
      offset: null,
      pageAll: false,
    };
  }

  return { fields, format, limit, offset, pageAll: flags.has("page-all") };
}

function shapeArrayOutput<T extends object>(
  items: T[],
  flags: Map<string, string | true>,
  validFields: readonly string[],
  extra: Record<string, unknown> = {},
): void {
  const options = getReadOptions(flags, validFields);
  if (options.error) {
    validationErr(options.error);
  }

  const masked = applyFieldMaskToArray(items, options.fields);
  const paged = paginate(masked, options);

  jsonOut(
    {
      ...extra,
      items: paged.items,
      page: paged.page,
    },
    flags,
  );
}

function shapeObjectOutput(
  input: Record<string, unknown>,
  flags: Map<string, string | true>,
  validFields: readonly string[],
): void {
  const options = getReadOptions(flags, validFields);
  if (options.error) {
    validationErr(options.error);
  }

  jsonOut(applyFieldMaskToObject(input, options.fields), flags);
}

export function parseArgs(argv: string[]): ParsedArgs {
  const first = argv[0] || "help";
  const second = argv[1];
  const commandPath =
    DOMAIN_SUBCOMMANDS[first]?.has(second ?? "") && second && !second.startsWith("-")
      ? [first, second]
      : [first];
  const command = commandPath.join(":");
  const args: string[] = [];
  const flags = new Map<string, string | true>();

  for (let i = commandPath.length; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) {
      continue;
    }

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

  return { args, command, commandPath, flags };
}

async function resolveIdInput(
  args: string[],
  flags: Map<string, string | true>,
): Promise<{ id: string; payload: Record<string, unknown> | null }> {
  const payload = await readJsonInput(flags);
  const payloadId = typeof payload?.id === "string" ? payload.id : null;
  const id = args[0] ?? payloadId;

  if (!id) {
    validationErr('An id argument or JSON payload with {"id": ...} is required');
  }

  const idCheck = validateId(id);
  if (!idCheck.valid) {
    validationErr(idCheck.error);
  }

  return { id, payload };
}

async function cmdList(flags: Map<string, string | true>): Promise<void> {
  const group = typeof flags.get("group") === "string" ? (flags.get("group") as string) : undefined;
  const showBacklog = flags.has("backlog");

  if (group) {
    const groups = getAccountGroupsList();
    const result = validateGroup(group, groups);
    if (!result.valid) {
      validationErr(result.error);
    }
  }

  const data = await loadSiftData((step, message, detail) => {
    process.stderr.write(`${JSON.stringify({ progress: { detail, message, step } })}\n`);
  });

  shapeArrayOutput(
    selectTodos(data, {
      group,
      view: showBacklog ? "backlog" : "active",
    }),
    flags,
    TODO_FIELDS,
    {
      groups: data.groups,
      view: showBacklog ? "backlog" : "active",
    },
  );
}

async function cmdDone(args: string[], flags: Map<string, string | true>): Promise<void> {
  const { id } = await resolveIdInput(args, flags);
  const dryRun = flags.has("dry-run");
  const data = await loadSiftData();
  const todo = findSiftTodo(data, id);

  if (!todo) {
    jsonErr(`Todo not found: ${id}`, "NOT_FOUND");
  }

  if (dryRun) {
    jsonOut(previewTodoAction("done", todo), flags);
    return;
  }

  jsonOut(await runTodoAction("done", todo, data), flags);
}

async function cmdStar(args: string[], flags: Map<string, string | true>): Promise<void> {
  const { id } = await resolveIdInput(args, flags);
  const dryRun = flags.has("dry-run");
  const data = await loadSiftData();
  const todo = findSiftTodo(data, id);

  if (!todo) {
    jsonErr(`Todo not found: ${id}`, "NOT_FOUND");
  }

  if (dryRun) {
    jsonOut(previewTodoAction("star", todo), flags);
    return;
  }

  jsonOut(await runTodoAction("star", todo, data), flags);
}

async function cmdOpen(args: string[], flags: Map<string, string | true>): Promise<void> {
  const { id } = await resolveIdInput(args, flags);
  const data = await loadSiftData();
  const todo = findSiftTodo(data, id);

  if (!todo) {
    jsonErr(`Todo not found: ${id}`, "NOT_FOUND");
  }

  const result = await runTodoAction("open", todo, data);
  if (result.success && result.error) {
    jsonOut({ action: "open", id: todo.id, success: true, url: result.error }, flags);
    return;
  }

  jsonOut(result, flags);
}

function cmdStatus(flags: Map<string, string | true>): void {
  shapeObjectOutput(getSiftStatus(), flags, STATUS_FIELDS);
}

async function cmdRefresh(flags: Map<string, string | true>): Promise<void> {
  if (flags.has("dry-run")) {
    jsonOut(
      {
        action: "refresh",
        dryRun: true,
        wouldDo: ["Clear cache", "Fetch fresh Gmail state", "Re-run Claude analysis"],
      },
      flags,
    );
    return;
  }

  const result = await refreshSiftData((step, message, detail) => {
    process.stderr.write(`${JSON.stringify({ progress: { detail, message, step } })}\n`);
  });

  jsonOut(
    {
      ...result,
      refreshed: true,
    },
    flags,
  );
}

function getDescribePayload(command?: string): Record<string, unknown> {
  if (!command) {
    return {
      commands: COMMAND_SCHEMAS,
      fields: TODO_FIELDS,
      version: VERSION,
    };
  }

  const normalized = command.replace(":", ".");
  const schema = COMMAND_SCHEMAS[normalized];
  if (!schema) {
    throw new Error(`Unknown command schema: ${command}`);
  }

  return {
    command: normalized,
    schema,
    version: VERSION,
  };
}

function cmdHelp(): void {
  const isJson = !process.stdout.isTTY;

  if (isJson) {
    jsonOut({
      commands: HELP_COMMANDS,
      defaults: {
        nonTtyOutput: "json",
        supportedFormats: SUPPORTED_FORMATS,
      },
      fields: TODO_FIELDS,
      version: VERSION,
    });
    return;
  }

  console.log(`
sift - AI-powered email triage

Commands:
  sift                  Start the interactive TUI
  sift list             List prioritized todos
  sift done <id>        Mark todo as done
  sift star <id>        Star email in Gmail
  sift open <id>        Get email URL
  sift refresh          Clear cache and re-fetch
  sift status           Show account and cache status
  sift describe         Show machine-readable command schemas
  sift help             Show this help

Agent flags:
  --fields=<f1,f2,...>  Select specific fields
  --limit=<n>           Page read results
  --offset=<n>          Offset paged reads
  --format=ndjson       Stream item records as NDJSON
  --dry-run             Preview mutation without executing
  --input=JSON|-        Pass raw JSON payload or read it from stdin

Examples:
  sift list --fields=id,summary,urgency --limit=20
  sift done --input='{"id":"19d42c92f393e035"}' --dry-run
  sift describe list
`);
}

/** Entry point for the CLI -- dispatches to the appropriate command handler. */
export async function runCli(argv: string[]): Promise<void> {
  const { command, args, flags } = parseArgs(argv);

  try {
    switch (command) {
      case "email:list":
      case "list":
      case "ls": {
        await cmdList(flags);
        break;
      }
      case "email:done":
      case "done": {
        await cmdDone(args, flags);
        break;
      }
      case "email:star":
      case "star": {
        await cmdStar(args, flags);
        break;
      }
      case "email:open":
      case "open": {
        await cmdOpen(args, flags);
        break;
      }
      case "status": {
        cmdStatus(flags);
        break;
      }
      case "refresh": {
        await cmdRefresh(flags);
        break;
      }
      case "describe": {
        jsonOut(getDescribePayload(args[0]), flags);
        break;
      }
      case "help":
      case "--help":
      case "-h": {
        cmdHelp();
        break;
      }
      default: {
        jsonErr(`Unknown command: ${command}. Run 'sift help' for usage.`);
      }
    }
  } catch (error) {
    jsonErr(error instanceof Error ? error.message : "Unknown error");
  }
}
