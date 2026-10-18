import type { Api, Model } from "@mariozechner/pi-ai";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { Role } from "../types/role.js";

export const SMART_MODEL = "openai/gpt-6-luna";
export const EXECUTION_MODEL = "lm-studio/qwen3.6-35b-a3b";
export const LM_STUDIO_BASE_URL = "http://127.0.0.1:1234/v1";
export const SMOKE_MAX_TOKENS = 1024;

// Manually maintained picker catalog. Sources: docs/research/model-picker/design.md.
export const gptModelChoices = [
  { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", description: "Complex coding and planning", cost: { input: 2, output: 10, cacheRead: .1, cacheWrite: 2.5 } },
  { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", description: "Balanced reasoning", cost: { input: 2, output: 12, cacheRead: .2, cacheWrite: 2.5 } },
  { id: "gpt-6-luna", name: "GPT-6 Luna", description: "Fast, efficient planning", cost: { input: .1, output: .5, cacheRead: .01, cacheWrite: .125 } }
];
const gptModels: Model<"openai-responses">[] = gptModelChoices.map((model) => ({
  ...model, provider: "openai", api: "openai-responses",
  baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"],
  contextWindow: 1_050_000, maxTokens: 128_000,
}));
export function createLocalModel(input: { id: string; name: string; contextWindow?: number; vision?: boolean }): Model<"openai-completions"> {
  return { id: input.id, name: input.name, provider: "lm-studio", api: "openai-completions", baseUrl: LM_STUDIO_BASE_URL,
    reasoning: false, input: input.vision ? ["text", "image"] : ["text"], contextWindow: input.contextWindow ?? 65_536, maxTokens: 16_384,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" } };
}
const localModels: Model<"openai-completions">[] = [
  { id: "qwen3.6-35b-a3b", name: "Qwen3.6 35B A3B (LM Studio)" },
  { id: "qwen3-coder-next", name: "Qwen3 Coder Next (LM Studio)" }
].map(createLocalModel);

export function isRoleModel(role: Role, model: Model<Api>, discovered: Model<"openai-completions">[] = []): boolean {
  return role === "A"
    ? model.provider === "openai" && model.api === "openai-responses" && model.baseUrl === "https://api.openai.com/v1"
    : model.provider === "lm-studio" && model.api === "openai-completions" && model.baseUrl === LM_STUDIO_BASE_URL
      && [...localModels, ...discovered].some((candidate) => candidate.id === model.id);
}

export function createSecureModelRegistry(authStorage = AuthStorage.inMemory(), discovered: Model<"openai-completions">[] = []): ModelRegistry {
  const registry = ModelRegistry.inMemory(authStorage);
  const builtins = registry.getAll().filter((model) => model.provider === "openai" && !gptModels.some((current) => current.id === model.id));
  // Pi requires an auth field when registering metadata. This inert value is never used
  // for inference; runtime startup must retrieve Keychain auth and replace it with a broker capability.
  registry.registerProvider("openai", { apiKey: "broker-not-configured", baseUrl: "https://api.openai.com/v1", models: [...builtins, ...gptModels] });
  registry.registerProvider("lm-studio", { apiKey: "broker-not-configured", baseUrl: LM_STUDIO_BASE_URL, api: "openai-completions", models: [...new Map([...localModels, ...discovered].map((model) => [model.id, model])).values()] });
  return registry;
}
