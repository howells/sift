import { spawnSync } from "node:child_process";

export function getDailyNote(): { path?: string; error?: string } {
	const result = spawnSync("obsi", ["daily", "--json"], {
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
		timeout: 30_000,
	});

	if (result.error) {
		return { error: result.error.message };
	}

	if (result.status !== 0) {
		return { error: (result.stderr || "notes command failed").trim() };
	}

	try {
		return JSON.parse(result.stdout) as { path?: string };
	} catch {
		return { error: "Failed to parse notes output" };
	}
}
