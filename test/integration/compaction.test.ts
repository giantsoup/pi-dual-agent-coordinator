import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import { createRoleRuntime } from "../../src/runtime/create-role-runtime.js";
import { createProviderBroker } from "../../src/security/provider-broker.js";
import { fixtureChatResponse } from "../../src/security/fixture-provider.js";

it("preserves a sanitized context-overflow category through the broker", async () => {
  const broker = await createProviderBroker({ provider: "lm-studio", cwd: "/unused", modelIds: ["qwen/qwen3.8-27b"],
    request: async () => new Response(JSON.stringify({ error: { code: "context_length_exceeded", message: "private upstream data" } }), { status: 400 }) });
  try {
    const response = await fetch(`${broker.baseUrl}/chat/completions`, { method: "POST",
      headers: { Authorization: `Bearer ${broker.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "qwen/qwen3.8-27b" }) });
    const text = await response.text();
    expect(text).toContain("context_length_exceeded");
    expect(text).not.toContain("private upstream data");
  } finally { await broker.close(); }
});

it.each([false, true])("stops B compaction without a trusted A summarizer, broken model label=%s", async (brokenLabel) => {
  const original = process.cwd();
  const root = await mkdtemp(join(tmpdir(), "pi-compaction-"));
  const cwd = join(root, "workspace"); await mkdir(cwd);
  const manager = SessionManager.inMemory(cwd);
  manager.appendMessage({ role: "user", content: "Earlier objective", timestamp: 1 });
  manager.appendMessage({ role: "user", content: "Historical context ".repeat(6000), timestamp: 1 });
  let calls = 0;
  const binding = await createRoleRuntime({ role: "B", cwd, sessionRoot: join(root, "state"), sessionMode: "memory", initialSessionManager: manager, summaryModel: brokenLabel ? () => { throw new Error("Broken summary model metadata"); } : undefined,
    providerTestBackend: { cwd, modelIds: [], load: async () => { throw new Error("No B cloud auth"); }, request: async () => {
      calls++;
      const response = fixtureChatResponse("working");
      return new Response((await response.text()).replace('"prompt_tokens":10', '"prompt_tokens":100000'), { headers: response.headers });
    } } });
  try {
    await expect(binding.session.prompt("Continue")).rejects.toThrow(/compaction/i);
    expect(calls).toBeLessThanOrEqual(1);
  } finally { await binding.dispose(); process.chdir(original); await rm(root, { recursive: true, force: true }); }
});

it.each([{ fail: false, large: false }, { fail: true, large: false }, { fail: false, large: true }])("uses independent A summaries in a real B tool loop, failure=$fail, underreported large tool=$large", async ({ fail, large }) => {
  const original = process.cwd();
  const root = await mkdtemp(join(tmpdir(), "pi-compaction-loop-"));
  const cwd = join(root, "workspace"); await mkdir(cwd);
  const manager = SessionManager.inMemory(cwd);
  manager.appendMessage({ role: "user", content: "Preserve this objective", timestamp: 1 });
  manager.appendMessage({ role: "user", content: "Historical context ".repeat(6000), timestamp: 1 });
  const { fixtureResponse, fixtureChatToolResponse } = await import("../../src/security/fixture-provider.js");
  const { readFile } = await import("node:fs/promises");
  const written = large ? "漢".repeat(30000) : "write exactly once";
  let summaries = 0; let executions = 0;
  const a = await createRoleRuntime({ role: "A", cwd, sessionRoot: join(root, "state"), sessionMode: "memory",
    providerTestBackend: { cwd, modelIds: [], load: async () => "dummy-summary-key", request: async (url, init) => {
      expect(String(url)).toBe("https://api.openai.com/v1/responses");
      expect(JSON.parse(String(init?.body)).tools ?? []).toEqual([]);
      summaries++;
      return fail ? new Response("private summary failure", { status: 503 }) : fixtureResponse("Objective preserved. The file was written. Continue by reporting the verified result.");
    } } });
  const summarize = a.summarizeCompaction;
  if (!summarize) throw new Error("Missing A summary capability");
  const b = await createRoleRuntime({ role: "B", cwd, sessionRoot: join(root, "state"), sessionMode: "memory", initialSessionManager: manager, summarizeCompaction: summarize,
    providerTestBackend: { cwd, modelIds: [], load: async () => { throw new Error("B must not load cloud auth"); }, request: async (url) => {
      expect(String(url)).toBe("http://127.0.0.1:1234/v1/chat/completions");
      executions++;
      if (executions === 1) {
        const response = fixtureChatToolResponse("write", { path: "result.txt", content: written });
        return new Response((await response.text()).replace('"prompt_tokens":10', large ? '"prompt_tokens":10' : '"prompt_tokens":100000'), { headers: response.headers });
      }
      return fixtureChatResponse("Finished");
    } } });
  const lifecycle: string[] = [];
  const unsubscribe = b.session.subscribeCompaction?.((event) => lifecycle.push(event.type));
  try {
    if (fail) await expect(b.session.prompt("Write result.txt then report")).rejects.toThrow(/compaction/i);
    else await b.session.prompt("Write result.txt then report");
    expect(await readFile(join(cwd, "result.txt"), "utf8")).toBe(written);
    expect(executions).toBe(fail ? 1 : 2);
    if (large) expect(summaries).toBeGreaterThan(0); else expect(summaries).toBe(1);
    expect(lifecycle).toEqual(["started", fail ? "failed" : "completed"]);
    expect(b.session.sessionManager?.getEntries?.().filter((entry) => entry.type === "compaction")).toHaveLength(fail ? 0 : 1);
    if (!fail) {
      for (let index = 0; index < 45; index++) manager.appendMessage({ role: "user", content: `Completed observation ${index}: ` + "Retained followup ".repeat(180), timestamp: Date.now() });
      await b.session.prompt("Report the existing verified result without repeating its write.");
      const checkpoints = manager.getEntries().filter((entry) => entry.type === "compaction");
      expect(checkpoints.length).toBeGreaterThanOrEqual(2);
      const latest = checkpoints.at(-1);
      expect(latest?.type === "compaction" ? latest.details : undefined).toMatchObject({ schema: 1, summarizerRole: "A", modifiedFiles: ["result.txt"] });
      expect(await readFile(join(cwd, "result.txt"), "utf8")).toBe(written);
    }
  } finally { unsubscribe?.(); await b.dispose(); await a.dispose(); process.chdir(original); await rm(root, { recursive: true, force: true }); }
});
