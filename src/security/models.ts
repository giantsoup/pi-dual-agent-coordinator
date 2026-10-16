import type { Model } from "@mariozechner/pi-ai";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

export const SMART_MODEL = "openai/gpt-6-luna";
export const EXECUTION_MODEL = "openai/gpt-5.4";
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
export function createSecureModelRegistry(authStorage = AuthStorage.inMemory()): ModelRegistry {
  const registry = ModelRegistry.inMemory(authStorage);
  const builtins = registry.getAll().filter((model) => model.provider === "openai" && model.id !== luna.id);
  // Pi requires an auth field when registering metadata. This inert value is never used
  // for inference; runtime startup must retrieve Keychain auth and replace it with a broker capability.
  registry.registerProvider("openai", { apiKey: "broker-not-configured", baseUrl: luna.baseUrl, models: [...builtins, luna] });
  return registry;
}
