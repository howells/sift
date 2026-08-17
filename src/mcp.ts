import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { ZodRawShape, ZodTypeAny } from "zod";
import { COMMAND_SCHEMAS } from "./cli.ts";
import type { CommandFlagSchema, CommandSchema } from "./lib/agent.ts";
import { runSiftCommand } from "./lib/runner.ts";

const VERSION = "0.2.0";
const SERVER_NAME = "sift";

// Flags that the MCP surface deliberately hides:
// - `format` (always JSON; NDJSON is meaningless for a single tool result)
// - `input` (redundant with the structured tool parameters)
const HIDDEN_FLAGS = new Set<string>(["format", "input"]);

// Meta commands that should not be exposed as MCP tools.
const SKIPPED_COMMANDS = new Set<string>(["help"]);

interface SiftToolDefinition {
  annotations: {
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
    readOnlyHint: boolean;
    title: string;
  };
  commandKey: string;
  description: string;
  inputSchema: ZodRawShape;
  name: string;
  schema: CommandSchema;
}

function toMcpToolName(commandKey: string): string {
  const sanitized = commandKey.replaceAll(/[.:]/g, "_").replaceAll("-", "_");
  return `sift_${sanitized}`;
}

function commandKeyToArgv(commandKey: string): string[] {
  return commandKey.split(".");
}

function buildFlagSchema(flag: CommandFlagSchema): ZodTypeAny {
  let schema: ZodTypeAny;

  switch (flag.type) {
    case "boolean": {
      schema = z.boolean();
      break;
    }
    case "integer": {
      schema = z.number().int().nonnegative();
      break;
    }
    case "object": {
      schema = z.record(z.string(), z.unknown());
      break;
    }
    default: {
      schema = flag.enum ? z.enum(flag.enum as [string, ...string[]]) : z.string();
      break;
    }
  }

  return schema.describe(flag.description);
}

function buildInputSchema(schema: CommandSchema): ZodRawShape {
  const shape: Record<string, ZodTypeAny> = {};

  for (const arg of schema.args) {
    const argSchema = z.string().describe(arg.description);
    shape[arg.name] = arg.required ? argSchema : argSchema.optional();
  }

  for (const [flagName, flag] of Object.entries(schema.flags)) {
    if (HIDDEN_FLAGS.has(flagName)) {
      continue;
    }
    const flagSchema = buildFlagSchema(flag);
    shape[flagName] = flag.required ? flagSchema : flagSchema.optional();
  }

  return shape;
}

function buildToolDescription(schema: CommandSchema): string {
  const lines: string[] = [schema.description];

  if (schema.kind === "write") {
    lines.push(
      "",
      "⚠️  Write surface — pass `dry-run: true` first to preview the action before executing the real mutation.",
    );
  }

  if (schema.output.fields && schema.output.fields.length > 0) {
    lines.push("", `Output fields: ${schema.output.fields.join(", ")}`);
  }

  if (schema.output.supportsFields) {
    lines.push("", "Use `fields` (comma-separated) to keep the response narrow.");
  }

  if (schema.output.supportsPagination) {
    lines.push(
      "",
      "Use `limit` and `offset` for pagination. Only set `page-all: true` when the entire result set is required.",
    );
  }

  if (schema.examples.length > 0) {
    lines.push("", "CLI examples for reference:");
    for (const example of schema.examples) {
      lines.push(`  ${example}`);
    }
  }

  return lines.join("\n");
}

function buildAnnotations(schema: CommandSchema): SiftToolDefinition["annotations"] {
  const isWrite = schema.kind === "write";
  return {
    destructiveHint: isWrite,
    idempotentHint: !isWrite,
    openWorldHint: true,
    readOnlyHint: !isWrite,
    title: schema.description,
  };
}

function buildToolDefinitions(): SiftToolDefinition[] {
  const tools: SiftToolDefinition[] = [];

  for (const [commandKey, schema] of Object.entries(COMMAND_SCHEMAS)) {
    if (SKIPPED_COMMANDS.has(commandKey)) {
      continue;
    }

    tools.push({
      annotations: buildAnnotations(schema),
      commandKey,
      description: buildToolDescription(schema),
      inputSchema: buildInputSchema(schema),
      name: toMcpToolName(commandKey),
      schema,
    });
  }

  return tools;
}

function paramsToArgv(
  commandKey: string,
  schema: CommandSchema,
  params: Record<string, unknown>,
): string[] {
  const argv = commandKeyToArgv(commandKey);

  for (const arg of schema.args) {
    const value = params[arg.name];
    if (value !== undefined && value !== null) {
      argv.push(String(value));
    }
  }

  for (const [flagName, flag] of Object.entries(schema.flags)) {
    if (HIDDEN_FLAGS.has(flagName)) {
      continue;
    }
    const value = params[flagName];
    if (value === undefined || value === null) {
      continue;
    }

    if (flag.type === "boolean") {
      if (value === true) {
        argv.push(`--${flagName}`);
      }
      continue;
    }

    if (flag.type === "object") {
      argv.push(`--${flagName}=${JSON.stringify(value)}`);
      continue;
    }

    argv.push(`--${flagName}=${String(value)}`);
  }

  // Force JSON output regardless of TTY detection while running in MCP mode.
  argv.push("--json");

  return argv;
}

function parseStderrError(stderr: string): {
  code: string;
  error: string;
} | null {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index];
    if (!line) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (typeof parsed.error === "string" && typeof parsed.code === "string") {
        return { code: parsed.code, error: parsed.error };
      }
    } catch {
      // Not JSON, keep walking back
    }
  }

  return null;
}

interface McpToolTextContent {
  text: string;
  type: "text";
}

interface McpToolResult {
  [key: string]: unknown;
  content: McpToolTextContent[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

async function executeTool(
  commandKey: string,
  schema: CommandSchema,
  params: Record<string, unknown>,
): Promise<McpToolResult> {
  const argv = paramsToArgv(commandKey, schema, params);
  const result = await runSiftCommand(argv);

  if (result.exitCode !== 0) {
    const errorPayload = parseStderrError(result.stderr) ?? {
      code: "ERROR",
      error: result.stderr.trim() || `sift exited with code ${result.exitCode}`,
    };

    return {
      content: [
        {
          text: JSON.stringify(errorPayload, null, 2),
          type: "text",
        },
      ],
      isError: true,
    };
  }

  const stdout = result.stdout.trim();
  if (!stdout) {
    return {
      content: [{ text: "{}", type: "text" }],
      structuredContent: {},
    };
  }

  let structuredContent: Record<string, unknown> | undefined;
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      structuredContent = parsed as Record<string, unknown>;
    }
  } catch {
    // Leave structuredContent undefined; agents still get the raw text.
  }

  return {
    content: [{ text: stdout, type: "text" }],
    ...(structuredContent ? { structuredContent } : {}),
  };
}

/**
 * Start the sift MCP stdio server.
 *
 * Registers every command in `COMMAND_SCHEMAS` as an MCP tool, derives Zod
 * schemas from the existing CLI metadata, and routes tool calls through the
 * in-process command runner so we never pay subprocess startup cost.
 */
export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: SERVER_NAME,
    version: VERSION,
  });

  for (const tool of buildToolDefinitions()) {
    server.registerTool(
      tool.name,
      {
        annotations: tool.annotations,
        description: tool.description,
        inputSchema: tool.inputSchema,
        title: tool.schema.description,
      },
      async (params) =>
        await executeTool(tool.commandKey, tool.schema, (params ?? {}) as Record<string, unknown>),
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
