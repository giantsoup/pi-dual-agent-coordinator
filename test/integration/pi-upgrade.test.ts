import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { Type } from "typebox";
import { ManagedSession } from "../../src/runtime/managed-session.js";
import { createRoleRuntime } from "../../src/runtime/create-role-runtime.js";
import { readSessionArchive, readSessionHistory } from "../../src/runtime/session-history.js";
import { createSecureModelCatalog } from "../../src/security/models.js";
import { fixtureChatResponse, fixtureChatToolResponse, fixtureResponse } from "../../src/security/fixture-provider.js";
import { mcpParameters, assertMcpArguments } from "../../src/mcp/schema.js";

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "pi-upgrade-")); roots.push(root);
  const cwd = join(root, "workspace"); await mkdir(cwd);
  return { cwd, sessionRoot: join(root, "state"), root };
}

it("keeps concurrent A/B brokers isolated across catalog construction, offline refresh, reload, and replacement", async () => {
  const options = await workspace();
  const fetch = globalThis.fetch;
  const destinations: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    expect(url.hostname).toBe("127.0.0.1");
    expect(["/v1/responses", "/v1/chat/completions"]).toContain(url.pathname);
    destinations.push(url.pathname);
    return fetch(input, init);
  });
  const load = vi.fn(async () => `dummy-${randomUUID()}`);
  const create = (role: "A" | "B") => createRoleRuntime({ ...options, role, sessionMode: "memory", providerTestBackend: {
    cwd: options.cwd, modelIds: [], load, request: async (url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe(role === "A" ? "gpt-6-luna" : "qwen/qwen3.8-27b");
      expect(url).toBe(role === "A" ? "https://api.openai.com/v1/responses" : "http://127.0.0.1:1234/v1/chat/completions");
      return role === "A" ? fixtureResponse("A_ONLY") : fixtureChatResponse("B_ONLY");
    }
  } });
  const a = await create("A"); const b = await create("B");
  try {
    expect(load).toHaveBeenCalledOnce();
    for (let i = 0; i < 3; i++) createSecureModelCatalog().getAll();
    expect(destinations).toEqual([]);
    if (!(a.session instanceof ManagedSession) || !(b.session instanceof ManagedSession)) throw new Error("Expected real Pi sessions");
    const ar = a.session.piSession.modelRuntime; const br = b.session.piSession.modelRuntime;
    expect((await ar.getAvailable()).map((model) => model.id)).toEqual(["gpt-6-luna"]);
    expect((await br.getAvailable()).map((model) => model.id)).toEqual(["qwen/qwen3.8-27b"]);
    const at = (await ar.getAuth("openai"))?.auth.apiKey; const bt = (await br.getAuth("lm-studio"))?.auth.apiKey;
    expect(at).toBeTruthy(); expect(bt).toBeTruthy(); expect(at).not.toBe(bt);
    expect(await br.getAuth("openai")).toBeUndefined();
    await Promise.all([ar.refresh({ allowNetwork: true }), br.refresh({ allowNetwork: true })]);
    expect(destinations).toEqual([]);
    await Promise.all([a.session.prompt("first"), b.session.prompt("first")]);
    await a.runtime.newSession(); await a.rebind();
    await Promise.all([a.session.prompt("replacement"), b.session.prompt("second")]);
    expect(destinations.sort()).toEqual(["/v1/chat/completions", "/v1/chat/completions", "/v1/responses", "/v1/responses"]);
    expect(JSON.stringify(a.session.messages)).toContain("A_ONLY"); expect(JSON.stringify(a.session.messages)).not.toContain("B_ONLY");
    expect(JSON.stringify(b.session.messages)).toContain("B_ONLY"); expect(JSON.stringify(b.session.messages)).not.toContain("A_ONLY");
  } finally { await a.dispose(); await b.dispose(); }
}, 20_000);

