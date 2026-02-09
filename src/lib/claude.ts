import Anthropic from "@anthropic-ai/sdk";
import { createClaudeCodeClient, jsonSchemaFromZod } from "@howells/envelope";
import { z } from "zod";
import { cacheAnalysisBatch, getCachedAnalysis, hashEmail } from "./cache.js";
import { loadConfig } from "./config.js";
import type { Email } from "./gmail.js";
import type { AnalysisResult, Todo } from "./types.js";

// --- Zod schemas for model output ---

const EmailTodoSchema = z.object({
  source: z.literal("email"),
  id: z.string(),
  emailId: z.string(),
  threadId: z.string().optional(),
  account: z.string(),
  group: z.string(),
  subject: z.string(),
  from: z.string(),
  fromEmail: z.string(),
  summary: z.string(),
  urgency: z.enum(["overdue", "this_week", "when_you_can"]),
  reasoning: z.string(),
  date: z.string(),
  isStarred: z.boolean(),
  person: z.string(),
  deadline: z.string().nullable(),
});

const EmailAnalysisSchema = z.object({
  todos: z.array(EmailTodoSchema),
});

const CommandSchema = z.object({
  action: z.enum(["forward", "reply", "archive", "snooze", "label", "unknown"]),
  params: z.record(z.string(), z.string()),
});

const ReminderContentSchema = z.object({
  title: z.string(),
  notes: z.string(),
});

export type ReminderContent = z.infer<typeof ReminderContentSchema>;

// Pre-compute JSON schemas at module level (one-time cost)
const emailAnalysisJsonSchema = jsonSchemaFromZod(EmailAnalysisSchema);
const commandJsonSchema = jsonSchemaFromZod(CommandSchema);
const reminderJsonSchema = jsonSchemaFromZod(ReminderContentSchema);

// CLI client — handles spawn, retries, timeout, structured output
const cliClient = createClaudeCodeClient({
  model: "sonnet",
  maxBudgetUsd: 1,
  timeoutMs: 120_000,
  options: {
    retries: 1,
    retryDelayMs: 800,
  },
});

/**
 * Call Anthropic API directly (fallback when CLI unavailable).
 */
async function callAnthropicApi(
  prompt: string,
  apiKey: string
): Promise<string> {
  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });
  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Anthropic API");
  }
  return textBlock.text;
}

/**
 * Call LLM with structured output.
 * Tries Claude CLI (--json-schema for guaranteed structure) first,
 * falls back to Anthropic API with regex JSON extraction.
 */
async function callStructured<T extends z.ZodTypeAny>(
  prompt: string,
  schema: T,
  jsonSchema: ReturnType<typeof jsonSchemaFromZod>
): Promise<z.infer<T>> {
  const config = loadConfig();
  const preferCli = config?.preferClaudeCli !== false;
  const apiKey = config?.anthropicApiKey || process.env.ANTHROPIC_API_KEY;

  if (preferCli) {
    try {
      const result = await cliClient.structured({ prompt, jsonSchema });
      return schema.parse(result.structured);
    } catch (error) {
      if (!apiKey) {
        throw error;
      }
    }
  }

  if (apiKey) {
    const text = await callAnthropicApi(prompt, apiKey);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No valid JSON in API response");
    }
    return schema.parse(JSON.parse(jsonMatch[0]));
  }

  throw new Error(
    "No LLM available. Install Claude CLI or set ANTHROPIC_API_KEY."
  );
}

/**
 * Call LLM for plain text output.
 * Tries Claude CLI first, falls back to Anthropic API.
 */
async function callText(prompt: string): Promise<string> {
  const config = loadConfig();
  const preferCli = config?.preferClaudeCli !== false;
  const apiKey = config?.anthropicApiKey || process.env.ANTHROPIC_API_KEY;

  if (preferCli) {
    try {
      const result = await cliClient.text({ prompt });
      return result.text;
    } catch (error) {
      if (!apiKey) {
        throw error;
      }
    }
  }

  if (apiKey) {
    return await callAnthropicApi(prompt, apiKey);
  }

  throw new Error(
    "No LLM available. Install Claude CLI or set ANTHROPIC_API_KEY."
  );
}

