import type { Api, Model } from "@earendil-works/pi-ai";
import { z } from "zod";

export const CONTEXT_SAFETY_TOKENS = 4096;
export const SUMMARY_OUTPUT_TOKENS = 1536;
export class ContextManagementError extends Error {}
export class ContextBudgetExceededError extends ContextManagementError {}
export interface RequestBudget { inputTokens: number; outputTokens: number; contextWindow: number; method: string }
export type PayloadCounter = (payload: unknown, signal?: AbortSignal) => Promise<{ tokens: number; contextWindow: number; method: string; instanceId?: string }>;

const payloadSchema = z.object({
  model: z.string(), max_tokens: z.number().int().positive().optional(), max_output_tokens: z.number().int().positive().optional(),
  messages: z.array(z.json()).optional(), input: z.array(z.json()).optional(), instructions: z.string().optional(), tools: z.array(z.json()).optional()
});

/** Boundary allowance for byte-fallback text tokenizers; includes serialized tool schemas. */
export function textPayloadAllowance(payload: unknown): number {
  const parsed = payloadSchema.parse(JSON.parse(JSON.stringify(payload)));
  const input = { messages: parsed.messages, input: parsed.input, instructions: parsed.instructions, tools: parsed.tools };
  const serialized = JSON.stringify(input);
  if (serialized.includes('"image_url"') || serialized.includes('"input_image"')) {
    throw new ContextManagementError("Image context accounting is unavailable for this request. Use text evidence or a smaller text-only request.");
  }
  return Buffer.byteLength(serialized, "utf8") + 256 * ((parsed.messages ?? parsed.input ?? []).length + (parsed.tools?.length ?? 0));
}

export function assertRequestBudget(model: Model<Api>, payload: unknown, counted: { tokens: number; contextWindow: number; method: string }, outputAllowance?: number): RequestBudget {
  const parsed = payloadSchema.parse(JSON.parse(JSON.stringify(payload)));
  const requestedOutput = parsed.max_tokens ?? parsed.max_output_tokens;
  const outputTokens = requestedOutput === undefined ? undefined : Math.max(requestedOutput, outputAllowance ?? requestedOutput);
  if (parsed.model !== model.id || outputTokens === undefined || outputTokens > model.maxTokens || !Number.isSafeInteger(counted.tokens) || counted.tokens < 0 || !Number.isSafeInteger(counted.contextWindow) || counted.contextWindow <= 0) {
    throw new ContextManagementError("Unverifiable model request budget.");
  }
  const contextWindow = Math.min(model.contextWindow, counted.contextWindow);
  if (counted.tokens + outputTokens + CONTEXT_SAFETY_TOKENS > contextWindow) {
    throw new ContextBudgetExceededError(`Context budget exceeded (${counted.tokens} input + ${outputTokens} output + ${CONTEXT_SAFETY_TOKENS} safety > ${contextWindow}). History compaction or a smaller input is required; execution stopped.`);
  }
  return { inputTokens: counted.tokens, outputTokens, contextWindow, method: counted.method };
}

/** Restore the configured output allowance only on a payload that will pass admission. */
export function withOutputBudget(payload: unknown, api: Api, outputTokens: number) {
  const wire = z.record(z.string(), z.json()).parse(JSON.parse(JSON.stringify(payload)));
  if (api !== "openai-responses" && api !== "openai-completions") throw new ContextManagementError("Unsupported request budget API.");
  const field = api === "openai-responses" ? "max_output_tokens" : "max_tokens";
  delete wire[api === "openai-responses" ? "max_tokens" : "max_output_tokens"];
  return { ...wire, [field]: outputTokens };
}
