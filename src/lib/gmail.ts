import { spawn, spawnSync } from "node:child_process";
import open from "open";

// Regex patterns for email parsing
const EMAIL_EXTRACT_REGEX = /<(.+?)>/;
const EMAIL_REMOVE_REGEX = /<.+?>/;

/** How much of each message body is handed to the model. */
const SNIPPET_MAX_CHARS = 2000;

const UNTRUSTED_OPEN = /<<<EXTERNAL_UNTRUSTED_CONTENT[^>]*>>>\n?(?:Source:[^\n]*\n)?(?:---\n)?/g;
const UNTRUSTED_CLOSE = /<<<END_EXTERNAL_UNTRUSTED_CONTENT[^>]*>>>/g;

/** Strip gog's --wrap-untrusted fencing, keeping the text it wraps. */
function unwrapUntrusted(value: string | undefined): string {
  if (!value) {
    return "";
  }
  return value.replace(UNTRUSTED_OPEN, "").replace(UNTRUSTED_CLOSE, "").trim();
}

export interface Email {
  date: string;
  from: string;
  fromEmail: string;
  id: string;
  isStarred: boolean;
  isUnread: boolean;
  labels: string[];
  snippet: string;
  subject: string;
  threadId: string;
  to: string;
}

export interface EmailThread {
  id: string;
  messages: {
    id: string;
    from: string;
    date: string;
    body: string;
  }[];
  subject: string;
}

interface GogSearchResult {
  messages: {
    body?: string;
    date: string;
    from: string;
    id: string;
    labels?: string[];
    subject: string;
    threadId?: string;
  }[];
  nextPageToken?: string;
}

interface GogThreadResult {
  thread: {
    id: string;
    messages: {
      id: string;
      labelIds: string[];
      payload: {
        headers: { name: string; value: string }[];
        body?: { data?: string };
        parts?: GogMessagePart[];
      };
    }[];
  };
}

interface GogMessagePart {
  body?: { data?: string };
  mimeType?: string;
  parts?: GogMessagePart[];
}

function runGog(args: string[], account?: string): string {
  const result = spawnSync("gog", args, {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 30_000,
  });

  if (result.error) {
    throw parseGogError(result.error.message, account);
  }

  if (result.status !== 0) {
    throw parseGogError(result.stderr || `gog exited with code ${result.status}`, account);
  }

  return result.stdout;
}

/**
 * Check if gog CLI is available.
 */
export function isGogAvailable(): boolean {
  const result = spawnSync("gog", ["--version"], {
    stdio: "pipe",
    timeout: 5000,
  });
  return result.status === 0 && !result.error;
}

class GogAuthError extends Error {
  account?: string;

  constructor(message: string, account?: string) {
    super(message);
    this.name = "GogAuthError";
    this.account = account;
  }
}

function parseGogError(stderr: string, account?: string): Error {
  // Check for auth/token errors
  if (
    stderr.includes("invalid_grant") ||
    stderr.includes("Token has been expired") ||
    stderr.includes("Token has been revoked") ||
    stderr.includes("oauth2:")
  ) {
    const msg = account
      ? `Gmail token expired for ${account}. Run: gog auth add --account=${account}`
      : "Gmail token expired. Run: gog auth add --account=<email>";
    return new GogAuthError(msg, account);
  }
  return new Error(stderr);
}

/** A hung `gog` used to hang sift forever: this path had no timeout at all. */
const GOG_TIMEOUT_MS = 120_000;

async function runGogAsync(args: string[], account?: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn("gog", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(`gog timed out after ${GOG_TIMEOUT_MS / 1000}s: gog ${args[0]} ${args[1] ?? ""}`),
      );
    }, GOG_TIMEOUT_MS);
    timer.unref();

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(parseGogError(stderr || `gog exited with code ${code}`, account));
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function parseHeader(headers: { name: string; value: string }[] | undefined, name: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

function decodeBase64(data: string | undefined): string {
  if (!data) {
    return "";
  }
  // Gmail uses URL-safe base64
  const normalized = data.replaceAll("-", "+").replaceAll("_", "/");
  return Buffer.from(normalized, "base64").toString("utf-8");
}

function findTextPlainPart(parts: GogMessagePart[]): string {
  for (const part of parts) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      return decodeBase64(part.body.data);
    }
    if (part.parts) {
      const nested = findTextPlainPart(part.parts);
      if (nested) {
        return nested;
      }
    }
  }
  return "";
}