it("preserves an old fixture and target system/tool state without activating persisted tools", async () => {
  const options = await workspace();
  const oldPath = join(options.root, "old.jsonl"); await copyFile("test/fixtures/sample-session-a.jsonl", oldPath);
  const oldBytes = await readFile(oldPath, "utf8");
  expect(readSessionHistory(oldPath).messages).toEqual([expect.objectContaining({ role: "user", content: "Plan the work" })]);
  expect(await readFile(oldPath, "utf8")).toBe(oldBytes);
  const binding = await createRoleRuntime({ ...options, role: "A", sessionMode: "persistent", noTools: true,
    providerTestBackend: { cwd: options.cwd, modelIds: [], load: async () => "dummy-fixture", request: async () => fixtureResponse("SAFE_REPLY") } });
  try {
    if (!(binding.session instanceof ManagedSession)) throw new Error("Expected real Pi session");
    const session = binding.session.piSession;
    session.sessionManager.appendMessage({ role: "system", content: "Historical system state", timestamp: 1,
      toolsAdded: [{ name: "write", description: "Hostile persisted tool", parameters: Type.Object({}) }] });
    session.refreshContext();
    await session.reload();
    expect(session.getAllTools()).toEqual([]); expect(session.getActiveToolNames()).toEqual([]);
    await binding.session.prompt("Inspect safely");
    if (!binding.sessionFile) throw new Error("Expected persistent session");
    const bytes = await readFile(binding.sessionFile, "utf8");
    expect(readSessionHistory(binding.sessionFile).messages.some((message) => message.role === "system")).toBe(true);
    expect(readSessionArchive(binding.sessionFile).entries.some((entry) => entry.message?.role === "system")).toBe(true);
    expect(await readFile(binding.sessionFile, "utf8")).toBe(bytes);
    await binding.runtime.switchSession(binding.sessionFile); await binding.rebind();
    expect(binding.session.piSession.getAllTools()).toEqual([]);
    expect(JSON.stringify(binding.session.messages)).toContain("SAFE_REPLY");
    const corrupt = join(options.root, "missing-parent.jsonl");
    await writeFile(corrupt, JSON.stringify({ type: "session", version: 3, id: "old", cwd: options.cwd, timestamp: new Date().toISOString() }) + "\n" + JSON.stringify({ type: "custom", id: "child", parentId: "missing", timestamp: new Date().toISOString(), customType: "marker", data: {} }) + "\n");
    const corruptBytes = await readFile(corrupt, "utf8");
    expect(() => readSessionHistory(corrupt)).toThrow("Missing session parent");
    expect(() => readSessionArchive(corrupt)).toThrow("Missing session parent");
    expect(await readFile(corrupt, "utf8")).toBe(corruptBytes);
  } finally { await binding.dispose(); }
});

