/**
 * Auth module - simplified to re-export account configuration
 * Gmail authentication is now handled by the gog CLI
 */

import type { AccountConfig } from "./config.ts";
import { getAccountGroups, loadConfig } from "./config.ts";

export type { AccountConfig } from "./config.ts";

export function getAccounts(): AccountConfig[] {
	const config = loadConfig();
	return config?.accounts || [];
}

export function getAccountGroupsList(): string[] {
	const config = loadConfig();
	return config ? getAccountGroups(config) : [];
}

export type AccountGroup = string;

/**
 * Check if gog CLI is available and has the account authenticated
 */
export async function checkGogAuth(accountEmail: string): Promise<boolean> {
	const { execSync } = await import("node:child_process");

	try {
		const output = execSync("gog auth list", {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});

		// Check if the account email appears in the auth list
		return output.includes(accountEmail);
	} catch {
		return false;
	}
}

/**
 * Check all configured accounts are authenticated with gog
 */
export async function checkAllAccountsAuth(): Promise<{
	authenticated: string[];
	missing: string[];
}> {
	const accounts = getAccounts();
	const authenticated: string[] = [];
	const missing: string[] = [];

	for (const account of accounts) {
		const isAuth = await checkGogAuth(account.email);
		if (isAuth) {
			authenticated.push(account.email);
		} else {
			missing.push(account.email);
		}
	}

	return { authenticated, missing };
}
