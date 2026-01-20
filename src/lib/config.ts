import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface AccountConfig {
  name: string;
  email: string;
  group: string;
}

export interface SiftConfig {
  accounts: AccountConfig[];
  anthropicApiKey?: string;
  preferClaudeCli?: boolean; // If true, try claude CLI first, fall back to API
}

const CONFIG_DIR = path.join(os.homedir(), ".config", "sift");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const CREDENTIALS_DIR = path.join(CONFIG_DIR, "credentials");

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getCredentialsDir(): string {
  return CREDENTIALS_DIR;
}

export function configExists(): boolean {
  return fs.existsSync(CONFIG_FILE);
}

export function loadConfig(): SiftConfig | null {
  if (!configExists()) {
    return null;
  }

  try {
    const content = fs.readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(content) as SiftConfig;
  } catch {
    return null;
  }
}

export function saveConfig(config: SiftConfig): void {
  // Ensure directories exist
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  if (!fs.existsSync(CREDENTIALS_DIR)) {
    fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
  }

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getTokenPath(accountName: string): string {
  return path.join(CREDENTIALS_DIR, `token-${accountName}.json`);
}

export function getGoogleCredentialsPath(): string {
  return path.join(CREDENTIALS_DIR, "google-credentials.json");
}

export function googleCredentialsExist(): boolean {
  return fs.existsSync(getGoogleCredentialsPath());
}

/**
 * Get unique groups from accounts
 */
export function getAccountGroups(config: SiftConfig): string[] {
  const groups = new Set(config.accounts.map((a) => a.group));
  return Array.from(groups);
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
    if (!account.name) errors.push("Account missing 'name'");
    if (!account.email) errors.push("Account missing 'email'");
    if (!account.group) errors.push("Account missing 'group'");
  }

  if (!config.anthropicApiKey && config.preferClaudeCli === false) {
    errors.push("No Anthropic API key and Claude CLI disabled");
  }

  return errors;
}

/**
 * Check if Claude CLI is available
 */
export async function isClaudeCliAvailable(): Promise<boolean> {
  const { spawn } = await import("child_process");

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
