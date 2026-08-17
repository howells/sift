import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AccountConfig {
  email: string;
  group: string;
  name: string;
}

export interface SiftConfig {
  accounts: AccountConfig[];
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
    mkdirSync(CONFIG_DIR, { mode: 0o700, recursive: true });
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
  return [...groups];
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

/** Whether an OpenRouter key is present for email analysis. */
export function isModelConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.OPENROUTER_API_KEY?.trim());
}
