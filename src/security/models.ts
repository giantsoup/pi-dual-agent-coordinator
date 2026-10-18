import type { Api, Model } from "@earendil-works/pi-ai";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import type { Role } from "../types/role.js";

export const SMART_MODEL = "openai/gpt-6-luna";
export const QWEN38_MODEL_ID = "qwen/qwen3.8-27b";
export const EXECUTION_MODEL = `lm-studio/${QWEN38_MODEL_ID}`;
export function defaultLocalThinking(modelId: string): "xhigh" | "off" {
  return modelId === QWEN38_MODEL_ID || modelId === EXECUTION_MODEL ? "xhigh" : "off";
}
export const LM_STUDIO_BASE_URL = "http://127.0.0.1:1234/v1";
export const SMOKE_MAX_TOKENS = 1024;

// Manually maintained picker catalog. Sources: docs/research/model-picker/design.md.
export const gptModelChoices = [
  { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", description: "Complex coding and planning" },
  { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", description: "Balanced reasoning" },
  { id: "gpt-6-luna", name: "GPT-6 Luna", description: "Fast, efficient planning" }
];
// Keep the original approved IDs explicit. A catalog update cannot grant a new model.
const approvedOpenaiIds = new Set([
  "gpt-4", "gpt-4-turbo", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o",
  "gpt-4o-2024-05-13", "gpt-4o-2024-08-06", "gpt-4o-2024-11-20", "gpt-4o-mini",
  "gpt-5", "gpt-5-chat-latest", "gpt-5-codex", "gpt-5-mini", "gpt-5-nano", "gpt-5-pro",
  "gpt-5.1", "gpt-5.1-chat-latest", "gpt-5.1-codex", "gpt-5.1-codex-max", "gpt-5.1-codex-mini",
  "gpt-5.2", "gpt-5.2-chat-latest", "gpt-5.2-codex", "gpt-5.2-pro", "gpt-5.3-chat-latest",
  "gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.4-pro",
  "o1", "o1-pro", "o3", "o3-deep-research", "o3-mini", "o3-pro", "o4-mini", "o4-mini-deep-research",
  ...gptModelChoices.map((model) => model.id)
]);
const openaiModels = getBuiltinModels("openai").filter((model) =>
  approvedOpenaiIds.has(model.id) && model.api === "openai-responses" && model.baseUrl === "https://api.openai.com/v1");
for (const choice of gptModelChoices) {
  if (!openaiModels.some((model) => model.id === choice.id && model.reasoning)) throw new Error(`Missing trusted model metadata: ${choice.id}`);
}
export function createLocalModel(input: { id: string; name: string; contextWindow?: number; vision?: boolean }): Model<"openai-completions"> {
  const reasoning = input.id === QWEN38_MODEL_ID;
  return { id: input.id, name: input.name, provider: "lm-studio", api: "openai-completions", baseUrl: LM_STUDIO_BASE_URL,
    reasoning, ...(reasoning ? { thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: null, xhigh: "xhigh", max: null } } : {}), input: input.vision ? ["text", "image"] : ["text"], contextWindow: input.contextWindow ?? 65_536, maxTokens: 16_384,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: reasoning, maxTokensField: "max_tokens" } };
}
const localModels: Model<"openai-completions">[] = [
  { id: "qwen/qwen3.8-27b", name: "Qwen3.8 27B (LM Studio)" },
  { id: "qwen3.6-35b-a3b", name: "Qwen3.6 35B A3B (LM Studio)" },
  { id: "qwen3-coder-next", name: "Qwen3 Coder Next (LM Studio)" }
].map(createLocalModel);

export function isRoleModel(role: Role, model: Model<Api>, discovered: Model<"openai-completions">[] = []): boolean {
  return role === "A"
    ? approvedOpenaiIds.has(model.id) && model.provider === "openai" && model.api === "openai-responses" && model.baseUrl === "https://api.openai.com/v1"
    : model.provider === "lm-studio" && model.api === "openai-completions" && model.baseUrl === LM_STUDIO_BASE_URL
      && [...localModels, ...discovered].some((candidate) => candidate.id === model.id);
}

/** Metadata only: no credentials, runtime construction, files, refresh, or network. */
export function createSecureModelCatalog(discovered: Model<"openai-completions">[] = []) {
  const models: Model<Api>[] = [...openaiModels, ...new Map([...localModels, ...discovered].map((model) => [model.id, model])).values()];
  return {
    getAll: () => [...models],
    find: (provider: string, id: string) => models.find((model) => model.provider === provider && model.id === id)
  };
}
