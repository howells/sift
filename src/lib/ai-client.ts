import { createAI } from "@howells/ai";
import { Output, generateText } from "ai";
import type { z } from "zod";

/**
 * Model slugs must stay inside the OpenRouter guardrail allowlist on the key
 * (openrouter.ai/settings/privacy). A slug outside it fails closed with
 * "No endpoints available matching your guardrail restrictions", not a bill.
 */
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash-0731";

/** Fallback chain tried in order when the primary model is unavailable. */
const FALLBACK_MODELS = ["google/gemini-3.7-flash"];

const TIMEOUT_MS = 300_000;

/** Resolve the model slug, overridable for a one-off run or a local box. */
export function resolveSiftModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.SIFT_MODEL?.trim() || DEFAULT_MODEL;
}

/** Human-readable label for the active model, for progress output. */
export function getActiveProviderLabel(env: NodeJS.ProcessEnv = process.env): string {
  const model = resolveSiftModel(env);
  // "deepseek/deepseek-v4-flash-0731" -> "deepseek-v4-flash-0731"
  return model.split("/").at(-1) ?? model;
}

let cachedClient: ReturnType<typeof createAI> | null = null;

function getClient(): ReturnType<typeof createAI> {
  // Lazily constructed so importing this module never requires an API key —
  // `sift describe`, `--help` and the unit tests must work without one.
  cachedClient ??= createAI({
    app: { name: "sift", url: "https://github.com/howells/sift" },
  });
  return cachedClient;
}

interface EnvelopeSpec<TInput, TOutput> {
  /** Zod schema the caller's input is validated against before any spend. */
  input: z.ZodType<TInput>;
  /** Zod schema the model output is validated against. */
  output: z.ZodType<TOutput>;
  /** Render the user prompt for one call. */
  prompt: (input: TInput) => string;
}

/**
 * Build a typed LLM function: input in, schema-validated output out.
 *
 * Replaces `@howells/envelope`'s `createEnvelope`, which shelled out to the
 * local Claude/Codex/Gemini CLIs. That is fine on a laptop but a poor
 * dependency for a headless daemon, and it bypasses the OpenRouter spend
 * guardrail. Same call shape minus the `client` field, so callers barely move.
 */
export function createEnvelope<TInput, TOutput>(
  spec: EnvelopeSpec<TInput, TOutput>,
): (input: TInput) => Promise<TOutput> {
  return async (rawInput: TInput): Promise<TOutput> => {
    const input = spec.input.parse(rawInput);
    const ai = getClient();
    const modelId = resolveSiftModel();

    const { output } = await generateText({
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      model: ai.modelById(modelId, { provider: "openrouter" }),
      output: Output.object({ schema: spec.output }),
      prompt: spec.prompt(input),
      ...ai.generationOptions({
        fallbackModels: FALLBACK_MODELS,
        modelId,
        provider: "openrouter",
        // Triage is classification, not reasoning. Leaving thinking on made
        // deepseek-v4-flash spend minutes per batch reasoning before emitting
        // anything: 8 emails took 21s, 20 took roughly five minutes.
        reasoning: "off",
        structured: "strict",
      }),
    });

    // Output.object already validates, but parse again so the caller gets a
    // value typed by its own schema rather than the SDK's inferred shape.
    return spec.output.parse(output);
  };
}
