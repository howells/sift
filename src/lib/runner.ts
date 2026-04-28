import { runCli } from "../cli.ts";

export interface CommandResult {
	exitCode: number;
	stderr: string;
	stdout: string;
}

class ExitInterception extends Error {
	constructor(public code: number) {
		super(`process.exit(${code})`);
	}
}

/**
 * Run a sift CLI command in-process, capturing stdout, stderr and the
 * intended exit code without terminating the host process.
 *
 * The MCP server uses this to invoke commands without paying the cost of
 * spawning a fresh Node subprocess on every tool call.
 *
 * MCP transports serialize requests, so the global stdio interception is
 * safe as long as the host process does not have other concurrent writers
 * during the lifetime of `runCli`.
 */
export async function runSiftCommand(argv: string[]): Promise<CommandResult> {
	let stdout = "";
	let stderr = "";
	let exitCode = 0;

	const origStdoutWrite = process.stdout.write.bind(process.stdout);
	const origStderrWrite = process.stderr.write.bind(process.stderr);
	const origExit = process.exit.bind(process);

	process.stdout.write = ((chunk: unknown) => {
		stdout += typeof chunk === "string" ? chunk : String(chunk);
		return true;
	}) as typeof process.stdout.write;

	process.stderr.write = ((chunk: unknown) => {
		stderr += typeof chunk === "string" ? chunk : String(chunk);
		return true;
	}) as typeof process.stderr.write;

	process.exit = ((code?: number) => {
		exitCode = code ?? 0;
		throw new ExitInterception(exitCode);
	}) as typeof process.exit;

	try {
		await runCli(argv);
	} catch (error) {
		if (!(error instanceof ExitInterception)) {
			throw error;
		}
	} finally {
		process.stdout.write = origStdoutWrite;
		process.stderr.write = origStderrWrite;
		process.exit = origExit;
	}

	return { exitCode, stderr, stdout };
}

/**
 * Parse the first JSON object from a captured stdout buffer.
 *
 * Sift commands always emit one JSON object per invocation (NDJSON streams
 * one item per line, but the MCP surface forces JSON output regardless).
 */
export function parseJsonOutput(stdout: string): unknown {
	const trimmed = stdout.trim();
	if (!trimmed) {
		return null;
	}
	const firstNewline = trimmed.indexOf("\n");
	const candidate =
		firstNewline === -1 ? trimmed : trimmed.slice(0, firstNewline);
	return JSON.parse(candidate);
}

/**
 * Parse a captured stdout buffer that may be NDJSON.
 *
 * Returns `{ items, page }` where `items` collects every `{type:"item"}`
 * line and `page` is the trailing `{type:"page"}` record, mirroring the
 * structured shape of a non-NDJSON sift response.
 */
export function parseNdjsonOutput(stdout: string): {
	items: unknown[];
	page: unknown;
} {
	const items: unknown[] = [];
	let page: unknown = null;

	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		const parsed = JSON.parse(trimmed) as { type?: string; data?: unknown };
		if (parsed.type === "item") {
			items.push(parsed.data);
		} else if (parsed.type === "page") {
			page = parsed.data;
		}
	}

	return { items, page };
}
