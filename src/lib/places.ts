import { spawnSync } from "node:child_process";

/** Return a structured error for when places functionality is unavailable. */
export function buildPlacesUnavailable(
	reason: "goplaces" | "api-key" | "unsupported",
): { error: string; source: string } {
	switch (reason) {
		case "api-key":
			return {
				error: "GOOGLE_PLACES_API_KEY not configured",
				source: "goplaces",
			};
		case "unsupported":
			return {
				error: "places subcommand not available",
				source: "goplaces",
			};
		default:
			return {
				error: "goplaces not available",
				source: "goplaces",
			};
	}
}

/** Check if the goplaces CLI is installed and responsive. */
export function isGoPlacesAvailable(): boolean {
	const result = spawnSync("goplaces", ["--version"], {
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
		timeout: 5_000,
	});

	return result.status === 0;
}

/** Check if the GOOGLE_PLACES_API_KEY environment variable is set. */
export function isGooglePlacesConfigured(): boolean {
	return Boolean(process.env.GOOGLE_PLACES_API_KEY?.trim());
}

function mapFlags(flags: Map<string, string | true>): string[] {
	const passthrough = new Set([
		"api-key",
		"base-url",
		"routes-base-url",
		"directions-base-url",
		"timeout",
		"limit",
		"page-token",
		"language",
		"region",
		"keyword",
		"type",
		"open-now",
		"min-rating",
		"price-level",
		"lat",
		"lng",
		"radius-m",
		"reviews",
		"photos",
		"verbose",
		"no-color",
	]);
	const result: string[] = [];

	for (const [key, value] of flags.entries()) {
		if (!passthrough.has(key)) {
			continue;
		}

		if (value === true) {
			result.push(`--${key}`);
		} else {
			result.push(`--${key}=${value}`);
		}
	}

	return result;
}

/** Run a goplaces subcommand (search, resolve, details) and return parsed JSON. */
export function executePlacesCommand(
	subcommand: string,
	args: string[],
	flags: Map<string, string | true>,
): unknown {
	if (!["details", "resolve", "search"].includes(subcommand)) {
		return buildPlacesUnavailable("unsupported");
	}

	if (!isGoPlacesAvailable()) {
		return buildPlacesUnavailable("goplaces");
	}

	if (!isGooglePlacesConfigured()) {
		return buildPlacesUnavailable("api-key");
	}

	const result = spawnSync(
		"goplaces",
		[subcommand, ...args, ...mapFlags(flags), "--json"],
		{
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
			timeout: 30_000,
		},
	);

	if (result.error) {
		return {
			error: result.error.message,
			source: "goplaces",
		};
	}

	if (result.status !== 0) {
		return {
			error: (result.stderr || "goplaces command failed").trim(),
			source: "goplaces",
		};
	}

	try {
		return JSON.parse(result.stdout) as unknown;
	} catch {
		return {
			error: "Failed to parse goplaces output",
			source: "goplaces",
		};
	}
}
