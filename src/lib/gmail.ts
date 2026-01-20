import { google, gmail_v1, Auth } from "googleapis";
import open from "open";

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

function getGmailClient(auth: Auth.OAuth2Client): gmail_v1.Gmail {
  return google.gmail({ version: "v1", auth });
}

function parseHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

function parseEmail(message: gmail_v1.Schema$Message): Email {
  const headers = message.payload?.headers;
  const from = parseHeader(headers, "From");
  const fromMatch = from.match(/<(.+?)>/) || [null, from];

  return {
    id: message.id!,
    threadId: message.threadId!,
    subject: parseHeader(headers, "Subject") || "(no subject)",
    from: from.replace(/<.+?>/, "").trim() || from,
    fromEmail: fromMatch[1] || from,
    to: parseHeader(headers, "To"),
    date: parseHeader(headers, "Date"),
    snippet: message.snippet || "",
    isStarred: message.labelIds?.includes("STARRED") || false,
    isUnread: message.labelIds?.includes("UNREAD") || false,
    labels: message.labelIds || [],
  };
}

function decodeBody(body: gmail_v1.Schema$MessagePartBody | undefined): string {
  if (!body?.data) return "";
  return Buffer.from(body.data, "base64").toString("utf-8");
}

function extractTextBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";

  // Simple text/plain
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBody(payload.body);
  }

  // Multipart - look for text/plain
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBody(part.body);
      }
      // Nested multipart
      if (part.parts) {
        const nested = extractTextBody(part);
        if (nested) return nested;
      }
    }
    // Fallback to text/html if no plain text
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        // Strip HTML tags for a rough text version
        return decodeBody(part.body)
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
    }
  }

  return "";
}

export class GmailClient {
  private gmail: gmail_v1.Gmail;
  private userEmail: string;

  constructor(auth: Auth.OAuth2Client, userEmail: string) {
    this.gmail = getGmailClient(auth);
    this.userEmail = userEmail;
  }

  async listStarred(maxResults = 50): Promise<Email[]> {
    const response = await this.gmail.users.messages.list({
      userId: "me",
      q: "is:starred",
      maxResults,
    });

    if (!response.data.messages) return [];

    const emails = await Promise.all(
      response.data.messages.map((m) => this.getMessage(m.id!))
    );

    return emails.filter((e): e is Email => e !== null);
  }

  async listUnread(maxResults = 50): Promise<Email[]> {
    // Strict filter: inbox only, exclude categories and common automated notifications
    const response = await this.gmail.users.messages.list({
      userId: "me",
      q: `is:unread in:inbox -category:promotions -category:social -category:updates -category:forums
          -subject:"sign-in" -subject:"signed in" -subject:"new login" -subject:"security alert"
          -subject:"verify your" -subject:"confirm your" -subject:"was this you"
          -subject:"password reset" -subject:"2-step" -subject:"two-factor"
          -from:noreply -from:no-reply -from:notifications@`,
      maxResults,
    });

    if (!response.data.messages) return [];

    const emails = await Promise.all(
      response.data.messages.map((m) => this.getMessage(m.id!))
    );

    return emails.filter((e): e is Email => e !== null);
  }

  async search(query: string, maxResults = 50): Promise<Email[]> {
    const response = await this.gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults,
    });

    if (!response.data.messages) return [];

    const emails = await Promise.all(
      response.data.messages.map((m) => this.getMessage(m.id!))
    );

    return emails.filter((e): e is Email => e !== null);
  }

  async getMessage(id: string): Promise<Email | null> {
    try {
      const response = await this.gmail.users.messages.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders: ["From", "To", "Subject", "Date"],
      });

      return parseEmail(response.data);
    } catch {
      return null;
    }
  }

  async getThread(threadId: string): Promise<EmailThread | null> {
    try {
      const response = await this.gmail.users.threads.get({
        userId: "me",
        id: threadId,
        format: "full",
      });

      const thread = response.data;
      if (!thread.messages?.length) return null;

      const firstMessage = thread.messages[0];
      const headers = firstMessage.payload?.headers;

      return {
        id: thread.id!,
        subject: parseHeader(headers, "Subject") || "(no subject)",
        messages: thread.messages.map((m) => ({
          id: m.id!,
          from: parseHeader(m.payload?.headers, "From"),
          date: parseHeader(m.payload?.headers, "Date"),
          body: extractTextBody(m.payload),
        })),
      };
    } catch {
      return null;
    }
  }

  async star(messageId: string): Promise<boolean> {
    try {
      await this.gmail.users.messages.modify({
        userId: "me",
        id: messageId,
        requestBody: {
          addLabelIds: ["STARRED"],
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  async unstar(messageId: string): Promise<boolean> {
    try {
      await this.gmail.users.messages.modify({
        userId: "me",
        id: messageId,
        requestBody: {
          removeLabelIds: ["STARRED"],
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  async archive(messageId: string): Promise<boolean> {
    try {
      await this.gmail.users.messages.modify({
        userId: "me",
        id: messageId,
        requestBody: {
          removeLabelIds: ["INBOX"],
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  async markRead(messageId: string): Promise<boolean> {
    try {
      await this.gmail.users.messages.modify({
        userId: "me",
        id: messageId,
        requestBody: {
          removeLabelIds: ["UNREAD"],
        },
      });
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
      if (!thread) return false;

      const originalMessage = thread.messages[thread.messages.length - 1];
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

      const email = [
        `To: ${to}`,
        `Subject: ${subject}`,
        `Content-Type: text/plain; charset="UTF-8"`,
        "",
        body,
      ].join("\n");

      const encodedEmail = Buffer.from(email)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      await this.gmail.users.messages.send({
        userId: "me",
        requestBody: {
          raw: encodedEmail,
        },
      });

      return true;
    } catch (error) {
      console.error("Forward failed:", error);
      return false;
    }
  }

  async reply(messageId: string, message: string): Promise<boolean> {
    try {
      const thread = await this.getThread(messageId);
      if (!thread) return false;

      const originalMessage = thread.messages[thread.messages.length - 1];
      const subject = thread.subject.startsWith("Re:")
        ? thread.subject
        : `Re: ${thread.subject}`;

      // Extract reply-to email
      const fromMatch = originalMessage.from.match(/<(.+?)>/);
      const replyTo = fromMatch ? fromMatch[1] : originalMessage.from;

      const email = [
        `To: ${replyTo}`,
        `Subject: ${subject}`,
        `In-Reply-To: ${messageId}`,
        `References: ${messageId}`,
        `Content-Type: text/plain; charset="UTF-8"`,
        "",
        message,
      ].join("\n");

      const encodedEmail = Buffer.from(email)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      await this.gmail.users.messages.send({
        userId: "me",
        requestBody: {
          raw: encodedEmail,
          threadId: thread.id,
        },
      });

      return true;
    } catch (error) {
      console.error("Reply failed:", error);
      return false;
    }
  }

  getWebUrl(threadId: string): string {
    // Gmail web URLs use thread IDs - use #all/ to find regardless of label
    // authuser param selects the correct account by email
    return `https://mail.google.com/mail/?authuser=${encodeURIComponent(this.userEmail)}#all/${threadId}`;
  }

  async openInBrowser(threadId: string): Promise<void> {
    const url = this.getWebUrl(threadId);
    await open(url);
  }
}
