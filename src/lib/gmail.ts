import { spawn, spawnSync } from "node:child_process";
import open from "open";

// Regex patterns for email parsing
const EMAIL_EXTRACT_REGEX = /<(.+?)>/;
const EMAIL_REMOVE_REGEX = /<.+?>/;

export interface Email {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  fromEmail: string;
  to: string;
  date: string;
  snippet: string;
  isStarred: boolean;
  isUnread: boolean;
  labels: string[];
}

export interface EmailThread {
  id: string;
  subject: string;
  messages: {
    id: string;
    from: string;
    date: string;
    body: string;
  }[];
}

interface GogSearchResult {
  threads: {
    id: string;
    date: string;
    from: string;
    subject: string;
    labels: string[];
    messageCount: number;
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
  mimeType?: string;
  body?: { data?: string };
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
    throw parseGogError(
      result.stderr || `gog exited with code ${result.status}`,
      account
    );
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

export class GogAuthError extends Error {
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

function runGogAsync(args: string[], account?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("gog", args, {
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
        resolve(stdout);
      } else {
        reject(
          parseGogError(stderr || `gog exited with code ${code}`, account)
        );
      }
    });

    child.on("error", reject);
  });
}

function parseHeader(
  headers: { name: string; value: string }[] | undefined,
  name: string
): string {
  return (
    headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ||
    ""
  );
}

function decodeBase64(data: string | undefined): string {
  if (!data) {
    return "";
  }
  // Gmail uses URL-safe base64
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
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
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
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

  listStarred(maxResults = 50): Promise<Email[]> {
    return this.search("is:starred", maxResults);
  }

  listUnread(maxResults = 50): Promise<Email[]> {
    // Strict filter: inbox only, exclude categories and common automated notifications
    const query = `is:unread in:inbox -category:promotions -category:social -category:updates -category:forums
			-subject:"sign-in" -subject:"signed in" -subject:"new login" -subject:"security alert"
			-subject:"verify your" -subject:"confirm your" -subject:"was this you"
			-subject:"password reset" -subject:"2-step" -subject:"two-factor"
			-from:noreply -from:no-reply -from:notifications@`;
    return this.search(query, maxResults);
  }

  async search(query: string, maxResults = 50): Promise<Email[]> {
    const output = await runGogAsync(
      [
        "gmail",
        "search",
        query,
        `--max=${maxResults}`,
        "--json",
        this.accountFlag,
      ],
      this.accountEmail
    );

    let result: GogSearchResult;
    try {
      result = JSON.parse(output);
    } catch {
      throw new Error(
        `Failed to parse gog search output for ${this.accountEmail}`
      );
    }

    if (!result.threads) {
      return [];
    }

    return result.threads.map((t) => {
      const fromMatch = t.from.match(EMAIL_EXTRACT_REGEX) || [null, t.from];
      return {
        id: t.id,
        threadId: t.id,
        subject: t.subject || "(no subject)",
        from: t.from.replace(EMAIL_REMOVE_REGEX, "").trim() || t.from,
        fromEmail: fromMatch[1] || t.from,
        to: "",
        date: t.date,
        snippet: "",
        isStarred: t.labels?.includes("STARRED"),
        isUnread: t.labels?.includes("UNREAD"),
        labels: t.labels || [],
      };
    });
  }

  getMessage(id: string): Email | null {
    try {
      const output = runGog(
        ["gmail", "get", id, "--json", this.accountFlag],
        this.accountEmail
      );

      const msg = JSON.parse(output);
      const headers = msg.payload?.headers;
      const from = parseHeader(headers, "From");
      const fromMatch = from.match(EMAIL_EXTRACT_REGEX) || [null, from];

      return {
        id: msg.id,
        threadId: msg.threadId,
        subject: parseHeader(headers, "Subject") || "(no subject)",
        from: from.replace(EMAIL_REMOVE_REGEX, "").trim() || from,
        fromEmail: fromMatch[1] || from,
        to: parseHeader(headers, "To"),
        date: parseHeader(headers, "Date"),
        snippet: msg.snippet || "",
        isStarred: msg.labelIds?.includes("STARRED"),
        isUnread: msg.labelIds?.includes("UNREAD"),
        labels: msg.labelIds || [],
      };
    } catch {
      return null;
    }
  }

  async getThread(threadId: string): Promise<EmailThread | null> {
    try {
      const output = await runGogAsync(
        [
          "gmail",
          "thread",
          "get",
          threadId,
          "--full",
          "--json",
          this.accountFlag,
        ],
        this.accountEmail
      );

      const result: GogThreadResult = JSON.parse(output);
      const thread = result.thread;
      if (!thread.messages?.length) {
        return null;
      }

      const firstMessage = thread.messages[0];
      const headers = firstMessage.payload?.headers;

      return {
        id: thread.id,
        subject: parseHeader(headers, "Subject") || "(no subject)",
        messages: thread.messages.map((m) => ({
          id: m.id,
          from: parseHeader(m.payload?.headers, "From"),
          date: parseHeader(m.payload?.headers, "Date"),
          body: extractTextBody(m.payload as GogMessagePart),
        })),
      };
    } catch {
      return null;
    }
  }

  star(messageId: string): boolean {
    try {
      runGog(
        [
          "gmail",
          "thread",
          "modify",
          messageId,
          "--add=STARRED",
          this.accountFlag,
        ],
        this.accountEmail
      );
      return true;
    } catch {
      return false;
    }
  }

  unstar(messageId: string): boolean {
    try {
      runGog(
        [
          "gmail",
          "thread",
          "modify",
          messageId,
          "--remove=STARRED",
          this.accountFlag,
        ],
        this.accountEmail
      );
      return true;
    } catch {
      return false;
    }
  }

  archive(messageId: string): boolean {
    try {
      runGog(
        [
          "gmail",
          "thread",
          "modify",
          messageId,
          "--remove=INBOX",
          this.accountFlag,
        ],
        this.accountEmail
      );
      return true;
    } catch {
      return false;
    }
  }

  markRead(messageId: string): boolean {
    try {
      runGog(
        [
          "gmail",
          "thread",
          "modify",
          messageId,
          "--remove=UNREAD",
          this.accountFlag,
        ],
        this.accountEmail
      );
      return true;
    } catch {
      return false;
    }
  }

  async forward(
    messageId: string,
    to: string,
    additionalMessage?: string
  ): Promise<boolean> {
    try {
      const thread = await this.getThread(messageId);
      if (!thread) {
        return false;
      }

      const originalMessage = thread.messages.at(-1);
      if (!originalMessage) {
        return false;
      }
      const subject = thread.subject.startsWith("Fwd:")
        ? thread.subject
        : `Fwd: ${thread.subject}`;

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
        [
          "gmail",
          "send",
          `--to=${to}`,
          `--subject=${subject}`,
          `--body=${body}`,
          this.accountFlag,
        ],
        this.accountEmail
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
        this.accountEmail
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
