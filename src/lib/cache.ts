import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import type { Todo } from "./types.js";

const CACHE_DIR = path.join(import.meta.dirname, "../../.cache");
const DB_PATH = path.join(CACHE_DIR, "sift.db");

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
	fs.mkdirSync(CACHE_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent access
db.pragma("journal_mode = WAL");

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS analyzed_emails (
    email_id TEXT PRIMARY KEY,
    account TEXT NOT NULL,
    thread_id TEXT,
    analyzed_at INTEGER NOT NULL,
    email_hash TEXT NOT NULL,
    is_todo INTEGER NOT NULL,
    todo_json TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_analyzed_emails_account
    ON analyzed_emails(account);

  CREATE INDEX IF NOT EXISTS idx_analyzed_emails_hash
    ON analyzed_emails(email_hash);
`);

/**
 * Create a hash of email properties that affect analysis.
 * If these change, we should re-analyze.
 */
export function hashEmail(email: {
	subject: string;
	from: string;
	date: string;
	snippet: string;
	isStarred: boolean;
	isUnread: boolean;
}): string {
	const content = [
		email.subject,
		email.from,
		email.date,
		email.snippet,
		email.isStarred ? "1" : "0",
		email.isUnread ? "1" : "0",
	].join("|");

	// Simple hash - just needs to detect changes
	let hash = 0;
	for (let i = 0; i < content.length; i++) {
		const char = content.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash;
	}
	return hash.toString(36);
}

interface CachedAnalysis {
	emailId: string;
	account: string;
	threadId: string | null;
	analyzedAt: number;
	emailHash: string;
	isTodo: boolean;
	todo: Todo | null;
}

/**
 * Get cached analysis for an email if it exists and hash matches.
 */
export function getCachedAnalysis(
	emailId: string,
	currentHash: string,
): CachedAnalysis | null {
	const stmt = db.prepare(`
    SELECT email_id, account, thread_id, analyzed_at, email_hash, is_todo, todo_json
    FROM analyzed_emails
    WHERE email_id = ?
  `);

	const row = stmt.get(emailId) as
		| {
				email_id: string;
				account: string;
				thread_id: string | null;
				analyzed_at: number;
				email_hash: string;
				is_todo: number;
				todo_json: string | null;
		  }
		| undefined;

	if (!row) return null;

	// If hash doesn't match, the email has changed - need re-analysis
	if (row.email_hash !== currentHash) return null;

	return {
		emailId: row.email_id,
		account: row.account,
		threadId: row.thread_id,
		analyzedAt: row.analyzed_at,
		emailHash: row.email_hash,
		isTodo: row.is_todo === 1,
		todo: row.todo_json ? JSON.parse(row.todo_json) : null,
	};
}

/**
 * Get all cached todos for given email IDs.
 */
export function getCachedTodos(emailIds: string[]): Map<string, Todo> {
	if (emailIds.length === 0) return new Map();

	const placeholders = emailIds.map(() => "?").join(",");
	const stmt = db.prepare(`
    SELECT email_id, todo_json
    FROM analyzed_emails
    WHERE email_id IN (${placeholders})
      AND is_todo = 1
      AND todo_json IS NOT NULL
  `);

	const rows = stmt.all(...emailIds) as {
		email_id: string;
		todo_json: string;
	}[];
	const map = new Map<string, Todo>();

	for (const row of rows) {
		map.set(row.email_id, JSON.parse(row.todo_json));
	}

	return map;
}

/**
 * Cache the analysis result for an email.
 */
export function cacheAnalysis(
	emailId: string,
	account: string,
	threadId: string | null,
	emailHash: string,
	isTodo: boolean,
	todo: Todo | null,
): void {
	const stmt = db.prepare(`
    INSERT OR REPLACE INTO analyzed_emails
      (email_id, account, thread_id, analyzed_at, email_hash, is_todo, todo_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

	stmt.run(
		emailId,
		account,
		threadId,
		Date.now(),
		emailHash,
		isTodo ? 1 : 0,
		todo ? JSON.stringify(todo) : null,
	);
}

/**
 * Batch cache multiple analysis results.
 */
export function cacheAnalysisBatch(
	results: Array<{
		emailId: string;
		account: string;
		threadId: string | null;
		emailHash: string;
		isTodo: boolean;
		todo: Todo | null;
	}>,
): void {
	const stmt = db.prepare(`
    INSERT OR REPLACE INTO analyzed_emails
      (email_id, account, thread_id, analyzed_at, email_hash, is_todo, todo_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

	const insertMany = db.transaction((items: typeof results) => {
		const now = Date.now();
		for (const item of items) {
			stmt.run(
				item.emailId,
				item.account,
				item.threadId,
				now,
				item.emailHash,
				item.isTodo ? 1 : 0,
				item.todo ? JSON.stringify(item.todo) : null,
			);
		}
	});

	insertMany(results);
}

/**
 * Remove a cached analysis (e.g., when email is marked done).
 */
export function removeCachedAnalysis(emailId: string): void {
	const stmt = db.prepare("DELETE FROM analyzed_emails WHERE email_id = ?");
	stmt.run(emailId);
}

/**
 * Clear all cached data.
 */
export function clearCache(): void {
	db.exec("DELETE FROM analyzed_emails");
}

/**
 * Get cache statistics.
 */
export function getCacheStats(): {
	totalCached: number;
	todosCount: number;
	oldestAnalysis: number | null;
} {
	const stats = db
		.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN is_todo = 1 THEN 1 ELSE 0 END) as todos,
      MIN(analyzed_at) as oldest
    FROM analyzed_emails
  `)
		.get() as { total: number; todos: number; oldest: number | null };

	return {
		totalCached: stats.total,
		todosCount: stats.todos,
		oldestAnalysis: stats.oldest,
	};
}
