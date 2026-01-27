import { spawn } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import { cacheAnalysisBatch, getCachedAnalysis, hashEmail } from "./cache.js";
import { isClaudeCliAvailable, loadConfig } from "./config.js";
import type { Email } from "./gmail.js";
import type { AnalysisResult, Todo } from "./types.js";

/**
 * Call LLM - tries Claude CLI first if available and preferred,
 * falls back to Anthropic API if API key is configured.
 */
async function callLLM(prompt: string): Promise<string> {
	const config = loadConfig();
	const preferCli = config?.preferClaudeCli !== false;
	const apiKey = config?.anthropicApiKey || process.env.ANTHROPIC_API_KEY;

	// Try Claude CLI first if preferred
	if (preferCli) {
		const cliAvailable = await isClaudeCliAvailable();
		if (cliAvailable) {
			try {
				return await callLLMCli(prompt);
			} catch (error) {
				// Fall through to API if CLI fails
				if (!apiKey) throw error;
			}
		}
	}

	// Use Anthropic API
	if (apiKey) {
		return await callAnthropicApi(prompt, apiKey);
	}

	throw new Error(
		"No LLM available. Install Claude CLI or set ANTHROPIC_API_KEY.",
	);
}

/**
 * Shell out to Claude Code CLI with data passed via stdin.
 */
async function callLLMCli(prompt: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn("claude", ["-p", "--output-format", "text"], {
			stdio: ["pipe", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (data) => {
			stdout += data.toString();
		});

		child.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		child.on("close", (code) => {
			if (code === 0) {
				resolve(stdout.trim());
			} else {
				reject(new Error(stderr || `Claude CLI exited with code ${code}`));
			}
		});

		child.on("error", reject);

		child.stdin.write(prompt);
		child.stdin.end();
	});
}

/**
 * Call Anthropic API directly.
 */
async function callAnthropicApi(
	prompt: string,
	apiKey: string,
): Promise<string> {
	const client = new Anthropic({ apiKey });

	const message = await client.messages.create({
		model: "claude-sonnet-4-20250514",
		max_tokens: 4096,
		messages: [
			{
				role: "user",
				content: prompt,
			},
		],
	});

	const textBlock = message.content.find((block) => block.type === "text");
	if (!textBlock || textBlock.type !== "text") {
		throw new Error("No text response from Anthropic API");
	}

	return textBlock.text;
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
	onProgress?: (cached: number, toAnalyze: number) => void,
): Promise<AnalysisResult> {
	// Flatten and compute hashes
	const allEmails: EmailWithMeta[] = emails.flatMap(
		({ account, group, emails }) =>
			emails.map((e) => ({
				account,
				group,
				email: e,
				hash: hashEmail(e),
			})),
	);

	// Check cache for each email
	const cachedTodos: Todo[] = [];
	const uncachedEmails: EmailWithMeta[] = [];

	for (const item of allEmails) {
		const cached = getCachedAnalysis(item.email.id, item.hash);
		if (cached) {
			if (cached.isTodo && cached.todo) {
				// Ensure cached todos have source field (backwards compatibility)
				cachedTodos.push({ ...cached.todo, source: "email" });
			}
			// Skip - already analyzed with same hash
		} else {
			uncachedEmails.push(item);
		}
	}

	// Report progress
	onProgress?.(cachedTodos.length, uncachedEmails.length);

	// If everything is cached, return early
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

		// Update progress for batches
		if (totalBatches > 1) {
			onProgress?.(
				cachedTodos.length + allNewTodos.length,
				uncachedEmails.length - i,
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
${JSON.stringify(emailSummaries, null, 2)}

Respond with ONLY valid JSON in this exact format:
{
  "todos": [
    {
      "source": "email",
      "id": "<generate a unique id>",
      "emailId": "<COPY the 'id' field from the input email EXACTLY>",
      "threadId": "<COPY the 'threadId' field from the input email EXACTLY>",
      "account": "<COPY the 'account' field from the input email EXACTLY>",
      "group": "<COPY the 'group' field from the input email EXACTLY>",
      "subject": "<COPY the 'subject' field from the input email>",
      "from": "<COPY the 'from' field from the input email>",
      "fromEmail": "<COPY the 'fromEmail' field from the input email>",
      "summary": "Brief action description (e.g., 'Reply about contract')",
      "urgency": "overdue" | "this_week" | "when_you_can",
      "reasoning": "Why this urgency (e.g., 'Asked for next week, 7 days ago')",
      "date": "<COPY the 'date' field from the input email>",
      "isStarred": "<COPY the 'isStarred' field from the input email>",
      "person": "First Last (the person the task relates to, extracted from 'from' field)",
      "deadline": "Ddd Mmm DD" | "ASAP" | null
    }
  ]
}`;

		const response = await callLLM(prompt);

		// Extract JSON from response (Claude might add explanation text)
		const jsonMatch = response.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			throw new Error("No valid JSON in Claude response");
		}

		let batchTodos: Todo[];
		try {
			const result = JSON.parse(jsonMatch[0]) as AnalysisResult;
			// Ensure all todos have source field
			batchTodos = result.todos.map((todo) => ({ ...todo, source: "email" }));
		} catch {
			throw new Error(
				`Failed to parse Claude response: ${response.slice(0, 200)}`,
			);
		}

		// Build a map of emailId -> todo for quick lookup
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

	// Combine cached and new todos
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

	const response = await callLLM(prompt);
	return response.trim();
}

/**
 * Execute a natural language command on an email.
 * Returns the action to take and any parameters.
 */
export async function parseCommand(
	command: string,
	email: { subject: string; from: string; id: string },
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
- label: needs "name" (label name)

Respond with ONLY valid JSON:
{
  "action": "forward" | "reply" | "archive" | "snooze" | "label" | "unknown",
  "params": { "key": "value" }
}`;

	const response = await callLLM(prompt);
	const jsonMatch = response.match(/\{[\s\S]*\}/);
	if (!jsonMatch) {
		return { action: "unknown", params: {} };
	}

	try {
		return JSON.parse(jsonMatch[0]);
	} catch {
		return { action: "unknown", params: {} };
	}
}

export interface ReminderContent {
	title: string; // Short actionable title (max 60 chars)
	notes: string; // Context and details
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
	existingSummary: string,
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
- "Book flights for NYC trip (March 15-18)"

Respond with ONLY valid JSON:
{
  "title": "Short action (max 60 chars, starts with verb)",
  "notes": "Additional context: key details, deadlines, what they're waiting for"
}`;

	try {
		const response = await callLLM(prompt);
		const jsonMatch = response.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			return { title: existingSummary, notes: "" };
		}

		const result = JSON.parse(jsonMatch[0]) as ReminderContent;
		// Ensure title isn't too long
		return {
			title: result.title.slice(0, 60),
			notes: result.notes,
		};
	} catch {
		return { title: existingSummary, notes: "" };
	}
}
