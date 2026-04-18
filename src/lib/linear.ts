import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.ts";

const LINEAR_TOKEN_REGEX = /^LINEAR=(.+)$/m;
const LINEAR_GRAPHQL_ENDPOINT = "https://api.linear.app/graphql";
const LINEAR_PAGE_SIZE = 100;

export interface ToolDiscoveryItem {
	description: string;
	name: string;
}

interface LinearConnectionPage {
	nodes?: Array<{ id?: string }>;
	pageInfo?: {
		endCursor?: string | null;
		hasNextPage?: boolean;
	};
}

function readLinearTokenFromEnv(): string | null {
	const envToken = process.env.LINEAR?.trim();
	return envToken ? envToken : null;
}

/** Return the list of external CLI tools available for agent discovery. */
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

/** Resolve the Linear API key from config, environment, or dotfiles secrets. */
export function getLinearApiKey(): string | null {
	const configKey = loadConfig()?.linear?.apiKey;
	if (configKey) {
		return configKey;
	}

	const envKey = readLinearTokenFromEnv();
	if (envKey) {
		return envKey;
	}

	const secrets = loadSecretsFile();
	const match = secrets.match(LINEAR_TOKEN_REGEX);
	return match?.[1]?.trim() ?? null;
}

async function fetchAssignedIssuesPage(
	apiKey: string,
	stateType: "started" | "unstarted",
	after?: string,
): Promise<LinearConnectionPage> {
	const afterClause = after ? `, after: "${after}"` : "";
	const query = `query {
  viewer {
    assignedIssues(first: ${LINEAR_PAGE_SIZE}${afterClause}, filter: { state: { type: { eq: "${stateType}" } } }) {
      nodes { id }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

	const response = await fetch(LINEAR_GRAPHQL_ENDPOINT, {
		body: JSON.stringify({ query }),
		headers: {
			Authorization: apiKey,
			"Content-Type": "application/json",
		},
		method: "POST",
	});

	if (!response.ok) {
		throw new Error(`Linear API returned ${response.status}`);
	}

	const payload = (await response.json()) as {
		data?: {
			viewer?: {
				assignedIssues?: LinearConnectionPage;
			};
		};
		errors?: Array<{ message?: string }>;
	};

	if (payload.errors?.length) {
		throw new Error(payload.errors[0]?.message || "Linear API error");
	}

	return payload.data?.viewer?.assignedIssues ?? {};
}

async function countAssignedIssues(
	apiKey: string,
	stateType: "started" | "unstarted",
): Promise<number> {
	let count = 0;
	let cursor: string | undefined;

	for (;;) {
		const page = await fetchAssignedIssuesPage(apiKey, stateType, cursor);
		count += page.nodes?.length ?? 0;

		if (!page.pageInfo?.hasNextPage || !page.pageInfo.endCursor) {
			return count;
		}

		cursor = page.pageInfo.endCursor;
	}
}

/** Fetch a summary of assigned Linear issues (in-progress and todo counts). */
export async function getLinearSummary(): Promise<
	{ in_progress: number; todo: number } | { error: string }
> {
	const apiKey = getLinearApiKey();
	if (!apiKey) {
		return { error: "LINEAR token not configured" };
	}

	try {
		const [inProgress, todo] = await Promise.all([
			countAssignedIssues(apiKey, "started"),
			countAssignedIssues(apiKey, "unstarted"),
		]);

		return {
			in_progress: inProgress,
			todo,
		};
	} catch (error) {
		return {
			error:
				error instanceof Error
					? error.message
					: "Failed to load Linear summary",
		};
	}
}