function findTextHtmlPart(parts: GogMessagePart[]): string {
  for (const part of parts) {
    if (part.mimeType === "text/html" && part.body?.data) {
      return decodeBase64(part.body.data)
        .replaceAll(/<[^>]+>/g, " ")
        .replaceAll(/\s+/g, " ")
        .trim();
    }
  }
  return "";
}

function extractTextBody(payload: GogMessagePart | undefined): string {
  if (!payload) {
    return "";
  }

  // Simple text/plain
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64(payload.body.data);
  }

  // Multipart
  if (payload.parts) {
    const plain = findTextPlainPart(payload.parts);
    if (plain) {
      return plain;
    }
    return findTextHtmlPart(payload.parts);
  }

  return "";
}

export class GmailClient {
  private readonly accountEmail: string;

  constructor(accountEmail: string) {
    this.accountEmail = accountEmail;
  }

  private get accountFlag(): string {
    return `--account=${this.accountEmail}`;
  }

  async listStarred(maxResults = 50): Promise<Email[]> {
    return await this.search("is:starred", maxResults);
  }

  async listUnread(maxResults = 50): Promise<Email[]> {
    // Strict filter: inbox only, exclude categories and common automated notifications
    const query = `is:unread in:inbox -category:promotions -category:social -category:updates -category:forums
			-subject:"sign-in" -subject:"signed in" -subject:"new login" -subject:"security alert"
			-subject:"verify your" -subject:"confirm your" -subject:"was this you"
			-subject:"password reset" -subject:"2-step" -subject:"two-factor"
			-from:noreply -from:no-reply -from:notifications@`;
    return await this.search(query, maxResults);
  }

  async search(query: string, maxResults = 50): Promise<Email[]> {
    // `gmail messages search` rather than `gmail search`: the latter returns
    // subject lines only, which left the model guessing whether an email needed
    // action from its subject alone. --wrap-untrusted is gog's own
    // prompt-injection fencing; the markers are stripped here and the prompt
    // states plainly that the content is untrusted.
    const output = await runGogAsync(
      [
        "gmail",
        "messages",
        "search",
        query,
        `--max=${maxResults}`,
        "--json",
        "--include-body",
        "--wrap-untrusted",
        this.accountFlag,
      ],
      this.accountEmail,
    );

    let result: GogSearchResult;
    try {
      result = JSON.parse(output);
    } catch {
      throw new Error(`Failed to parse gog search output for ${this.accountEmail}`);
    }

    if (!result.messages) {
      return [];
    }

    return result.messages.map((m) => {
      const from = unwrapUntrusted(m.from);
      const fromMatch = EMAIL_EXTRACT_REGEX.exec(from) || [null, from];
      return {
        date: m.date,
        from: from.replace(EMAIL_REMOVE_REGEX, "").trim() || from,
        fromEmail: fromMatch[1] || from,
        id: m.id,
        isStarred: m.labels?.includes("STARRED") ?? false,
        isUnread: m.labels?.includes("UNREAD") ?? false,
        labels: m.labels || [],
        snippet: unwrapUntrusted(m.body).slice(0, SNIPPET_MAX_CHARS),
        subject: unwrapUntrusted(m.subject) || "(no subject)",
        threadId: m.threadId || m.id,
        to: "",
      };
    });
  }