interface EmailWithMeta {
  account: string;
  group: string;
  email: Email;
  hash: string;
}

/**
 * Analyze emails and extract time-aware todos.
 * Uses SQLite cache to avoid re-analyzing unchanged emails.
 */
export async function analyzeEmails(
  emails: { account: string; group: string; emails: Email[] }[],
  today: Date = new Date(),
  onProgress?: (cached: number, toAnalyze: number) => void
): Promise<AnalysisResult> {
  // Flatten and compute hashes
  const allEmails: EmailWithMeta[] = emails.flatMap(
    ({ account, group, emails }) =>
      emails.map((e) => ({
        account,
        group,
        email: e,
        hash: hashEmail(e),
      }))
  );

  // Check cache for each email
  const cachedTodos: Todo[] = [];
  const uncachedEmails: EmailWithMeta[] = [];

  for (const item of allEmails) {
    const cached = getCachedAnalysis(item.email.id, item.hash);
    if (cached) {
      if (cached.isTodo && cached.todo) {
        cachedTodos.push({ ...cached.todo, source: "email" });
      }
    } else {
      uncachedEmails.push(item);
    }
  }

  onProgress?.(cachedTodos.length, uncachedEmails.length);

  if (uncachedEmails.length === 0) {
    return { todos: cachedTodos };
  }

  // Process emails in batches to avoid context overflow
  const BATCH_SIZE = 50;
  const allNewTodos: Todo[] = [];

  for (let i = 0; i < uncachedEmails.length; i += BATCH_SIZE) {
    const batch = uncachedEmails.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(uncachedEmails.length / BATCH_SIZE);

    if (totalBatches > 1) {
      onProgress?.(
        cachedTodos.length + allNewTodos.length,
        uncachedEmails.length - i
      );
    }

    const emailSummaries = batch.map(({ account, group, email: e }) => ({
      account,
      group,
      id: e.id,
      threadId: e.threadId,
      subject: e.subject,
      from: e.from,
      fromEmail: e.fromEmail,
      date: e.date,
      snippet: e.snippet,
      isStarred: e.isStarred,
      isUnread: e.isUnread,
    }));

    const prompt = `You are analyzing emails to extract actionable todos. Today is ${today.toISOString().split("T")[0]}.

For each email, determine:
1. Does this require a response or action from the user? (yes/no)
2. If yes, what's the specific task?
3. Urgency based on TIME AWARENESS:
   - "overdue": The email mentions a deadline/time that has passed, or says things like "next week" but was sent >7 days ago
   - "this_week": Has upcoming deadline this week, or is from an important sender
   - "when_you_can": No time pressure, can be done whenever
4. Extract the PERSON name (first + last if available) the task relates to
5. Extract any DEADLINE mentioned and format as "Ddd Mmm DD" (e.g., "Fri Jan 24")

IMPORTANT: Consider when the email was sent vs what it says. "Can we meet next week?" sent 7 days ago = OVERDUE.

DEADLINE EXTRACTION:
- "this friday" → calculate actual date, format as "Fri Jan 24"
- "by end of week" → Friday of that week
- "next monday" → calculate actual date
- "January 30th" → "Thu Jan 30"
- "tomorrow" → calculate actual date
- "ASAP" or "urgent" → "ASAP"
- No deadline mentioned → null

IMPORTANT: If an email is STARRED, the user marked it for a reason - be INCLUSIVE.
For starred emails, assume they need action unless clearly already handled.

ALWAYS SKIP these low-value automated emails (no matter if starred):
- Security alerts: "Was this you?", "New sign-in", "Suspicious activity", login notifications
- Verification emails: "Verify your email", "Confirm your account"
- Password/2FA: "Reset your password", "Two-factor authentication"
- Generic notifications: From noreply@, no-reply@, notifications@
- Receipts/confirmations for completed transactions (order shipped, payment received)
- Newsletter/marketing even if in inbox

Only include emails that require HUMAN RESPONSE or DECISION from the user.

Emails to analyze (batch ${batchNum}/${totalBatches}):
${JSON.stringify(emailSummaries, null, 2)}`;

    const result = await callStructured(
      prompt,
      EmailAnalysisSchema,
      emailAnalysisJsonSchema
    );
    const batchTodos: Todo[] = result.todos.map((todo) => ({
      ...todo,
      source: "email" as const,
      reminderState: "none" as const,
    }));

    // Build map for cache lookup
    const todosByEmailId = new Map<string, Todo>();
    for (const todo of batchTodos) {
      if (todo.emailId) {
        todosByEmailId.set(todo.emailId, todo);
      }
    }

    // Cache this batch's results (both todos and non-todos)
    const cacheEntries = batch.map((item) => {
      const todo = todosByEmailId.get(item.email.id);
      return {
        emailId: item.email.id,
        account: item.account,
        threadId: item.email.threadId,
        emailHash: item.hash,
        isTodo: !!todo,
        todo: todo || null,
      };
    });

    cacheAnalysisBatch(cacheEntries);
    allNewTodos.push(...batchTodos);
  }

  return { todos: [...cachedTodos, ...allNewTodos] };
}

