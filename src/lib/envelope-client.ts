import {
	type CliClient,
	createClaudeCodeClient,
	createCodexClient,
	createGeminiClient,
} from "@howells/envelope";

export type EnvelopeProvider = "claude" | "codex" | "gemini";

const PROVIDER_LABELS: Record<EnvelopeProvider, string> = {
	claude: "Claude",
	codex: "Codex",
	gemini: "Gemini",
};

/** Resolve the local CLI provider used by @howells/envelope. */
export function resolveEnvelopeProvider(
	env: NodeJS.ProcessEnv = process.env,
): EnvelopeProvider {
	const explicit = env.SIFT_LLM_PROVIDER?.trim().toLowerCase();
	if (explicit === "claude" || explicit === "codex" || explicit === "gemini") {
		return explicit;
	}

	// Nested Claude Code sessions can deadlock when spawning another claude CLI.
	return env.CLAUDECODE === "1" ? "gemini" : "claude";
}

/** Create the configured @howells/envelope CLI client. */
export function createSiftEnvelopeClient(
	provider: EnvelopeProvider = resolveEnvelopeProvider(),
): CliClient {
	switch (provider) {
		case "codex":
			return createCodexClient({
				model: "gpt-5.3-codex",
				timeoutMs: 300_000,
				options: {
					sandbox: "read-only",
				},
			});
		case "gemini":
			return createGeminiClient({
				model: "gemini-3-flash-preview",
				timeoutMs: 300_000,
				options: { approvalMode: "plan" },
			});
		default:
			return createClaudeCodeClient({
				model: "sonnet",
				maxBudgetUsd: 5,
				timeoutMs: 300_000,
				options: {
					retries: 1,
					retryDelayMs: 800,
				},
			});
	}
}

/** Human-readable provider label for progress output. */
export function getEnvelopeProviderLabel(
	provider: EnvelopeProvider = resolveEnvelopeProvider(),
): string {
	return PROVIDER_LABELS[provider];
}