  getMessage(id: string): Email | null {
    try {
      const output = runGog(["gmail", "get", id, "--json", this.accountFlag], this.accountEmail);

      const msg = JSON.parse(output);
      const headers = msg.payload?.headers;
      const from = parseHeader(headers, "From");
      const fromMatch = EMAIL_EXTRACT_REGEX.exec(from) || [null, from];

      return {
        date: parseHeader(headers, "Date"),
        from: from.replace(EMAIL_REMOVE_REGEX, "").trim() || from,
        fromEmail: fromMatch[1] || from,
        id: msg.id,
        isStarred: msg.labelIds?.includes("STARRED") ?? false,
        isUnread: msg.labelIds?.includes("UNREAD") ?? false,
        labels: msg.labelIds || [],
        snippet: msg.snippet || "",
        subject: parseHeader(headers, "Subject") || "(no subject)",
        threadId: msg.threadId,
        to: parseHeader(headers, "To"),
      };
    } catch {
      return null;
    }
  }

  async getThread(threadId: string): Promise<EmailThread | null> {
    try {
      const output = await runGogAsync(
        ["gmail", "thread", "get", threadId, "--full", "--json", this.accountFlag],
        this.accountEmail,
      );

      const result: GogThreadResult = JSON.parse(output);
      const { thread } = result;
      if (!thread.messages?.length) {
        return null;
      }

      const firstMessage = thread.messages[0];
      if (!firstMessage) {
        return null;
      }

      const headers = firstMessage.payload?.headers;

      return {
        id: thread.id,
        messages: thread.messages.map((m) => ({
          body: extractTextBody(m.payload as GogMessagePart),
          date: parseHeader(m.payload?.headers, "Date"),
          from: parseHeader(m.payload?.headers, "From"),
          id: m.id,
        })),
        subject: parseHeader(headers, "Subject") || "(no subject)",
      };
    } catch {
      return null;
    }
  }

  star(messageId: string): boolean {
    try {
      runGog(
        ["gmail", "thread", "modify", messageId, "--add=STARRED", this.accountFlag],
        this.accountEmail,
      );
      return true;
    } catch {
      return false;
    }
  }

  unstar(messageId: string): boolean {
    try {
      runGog(
        ["gmail", "thread", "modify", messageId, "--remove=STARRED", this.accountFlag],
        this.accountEmail,
      );
      return true;
    } catch {
      return false;
    }
  }

  archive(messageId: string): boolean {
    try {
      runGog(
        ["gmail", "thread", "modify", messageId, "--remove=INBOX", this.accountFlag],
        this.accountEmail,
      );
      return true;
    } catch {
      return false;
    }
  }

  markRead(messageId: string): boolean {
    try {
      runGog(
        ["gmail", "thread", "modify", messageId, "--remove=UNREAD", this.accountFlag],
        this.accountEmail,
      );
      return true;
    } catch {
      return false;
    }
  }

  async forward(messageId: string, to: string, additionalMessage?: string): Promise<boolean> {
    try {
      const thread = await this.getThread(messageId);
      if (!thread) {
        return false;
      }

      const originalMessage = thread.messages.at(-1);
      if (!originalMessage) {
        return false;
      }
      const subject = thread.subject.startsWith("Fwd:") ? thread.subject : `Fwd: ${thread.subject}`;

      const body = [
        additionalMessage || "",
        "",
        "---------- Forwarded message ----------",
        `From: ${originalMessage.from}`,
        `Date: ${originalMessage.date}`,
        `Subject: ${thread.subject}`,
        "",
        originalMessage.body,
      ].join("\n");

      runGog(
        ["gmail", "send", `--to=${to}`, `--subject=${subject}`, `--body=${body}`, this.accountFlag],
        this.accountEmail,
      );

      return true;
    } catch {
      return false;
    }
  }

  reply(messageId: string, message: string): boolean {
    try {
      runGog(
        [
          "gmail",
          "send",
          `--thread-id=${messageId}`,
          "--reply-all",
          `--body=${message}`,
          this.accountFlag,
        ],
        this.accountEmail,
      );
      return true;
    } catch {
      return false;
    }
  }

  getWebUrl(threadId: string): string {
    // Gmail web URLs use thread IDs - use #all/ to find regardless of label
    return `https://mail.google.com/mail/?authuser=${encodeURIComponent(this.accountEmail)}#all/${threadId}`;
  }

  async openInBrowser(threadId: string): Promise<void> {
    const url = this.getWebUrl(threadId);
    await open(url);
  }
}
