import { SessionManager } from "@earendil-works/pi-coding-agent";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createRoleRuntime } from "../../src/runtime/create-role-runtime.js";
import { ManagedSession } from "../../src/runtime/managed-session.js";
import { createProviderBroker } from "../../src/security/provider-broker.js";
import { EXECUTION_MODEL, LM_STUDIO_BASE_URL } from "../../src/security/models.js";
import { fixtureChatResponse, fixtureChatToolResponse } from "../../src/security/fixture-provider.js";
import { Coordinator } from "../../src/coordinator/coordinator.js";

const roots: string[] = [];
const originalCwd = process.cwd();
afterEach(async () => { process.chdir(originalCwd); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "pi-local-executor-")); roots.push(root);
  const cwd = join(root, "workspace"); await mkdir(cwd);
  return { cwd, sessionRoot: join(root, "state"), sessionMode: "memory" as const };
}

it("runs Agent B tool calls through the local broker without loading an OpenAI credential", async () => {
  const options = await workspace();
  const load = vi.fn(async () => { throw new Error("Must never retrieve the cloud key"); });
  const request = vi.fn<typeof fetch>(async (url, init) => {
    expect(url).toBe(`${LM_STUDIO_BASE_URL}/chat/completions`);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer lm-studio");
    expect(init?.redirect).toBe("error");
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("qwen/qwen3.8-27b");
    expect(body.max_tokens).toBe(16384);
    expect(body.reasoning_effort).toBe("xhigh");
    return body.messages.some((message: { role: string }) => message.role === "tool")
      ? fixtureChatResponse("LOCAL_TOOL_OK")
      : fixtureChatToolResponse("write", { path: "local-result.txt", content: "LOCAL_TOOL_OK" });
  });
  const binding = await createRoleRuntime({ ...options, role: "B", providerTestBackend: { ...options, modelIds: [], load, request } });
  try {
    expect(binding.session.model?.provider).toBe("lm-studio");
    expect(binding.session.thinkingLevel).toBe("xhigh");
    await binding.session.prompt("Write local-result.txt, then confirm.");
    expect(await readFile(join(options.cwd, "local-result.txt"), "utf8")).toBe("LOCAL_TOOL_OK");
    expect(JSON.stringify(binding.session.messages?.at(-1))).toContain("LOCAL_TOOL_OK");
    expect(request).toHaveBeenCalledTimes(2);
    expect(load).not.toHaveBeenCalled();
    if (!(binding.session instanceof ManagedSession)) throw new Error("Missing managed Pi session");
    expect(binding.session.piSession.autoCompactionEnabled).toBe(false);
    expect(binding.session.piSession.getAllTools().some((tool) => tool.name === "write")).toBe(true);
  } finally { await binding.dispose(); }
});

