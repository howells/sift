import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AccountConfig {
	email: string;
	group: string;
	name: string;
}

export interface ReminderListConfig {
	group: string; // Account group to associate with
	list: string; // Apple Reminders list name
}

interface LinearConfig {
	apiKey?: string;
	defaultTeam?: string;
	userId?: string;
}

interface CalendarConfig {
	account?: string;
	calendars?: string[];
}

interface ThingsConfig {
	list?: string;
}

export type TaskBackend = "reminders" | "things";

export interface SiftConfig {
	accounts: AccountConfig[];
	/** @deprecated Sift uses @howells/envelope local CLI providers. */
	anthropicApiKey?: string;
	calendar?: CalendarConfig;
	linear?: LinearConfig;
	/** @deprecated Provider is selected with SIFT_LLM_PROVIDER. */
	preferClaudeCli?: boolean;
	reminderLists?: ReminderListConfig[]; // Apple Reminders lists to show
	taskBackend?: TaskBackend;
	things?: ThingsConfig;
}

const CONFIG_DIR = join(homedir(), ".config", "sift");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

/** Return the path to the sift configuration directory (~/.config/sift). */
export function getConfigDir(): string {
	return CONFIG_DIR;
}

/** Check whether a config file exists on disk. */
export function configExists(): boolean {
	return existsSync(CONFIG_FILE);
}

/** Load and parse the config file, returning null if missing or invalid. */
export function loadConfig(): SiftConfig | null {
	if (!configExists()) {
		return null;
	}

	try {
		const content = readFileSync(CONFIG_FILE, "utf-8");
		return JSON.parse(content) as SiftConfig;
	} catch {
		return null;
	}
}

/** Write config to disk with owner-only permissions (0600). */
export function saveConfig(config: SiftConfig): void {
	// Ensure config directory exists with restricted permissions
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
	}

	// Config can contain integration credentials — restrict to owner only
	writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), {
		mode: 0o600,
	});
}

/**
 * Get unique groups from accounts
 */
export function getAccountGroups(config: SiftConfig): string[] {
	const groups = new Set(config.accounts.map((a) => a.group));
	return Array.from(groups);
}

/**
 * Get reminder lists from config
 */
export function getReminderLists(
	config: SiftConfig,
): ReminderListConfig[] | null {
	return config.reminderLists ?? null;
}

/** Return the configured task backend, defaulting to "reminders". */
export function getTaskBackend(config: SiftConfig | null): TaskBackend {
	return config?.taskBackend ?? "reminders";
}

/** Return the configured Things list name, or null if not set. */
export function getThingsList(config: SiftConfig | null): string | null {
	return config?.things?.list ?? null;
}

/**
 * Validate config has required fields
 */
export function validateConfig(config: SiftConfig): string[] {
	const errors: string[] = [];

	if (!config.accounts || config.accounts.length === 0) {
		errors.push("No accounts configured");
	}

	for (const account of config.accounts || []) {
		if (!account.name) {
			errors.push("Account missing 'name'");
		}
		if (!account.email) {
			errors.push("Account missing 'email'");
		}
		if (!account.group) {
			errors.push("Account missing 'group'");
		}
	}

	return errors;
}

/**
 * Check if Claude CLI is available
 */
export async function isClaudeCliAvailable(): Promise<boolean> {
	const { spawn } = await import("node:child_process");

	return new Promise((resolve) => {
		const child = spawn("claude", ["--version"], {
			stdio: ["ignore", "pipe", "pipe"],
		});

		child.on("close", (code) => {
			resolve(code === 0);
		});

		child.on("error", () => {
			resolve(false);
		});

		// Timeout after 5 seconds
		setTimeout(() => {
			child.kill();
			resolve(false);
		}, 5000);
	});
}
