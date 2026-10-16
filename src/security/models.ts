import type { Api, Model } from "@mariozechner/pi-ai";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { Role } from "../types/role.js";

export const SMART_MODEL = "openai/gpt-6-luna";
export const EXECUTION_MODEL = "lm-studio/qwen3.6-35b-a3b";
export const LM_STUDIO_BASE_URL = "http://127.0.0.1:1234/v1";
export const SMOKE_MAX_TOKENS = 1024;

// Official model/pricing pages verified 2026-10-16. Pi 0.67.68 lacks this catalog entry.
// The installed OpenAI Responses provider supports high reasoning without a code change.
const luna: Model<"openai-responses"> = {
  id: "gpt-6-luna", name: "GPT-6 Luna", provider: "openai", api: "openai-responses",
  baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"],
  contextWindow: 1_050_000, maxTokens: 128_000,
  // Standard short-context USD per million tokens. Not an exact long-context billing estimate.
  cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 }
};
const localModels: Model<"openai-completions">[] = [
  { id: "qwen3.6-35b-a3b", name: "Qwen3.6 35B A3B (LM Studio)" },
  { id: "qwen3-coder-next", name: "Qwen3 Coder Next (LM Studio)" }
].map((model) => ({
  ...model, provider: "lm-studio", api: "openai-completions", baseUrl: LM_STUDIO_BASE_URL,
  reasoning: false, input: ["text"], contextWindow: 65_536, maxTokens: 16_384,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" }
}));

export function isRoleModel(role: Role, model: Model<Api>): boolean {
  return role === "A"
    ? model.provider === "openai" && model.api === "openai-responses" && model.baseUrl === luna.baseUrl
    : model.provider === "lm-studio" && model.api === "openai-completions" && model.baseUrl === LM_STUDIO_BASE_URL
      && localModels.some((candidate) => candidate.id === model.id);
}

export function createSecureModelRegistry(authStorage = AuthStorage.inMemory()): ModelRegistry {
  const registry = ModelRegistry.inMemory(authStorage);
  const builtins = registry.getAll().filter((model) => model.provider === "openai" && model.id !== luna.id);
  // Pi requires an auth field when registering metadata. This inert value is never used
  // for inference; runtime startup must retrieve Keychain auth and replace it with a broker capability.
  registry.registerProvider("openai", { apiKey: "broker-not-configured", baseUrl: luna.baseUrl, models: [...builtins, luna] });
  registry.registerProvider("lm-studio", { apiKey: "broker-not-configured", baseUrl: LM_STUDIO_BASE_URL, api: "openai-completions", models: localModels });
  return registry;
}
