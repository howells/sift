import { z } from "zod";
import { createEnvelope } from "./ai-client.ts";
import { cacheAnalysisBatch, getCachedAnalysis, hashEmail } from "./cache.ts";
import type { Email } from "./gmail.ts";
import { ACTION_TYPES } from "./types.ts";
import type { AnalysisResult, Todo } from "./types.ts";

// --- Zod schemas ---

const EmailTodoSchema = z.object({
  account: z.string(),
  actionType: z.enum(ACTION_TYPES),
  date: z.string(),
  deadline: z.string().nullable(),
  emailId: z.string(),
  from: z.string(),
  fromEmail: z.string(),
  group: z.string(),
  id: z.string(),
  isStarred: z.boolean(),
  person: z.string(),
  reasoning: z.string(),
  source: z.literal("email"),
  subject: z.string(),
  summary: z.string(),
  threadId: z.string().optional(),
  urgency: z.enum(["overdue", "this_week", "when_you_can"]),
});

const EmailAnalysisSchema = z.object({
  todos: z.array(EmailTodoSchema),
});

const ReminderContentSchema = z.object({
  notes: z.string(),
  title: z.string(),
});

export type ReminderContent = z.infer<typeof ReminderContentSchema>;

export { getActiveProviderLabel } from "./ai-client.ts";

// --- Envelopes (typed LLM functions) ---

const EmailBatchInput = z.object({
  batchLabel: z.string(),
  emails: z.array(
    z.object({
      account: z.string(),
      date: z.string(),
      from: z.string(),
      fromEmail: z.string(),
      group: z.string(),
      id: z.string(),
      isStarred: z.boolean(),
      isUnread: z.boolean(),
      snippet: z.string(),
      subject: z.string(),
      threadId: z.string(),
    }),
  ),
  today: z.string(),
});

const analyzeEmailBatch = createEnvelope({
  input: EmailBatchInput,
  output: EmailAnalysisSchema,
  prompt: (input) => `You are analyzing emails to extract actionable todos. Today is ${input.today}.

For each email, determine:
1. Does this require a response or action from the user? (yes/no)
2. If yes, what's the specific task?
3. Urgency based on TIME AWARENESS:
   - "overdue": The email mentions a deadline/time that has passed, or says things like "next week" but was sent >7 days ago
   - "this_week": Has upcoming deadline this week, or is from an important sender
   - "when_you_can": No time pressure, can be done whenever
4. Classify the primary action using exactly one of: ${ACTION_TYPES.join(", ")}
5. Extract the PERSON name (first + last if available) the task relates to
6. Extract any DEADLINE mentioned and format as "Ddd Mmm DD" (e.g., "Fri Jan 24")

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

Emails to analyze (${input.batchLabel}):
${JSON.stringify(input.emails, null, 2)}`,
});

const ReminderInput = z.object({
  existingSummary: z.string(),
  messages: z.array(
    z.object({
      body: z.string(),
      date: z.string(),
      from: z.string(),
    }),
  ),
  subject: z.string(),
});

const generateReminder = createEnvelope({
  input: ReminderInput,
  output: ReminderContentSchema,
  prompt: (input) => `Analyze this email thread and create a specific, actionable reminder.

Subject: ${input.subject}

Messages (most recent last):
${input.messages.map((m) => `--- ${m.from} (${m.date}) ---\n${m.body}`).join("\n\n")}

Current summary: "${input.existingSummary}"

Create a reminder that tells me EXACTLY what I need to do. Be specific.

Bad examples:
- "Check email from John" (too vague)
- "Reply to thread" (what should I say?)
- "Follow up" (on what?)

Good examples:
- "Reply to John: confirm meeting for Thursday 2pm"
- "Send Sarah the Q4 budget spreadsheet she requested"
- "Review and approve Mike's PR for auth changes"
- "Book flights for NYC trip (March 15-18)"`,
});

/** Parse and validate raw LLM output into a typed AnalysisResult. */
export function parseEmailAnalysisResult(input: unknown): AnalysisResult {
  return EmailAnalysisSchema.parse(input);
}

// --- Public API ---

interface EmailWithMeta {
  account: string;
  email: Email;
  group: string;
  hash: string;
}

