import { z } from "zod";
import { LmStudioModels } from "../../src/security/lm-studio.js";

export function localModelFixture(key: string, loaded: boolean, extra = {}) {
  return { type: "llm", key, display_name: key, max_context_length: 262144, capabilities: { trained_for_tool_use: true, vision: false },
    loaded_instances: loaded ? [{ id: `${key}-instance`, config: { context_length: 65536 } }] : [], ...extra };
}

export function lmStudioFixture() {
  const models = [localModelFixture("qwen3.6-35b-a3b", true), localModelFixture("qwen3-coder-next", false), localModelFixture("google/gemma-4-e4b", false)];
  const calls: { path: string; body?: { model?: string | undefined; context_length?: number | undefined; instance_id?: string | undefined } }[] = [];
  const failures = new Set<string>();
  let loadHook: ((key: string) => Promise<void>) | undefined;
  let shortContext = false;
  const request: typeof fetch = async (url, init) => {
    const parsed = new URL(String(url));
    if (parsed.origin !== "http://127.0.0.1:1234" || init?.redirect !== "error") throw new Error("Unexpected endpoint or redirect policy");
    if (new Headers(init?.headers).has("authorization")) throw new Error("Management must not receive credentials");
    if (init?.method === "GET") {
      calls.push({ path: parsed.pathname });
      return Response.json({ models: [...models, { type: "embedding", key: "nomic-embed" }] });
    }
    const body = z.object({ model: z.string().optional(), context_length: z.number().optional(), instance_id: z.string().optional() }).parse(JSON.parse(String(init?.body)));
    calls.push({ path: parsed.pathname, body });
    if (parsed.pathname.endsWith("/unload")) {
      for (const model of models) model.loaded_instances = model.loaded_instances.filter((instance) => instance.id !== body.instance_id);
      return Response.json({ instance_id: body.instance_id });
    }
    if (parsed.pathname.endsWith("/load")) {
      const key = body.model;
      if (!key) throw new Error("Missing model");
      await loadHook?.(key);
      if (failures.has(key)) return Response.json({ error: "Fixture load failed" }, { status: 503 });
      const model = models.find((model) => model.key === key);
      if (!model) return Response.json({}, { status: 404 });
      const id = `${key}-loaded-alias`;
      model.loaded_instances = [{ id, config: { context_length: shortContext && key === "qwen3-coder-next" ? 4096 : body.context_length ?? 65536 } }];
      return Response.json({ type: "llm", instance_id: id, status: "loaded" });
    }
    throw new Error("Unexpected management path");
  };
  return { models, calls, failures, request, host: new LmStudioModels({ request, timeoutMs: 300, pollMs: 2 }),
    onLoad(hook: (key: string) => Promise<void>) { loadHook = hook; }, useShortContext() { shortContext = true; } };
}