it("fails locally without a cloud fallback when LM Studio is unavailable", async () => {
  const options = await workspace();
  const request = vi.fn<typeof fetch>(async () => { throw new Error("connection refused"); });
  const load = vi.fn(async () => { throw new Error("No cloud auth"); });
  const binding = await createRoleRuntime({ ...options, role: "B", providerTestBackend: { ...options, modelIds: [], request, load } });
  try {
    await binding.session.prompt("hello");
    expect(binding.session.messages?.at(-1)).toMatchObject({ role: "assistant", stopReason: "error" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(String(request.mock.calls[0]?.[0])).toBe(`${LM_STUDIO_BASE_URL}/chat/completions`);
    expect(load).not.toHaveBeenCalled();
  } finally { await binding.dispose(); }
});

it("requires trusted A summarization instead of local self-compaction", async () => {
  const options = await workspace();
  let calls = 0;
  const load = vi.fn(async () => { throw new Error("No cloud auth"); });
  const manager = SessionManager.inMemory(options.cwd);
  manager.appendMessage({ role: "user", content: "Earlier task to preserve", timestamp: 1 });
  manager.appendMessage({ role: "user", content: "Historical context ".repeat(6000), timestamp: 1 });
  const binding = await createRoleRuntime({ ...options, initialSessionManager: manager, role: "B", providerTestBackend: { ...options, modelIds: [], load,
    request: async (url, init) => {
      expect(url).toBe(`${LM_STUDIO_BASE_URL}/chat/completions`);
      expect(JSON.parse(String(init?.body)).model).toBe("qwen/qwen3.8-27b");
      calls++;
      if (calls === 1) {
        const response = fixtureChatResponse("Working context");
        return new Response((await response.text()).replace('"prompt_tokens":10', '"prompt_tokens":100000'), { headers: response.headers });
      }
      return fixtureChatResponse("Preserved local task summary");
    }
  } });
  try {
    await expect(binding.session.prompt("Continue the local task")).rejects.toThrow(/compaction/i);
    expect(calls).toBe(1);
    expect(load).not.toHaveBeenCalled();
    expect(binding.session.messages?.some((message) => message.role === "compactionSummary")).toBe(false);
  } finally { await binding.dispose(); }
});

it("restricts each role's startup and model picker to its own provider", async () => {
  const options = await workspace();
  await expect(createRoleRuntime({ ...options, role: "B", modelOverride: "openai/gpt-5.4" })).rejects.toThrow("local LM Studio");
  await expect(createRoleRuntime({ ...options, role: "A", modelOverride: EXECUTION_MODEL })).rejects.toThrow("OpenAI Responses");
  const coordinator = new Coordinator({ ...options, jsonLogs: false, verbose: false });
  expect(coordinator.getAvailableModels("B").map((model) => model.canonical)).toEqual([EXECUTION_MODEL, "lm-studio/qwen3.6-35b-a3b", "lm-studio/qwen3-coder-next"]);
  expect(coordinator.getAvailableModels("A").every((model) => model.canonical.startsWith("openai/"))).toBe(true);
});

it("rejects unauthorized local broker operations and redirected upstream responses", async () => {
  const request = vi.fn<typeof fetch>(async () => new Response("", { status: 302, headers: { Location: "https://example.invalid" } }));
  const broker = await createProviderBroker({ cwd: "/unused", provider: "lm-studio", modelIds: ["qwen3.6-35b-a3b"], request });
  const headers = { Authorization: `Bearer ${broker.token}`, "Content-Type": "application/json" };
  try {
    expect((await fetch(`${broker.baseUrl}/chat/completions`, { method: "POST", body: "{}" })).status).toBe(403);
    expect((await fetch(`${broker.baseUrl}/responses`, { method: "POST", headers, body: "{}" })).status).toBe(400);
    expect((await fetch(`${broker.baseUrl}/chat/completions`, { method: "POST", headers, body: JSON.stringify({ model: "gpt-5.4" }) })).status).toBe(502);
    expect(request).not.toHaveBeenCalled();
    expect((await fetch(`${broker.baseUrl}/chat/completions`, { method: "POST", headers, body: JSON.stringify({ model: "qwen3.6-35b-a3b" }) })).status).toBe(502);
    expect(request).toHaveBeenCalledTimes(1);
  } finally { await broker.close(); }
});

it("pins local inference to the verified instance even when restoration changes its alias", async () => {
  let alias = "first-instance";
  const request = vi.fn<typeof fetch>(async () => fixtureChatResponse("Alias answer"));
  const broker = await createProviderBroker({ cwd: "/unused", provider: "lm-studio", modelIds: ["logical-model"], resolveLocalInstanceId: async () => alias, request });
  const headers = { Authorization: `Bearer ${broker.token}`, "Content-Type": "application/json" };
  try {
    for (const next of ["first-instance", "restored-instance"]) {
      alias = next;
      const response = await fetch(`${broker.baseUrl}/chat/completions`, { method: "POST", headers, body: JSON.stringify({ model: "logical-model" }) });
      await response.text();
      expect(JSON.parse(String(request.mock.lastCall?.[1]?.body))).toMatchObject({ model: next, reasoning_effort: "none" });
    }
    const response = await fetch(`${broker.baseUrl}/models/load`, { method: "POST", headers, body: JSON.stringify({ model: "logical-model" }) });
    expect(response.status).toBe(400); await response.text();
    expect(request).toHaveBeenCalledTimes(2);
  } finally { await broker.close(); }
});

it.each(["off", "low", "medium", "xhigh"] as const)("forwards Qwen3.8 %s reasoning through the real Pi adapter", async thinking => {
  const options = await workspace();
  const bodies: unknown[] = [];
  const binding = await createRoleRuntime({ ...options, role: "B", thinkingOverride: thinking, providerTestBackend: { ...options, modelIds: [],
    request: async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return fixtureChatResponse("Reasoning setting accepted"); }
  } });
  try {
    expect(binding.session.thinkingLevel).toBe(thinking);
    await binding.session.prompt("Check reasoning settings");
    expect(bodies).toEqual([expect.objectContaining({ reasoning_effort: thinking === "off" ? "none" : thinking })]);
  } finally { await binding.dispose(); }
});
it("rejects unsupported Qwen3.8 high reasoning instead of silently clamping it", async () => {
  const options = await workspace();
  await expect(createRoleRuntime({ ...options, role: "B", thinkingOverride: "high", providerTestBackend: { ...options, modelIds: [], request: async () => fixtureChatResponse("unused") } })).rejects.toThrow("Unsupported reasoning level");
});

it("rejects forged Qwen3.8 reasoning effort at the broker boundary", async () => {
  const request = vi.fn<typeof fetch>(async () => fixtureChatResponse("unused"));
  const broker = await createProviderBroker({ cwd: "/unused", provider: "lm-studio", modelIds: ["qwen/qwen3.8-27b"], request });
  try {
    for (const effort of ["high", "minimal", "max", { unsafe: true }]) {
      const response = await fetch(`${broker.baseUrl}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${broker.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "qwen/qwen3.8-27b", reasoning_effort: effort }) });
      expect(response.status).toBe(502);
      await response.text();
    }
    expect(request).not.toHaveBeenCalled();
  } finally { await broker.close(); }
});
