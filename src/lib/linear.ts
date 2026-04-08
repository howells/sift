import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.ts";

const LINEAR_TOKEN_REGEX = /^LINEAR=(.+)$/m;

export interface ToolDiscoveryItem {
	description: string;
	name: string;
}

export function buildToolDiscovery(): ToolDiscoveryItem[] {
	return [
		{ name: "bird", description: "Twitter/X operations" },
		{ name: "falcon", description: "AI image generation" },
		{ name: "granola", description: "Meeting notes export" },
		{ name: "granola-sync", description: "Sync meetings to Obsidian" },
		{ name: "vercel", description: "Deployment and env operations" },
		{ name: "gh", description: "GitHub PRs issues and actions" },
		{ name: "godaddy", description: "DNS record management" },
		{ name: "sentry-cli", description: "Error tracking and releases" },
		{ name: "stripe", description: "Payment operations and webhooks" },
		{ name: "neonctl", description: "Serverless Postgres management" },
		{ name: "doctl", description: "DigitalOcean operations" },
		{ name: "forge", description: "Laravel Forge servers" },
		{
			name: "gog",
			description: "Google Workspace beyond wrapped calendar and email flows",
		},
	];
}

function loadSecretsFile(): string {
	const path = join(homedir(), "dotfiles", ".secrets");
	if (!existsSync(path)) {
		return "";
	}
	return readFileSync(path, "utf8");
}

export function getLinearApiKey(): string | null {
	const configKey = loadConfig()?.linear?.apiKey;
	if (configKey) {
		return configKey;
	}

	const secrets = loadSecretsFile();
	const match = secrets.match(LINEAR_TOKEN_REGEX);
	return match?.[1]?.trim() ?? null;
}

export function getLinearSummary():
	| { in_progress: number; todo: number }
	| { error: string } {
	const apiKey = getLinearApiKey();
	if (!apiKey) {
		return { error: "LINEAR token not configured" };
	}

	return { error: "Linear summary not implemented yet" };
}
