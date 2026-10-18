import { redactText } from "./redact.js";
import { createAssistantMessageEventStream, createProvider, InMemoryCredentialStore, lazyApi, type Api, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

/** One role, one broker, no ambient authentication or remote catalog discovery. */
export async function createBrokerModelRuntime(model: Model<Api>, token: string): Promise<ModelRuntime> {
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null,
    refreshOnCreate: false, allowModelNetwork: false });
  const refresh = runtime.refresh.bind(runtime);
  let ready = false;
  // Registration asks for a background refresh. Initialization owns that work
  // explicitly; every subsequent refresh is offline and confined to this role.
  runtime.refresh = (input) => ready
    ? refresh({ ...input, allowNetwork: false, providers: [model.provider] })
    : Promise.resolve({ aborted: input?.signal?.aborted ?? false, errors: new Map<string, Error>() });
  const api = model.api === "openai-responses" ? lazyApi(() => import("@earendil-works/pi-ai/api/openai-responses"))
    : lazyApi(() => import("@earendil-works/pi-ai/api/openai-completions"));
  for (const provider of runtime.getProviders()) {
    if (provider.id === model.provider) continue;
    runtime.registerNativeProvider(createProvider({ id: provider.id, models: [], api,
      auth: { apiKey: { name: "Disabled provider", check: async () => undefined, resolve: async () => undefined } } }));
  }
  runtime.registerNativeProvider(createProvider({ id: model.provider, baseUrl: model.baseUrl, models: [model], api,
    auth: { apiKey: { name: "Private broker capability", check: async () => ({ type: "api_key" }),
      resolve: async () => ({ auth: { apiKey: token } }) } } }));
  await runtime.setRuntimeApiKey(model.provider, token);
  ready = true;
  const result = await runtime.refresh();
  if (result.errors.size) throw new Error("Broker model runtime initialization failed.");
  return runtime;
}

/** Pi stream callbacks report request failures through the stream protocol. */
export function failedModelStream(model: Model<Api>, error: unknown, aborted: boolean) {
  const stream = createAssistantMessageEventStream();
  const message: AssistantMessage = {
    role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
    timestamp: Date.now(), stopReason: aborted ? "aborted" : "error",
    errorMessage: redactText(error instanceof Error ? error.message : "Broker request failed."),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
  };
  stream.push({ type: "error", reason: aborted ? "aborted" : "error", error: message });
  stream.end();
  return stream;
}