it("rejects malformed final tool JSON through the real provider without writing a partial argument", async () => {
  const options = await workspace(); let requests = 0;
  const binding = await createRoleRuntime({ ...options, role: "B", sessionMode: "memory", providerTestBackend: {
    cwd: options.cwd, modelIds: [], request: async () => {
      requests++;
      if (requests > 1) return fixtureChatResponse("Invalid tool call was rejected");
      const response = fixtureChatToolResponse("write", { path: "must-not-exist", content: "partial" });
      return new Response((await response.text()).replace('\\"content\\":\\"partial\\"}', '\\"content\\":'), { headers: response.headers });
    }
  } });
  try {
    await binding.session.prompt("Use write");
    expect(requests).toBe(2);
    await expect(readFile(join(options.cwd, "must-not-exist"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(binding.session.messages?.some((message) => message.role === "toolResult" && message.isError)).toBe(true);
  } finally { await binding.dispose(); }
});

it("validates dynamic MCP schemas and arguments for canonical TypeBox declarations", () => {
  const tool = { name: "strict", inputSchema: { type: "object" as const, properties: { count: { type: "integer", minimum: 1 } }, required: ["count"], additionalProperties: false } };
  expect(mcpParameters(tool.inputSchema)).toMatchObject({ type: "object" });
  expect(() => assertMcpArguments(tool, { count: 2 })).not.toThrow();
  for (const args of [{}, { count: "2" }, { count: 0 }, { count: 2, extra: true }]) expect(() => assertMcpArguments(tool, args)).toThrow("Invalid arguments");
  expect(() => mcpParameters({ type: "object", properties: { count: { type: "invalid-type" } } })).toThrow();
  expect(() => mcpParameters({ type: "object", $async: true })).toThrow("Async MCP schemas");
  for (const [draft, tuple] of [
    ["http://json-schema.org/draft-07/schema#", { items: [{ type: "string" }, { type: "number" }], additionalItems: false }],
    ["https://json-schema.org/draft/2020-12/schema", { prefixItems: [{ type: "string" }, { type: "number" }], items: false }]
  ] as const) {
    const tupleTool = { name: "tuple", inputSchema: { type: "object" as const, $schema: draft,
      properties: { pair: { type: "array", ...tuple } }, required: ["pair"] } };
    expect(() => assertMcpArguments(tupleTool, { pair: ["item", 2] })).not.toThrow();
    expect(() => assertMcpArguments(tupleTool, { pair: ["item", "wrong"] })).toThrow("Invalid arguments");
    expect(() => assertMcpArguments(tupleTool, { pair: ["item", 2, 3] })).toThrow("Invalid arguments");
  }
});

it("restores a copied 0.67.68 session through the target SessionManager and keeps its original fixture intact", async () => {
  const options = await workspace();
  const original = await readFile("test/fixtures/sample-session-a.jsonl", "utf8");
  let body = "";
  const binding = await createRoleRuntime({ ...options, role: "A", sessionMode: "persistent",
    providerTestBackend: { cwd: options.cwd, modelIds: [], load: async () => "dummy-history", request: async (_url, init) => {
      body = String(init?.body); return fixtureResponse("Resumed safely");
    } } });
  try {
    const directory = join(options.sessionRoot, "A"); await mkdir(directory, { recursive: true });
    const copy = join(directory, "old-copy.jsonl");
    const [header, ...entries] = original.trim().split("\n");
    if (!header) throw new Error("Missing old fixture header");
    const copiedHeader: unknown = JSON.parse(header);
    if (!copiedHeader || typeof copiedHeader !== "object") throw new Error("Invalid fixture header");
    await writeFile(copy, [JSON.stringify({ ...copiedHeader, cwd: options.cwd }), ...entries].join("\n") + "\n");
    const before = await readFile(copy, "utf8"); readSessionHistory(copy);
    expect(await readFile(copy, "utf8")).toBe(before);
    await binding.runtime.switchSession(copy); await binding.rebind();
    expect(binding.session.sessionId).toBe("sample-a");
    await binding.session.prompt("Continue the retained plan");
    expect(body).toContain("Plan the work"); expect(body).toContain("Continue the retained plan");
    expect(JSON.stringify(binding.session.messages)).toContain("Resumed safely");
    expect(await readFile("test/fixtures/sample-session-a.jsonl", "utf8")).toBe(original);
  } finally { await binding.dispose(); }
});

it("bounds the no-tools smoke to one upstream request and 1024 output tokens without a cache warmer", async () => {
  const options = await workspace();
  const request = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    expect(body.max_output_tokens).toBe(1024);
    expect(body.tools ?? []).toEqual([]);
    return fixtureResponse("LOCAL_API_OK");
  });
  const binding = await createRoleRuntime({ ...options, role: "A", sessionMode: "memory", noTools: true, thinkingOverride: "high",
    providerTestBackend: { cwd: options.cwd, modelIds: [], load: async () => "dummy-bounded", request } });
  try {
    if (!(binding.session instanceof ManagedSession)) throw new Error("Expected real Pi session");
    const session = binding.session.piSession;
    expect(session.getAllTools()).toEqual([]);
    expect(session.cacheWarmingStatus).toBeUndefined();
    await binding.session.prompt("Reply exactly LOCAL_API_OK");
    await session.reload();
    expect(session.getAllTools()).toEqual([]);
    await binding.session.prompt("A second request must fail closed");
    expect(request).toHaveBeenCalledOnce();
    expect(binding.session.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "error" });
  } finally { await binding.dispose(); }
});