function emitWarning(payload: Record<string, unknown>): void {
  process.stderr.write(`${JSON.stringify({ warning: payload })}\n`);
}

/**
 * Analyze emails and extract time-aware todos.
 * Uses SQLite cache to avoid re-analyzing unchanged emails.
 *
 * On LLM failure,
 * returns cached todos only and emits a structured warning to stderr.
 * Failed batches are intentionally NOT cached so they will be retried next run.
 */
export async function analyzeEmails(
  emails: { account: string; group: string; emails: Email[] }[],
  today: Date = new Date(),
  onProgress?: (cached: number, toAnalyze: number) => void,
): Promise<AnalysisResult> {
  const allEmails: EmailWithMeta[] = emails.flatMap(({ account, group, emails }) =>
    emails.map((e) => ({
      account,
      email: e,
      group,
      hash: hashEmail(e),
    })),
  );

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

  const BATCH_SIZE = 50;
  const allNewTodos: Todo[] = [];
  const todayStr = today.toISOString().slice(0, 10);
  let failedBatches = 0;
  let skippedEmails = 0;

  for (let i = 0; i < uncachedEmails.length; i += BATCH_SIZE) {
    const batch = uncachedEmails.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(uncachedEmails.length / BATCH_SIZE);

    if (totalBatches > 1) {
      onProgress?.(cachedTodos.length + allNewTodos.length, uncachedEmails.length - i);
    }

    const emailSummaries = batch.map(({ account, group, email: e }) => ({
      account,
      date: e.date,
      from: e.from,
      fromEmail: e.fromEmail,
      group,
      id: e.id,
      isStarred: e.isStarred,
      isUnread: e.isUnread,
      snippet: e.snippet,
      subject: e.subject,
      threadId: e.threadId,
    }));

    let result: AnalysisResult;
    try {
      result = await analyzeEmailBatch({
        batchLabel: `batch ${batchNum}/${totalBatches}`,
        emails: emailSummaries,
        today: todayStr,
      });
    } catch (error) {
      // Don't cache — let the next run retry these emails.
      failedBatches += 1;
      skippedEmails += batch.length;
      emitWarning({
        batch: `${batchNum}/${totalBatches}`,
        error: error instanceof Error ? error.message : String(error),
        reason: "llm_batch_failed",
        skipped: batch.length,
      });
      continue;
    }

    const batchTodos: Todo[] = result.todos.map((todo) => ({
      ...todo,
      reminderState: "none" as const,
      source: "email" as const,
    }));

    const todosByEmailId = new Map<string, Todo>();
    for (const todo of batchTodos) {
      if (todo.emailId) {
        todosByEmailId.set(todo.emailId, todo);
      }
    }

    const cacheEntries = batch.map((item) => {
      const todo = todosByEmailId.get(item.email.id);
      return {
        account: item.account,
        emailHash: item.hash,
        emailId: item.email.id,
        isTodo: !!todo,
        threadId: item.email.threadId,
        todo: todo || null,
      };
    });

    cacheAnalysisBatch(cacheEntries);
    allNewTodos.push(...batchTodos);
  }

  if (failedBatches > 0) {
    emitWarning({
      failedBatches,
      message:
        "Some email batches failed to analyze. Cached todos returned; failed batches will be retried on the next run.",
      reason: "partial_analysis",
      skipped: skippedEmails,
    });
  }

  return { todos: [...cachedTodos, ...allNewTodos] };
}

/**
 * Generate a specific, actionable reminder from an email thread.
 */
export async function generateReminderFromEmail(
  thread: {
    subject: string;
    messages: { from: string; date: string; body: string }[];
  },
  existingSummary: string,
): Promise<ReminderContent> {
  const truncatedMessages = thread.messages.map((m) => ({
    body: m.body.slice(0, 1500),
    date: m.date,
    from: m.from,
  }));

  try {
    const result = await generateReminder({
      existingSummary,
      messages: truncatedMessages,
      subject: thread.subject,
    });
    return {
      notes: result.notes,
      title: result.title.slice(0, 60),
    };
  } catch {
    return { notes: "", title: existingSummary };
  }
}