/**
 * Translate natural language search to Gmail query syntax.
 */
export async function translateSearch(query: string): Promise<string> {
  const prompt = `Translate this natural language email search into Gmail query syntax.

User query: "${query}"

Today's date: ${new Date().toISOString().split("T")[0]}

Gmail query syntax examples:
- from:john@example.com
- to:sarah@company.com
- subject:invoice
- after:2024/01/01 before:2024/02/01
- has:attachment
- is:starred is:unread
- label:important
- "exact phrase"
- larger:5M

Respond with ONLY the Gmail query, nothing else. Example response:
from:peter after:2024/09/01 before:2024/10/01`;

  const response = await callText(prompt);
  return response.trim();
}

/**
 * Execute a natural language command on an email.
 * Returns the action to take and any parameters.
 */
export async function parseCommand(
  command: string,
  email: { subject: string; from: string; id: string }
): Promise<{
  action: "forward" | "reply" | "archive" | "snooze" | "label" | "unknown";
  params: Record<string, string>;
}> {
  const prompt = `Parse this email command and extract the action and parameters.

Command: "${command}"
Email context: Subject "${email.subject}" from ${email.from}

Possible actions:
- forward: needs "to" (email address) and optional "message"
- reply: needs "message"
- archive: no params
- snooze: needs "until" (date)
- label: needs "name" (label name)`;

  try {
    return await callStructured(prompt, CommandSchema, commandJsonSchema);
  } catch {
    return { action: "unknown", params: {} };
  }
}

/**
 * Generate a specific, actionable reminder from an email thread.
 * Uses Claude to understand what actually needs to be done.
 */
export async function generateReminderFromEmail(
  thread: {
    subject: string;
    messages: { from: string; date: string; body: string }[];
  },
  existingSummary: string
): Promise<ReminderContent> {
  // Truncate bodies to avoid context overflow
  const truncatedMessages = thread.messages.map((m) => ({
    from: m.from,
    date: m.date,
    body: m.body.slice(0, 1500),
  }));

  const prompt = `Analyze this email thread and create a specific, actionable reminder.

Subject: ${thread.subject}

Messages (most recent last):
${truncatedMessages.map((m) => `--- ${m.from} (${m.date}) ---\n${m.body}`).join("\n\n")}

Current summary: "${existingSummary}"

Create a reminder that tells me EXACTLY what I need to do. Be specific.

Bad examples:
- "Check email from John" (too vague)
- "Reply to thread" (what should I say?)
- "Follow up" (on what?)

Good examples:
- "Reply to John: confirm meeting for Thursday 2pm"
- "Send Sarah the Q4 budget spreadsheet she requested"
- "Review and approve Mike's PR for auth changes"
- "Book flights for NYC trip (March 15-18)"`;

  try {
    const result = await callStructured(
      prompt,
      ReminderContentSchema,
      reminderJsonSchema
    );
    return {
      title: result.title.slice(0, 60),
      notes: result.notes,
    };
  } catch {
    return { title: existingSummary, notes: "" };
  }
}
