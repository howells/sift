import { describe, expect, it } from "vitest";
import {
	getEnvelopeProviderLabel,
	resolveEnvelopeProvider,
} from "./envelope-client.ts";

describe("resolveEnvelopeProvider", () => {
	it("defaults to Claude outside nested Claude Code", () => {
		expect(resolveEnvelopeProvider({})).toBe("claude");
	});

	it("uses Gemini when nested in Claude Code", () => {
		expect(resolveEnvelopeProvider({ CLAUDECODE: "1" })).toBe("gemini");
	});

	it("allows explicit provider selection", () => {
		expect(resolveEnvelopeProvider({ SIFT_LLM_PROVIDER: "codex" })).toBe(
			"codex",
		);
		expect(resolveEnvelopeProvider({ SIFT_LLM_PROVIDER: "Gemini" })).toBe(
			"gemini",
		);
	});

	it("returns provider labels for progress output", () => {
		expect(getEnvelopeProviderLabel("claude")).toBe("Claude");
		expect(getEnvelopeProviderLabel("codex")).toBe("Codex");
		expect(getEnvelopeProviderLabel("gemini")).toBe("Gemini");
	});
});
