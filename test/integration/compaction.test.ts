import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { assistantMessage } from "../helpers/fakes.js";
import { createRoleRuntime, getRoleSessionDirectory } from "../../src/runtime/create-role-runtime.js";
import { SUMMARY_OUTPUT_TOKENS } from "../../src/runtime/context-budget.js";
import { createProviderBroker } from "../../src/security/provider-broker.js";
import { fixtureResponse, fixtureChatResponse } from "../../src/security/fixture-provider.js";

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
  const binding = await createRoleRuntime({ role: "B", cwd, agentDir: join(root, "agent"), sessionRoot: join(root, "state"), sessionMode: "memory", initialSessionManager: manager, summaryModel: brokenLabel ? () => { throw new Error("Broken summary model metadata"); } : undefined,
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
  const a = await createRoleRuntime({ role: "A", cwd, agentDir: join(root, "agent"), sessionRoot: join(root, "state"), sessionMode: "memory",
    providerTestBackend: { cwd, modelIds: [], load: async () => "dummy-summary-key", request: async (url, init) => {
      expect(String(url)).toBe("https://api.openai.com/v1/responses");
      expect(JSON.parse(String(init?.body)).tools ?? []).toEqual([]);
      summaries++;
      return fail ? new Response("private summary failure", { status: 503 }) : fixtureResponse("Objective preserved. The file was written. Continue by reporting the verified result.");
    } } });
  const summarize = a.summarizeCompaction;
  if (!summarize) throw new Error("Missing A summary capability");
  const b = await createRoleRuntime({ role: "B", cwd, agentDir: join(root, "agent"), sessionRoot: join(root, "state"), sessionMode: "memory", initialSessionManager: manager, summarizeCompaction: summarize,
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
      for (let index = 0; index < 75; index++) manager.appendMessage({ role: "user", content: `Completed observation ${index}: ` + "Retained followup ".repeat(180), timestamp: Date.now() });
      await b.session.prompt("Report the existing verified result without repeating its write.");
      const checkpoints = manager.getEntries().filter((entry) => entry.type === "compaction");
      expect(checkpoints.length).toBeGreaterThanOrEqual(2);
      const latest = checkpoints.at(-1);
      expect(latest?.type === "compaction" ? latest.details : undefined).toMatchObject({ schema: 1, summarizerRole: "A", modifiedFiles: ["result.txt"] });
      expect(await readFile(join(cwd, "result.txt"), "utf8")).toBe(written);
    }
  } finally { unsubscribe?.(); await b.dispose(); await a.dispose(); process.chdir(original); await rm(root, { recursive: true, force: true }); }
});


it.each(["success", "persisted success", "summary failure", "checkpoint failure", "cancel", "oversized input"])("compacts an oversized latest A response with %s", async (outcome) => {
  const original = process.cwd();
  const root = await mkdtemp(join(tmpdir(), "pi-compaction-budget-"));
  const cwd = join(root, "workspace"); await mkdir(cwd);
  const success = outcome === "success" || outcome === "persisted success";
  const sessionMode = outcome === "persisted success" ? "persistent" : "memory";
  const directory = getRoleSessionDirectory(cwd, "A", join(root, "state"));
  await mkdir(directory, { recursive: true });
  const manager = sessionMode === "persistent" ? SessionManager.create(cwd, directory) : SessionManager.inMemory(cwd);
  manager.appendMessage({ role: "user", content: "Preserve the approved objective.", timestamp: 1 });
  const latest = "Latest verified result: progress.txt was written exactly once.";
  manager.appendMessage({ ...assistantMessage(latest), model: "gpt-6-luna", content: [
    { type: "thinking", thinking: "", thinkingSignature: JSON.stringify({ type: "reasoning", id: "rs_fixture", summary: [], encrypted_content: "opaque-reasoning-" + "a".repeat(320000) }) },
    { type: "text", text: latest }
  ] });
  const archived = structuredClone(manager.getEntries());
  let summaries = 0; let continuations = 0;
  let cancellation: Promise<void> | undefined;
  const binding = await createRoleRuntime({ role: "A", cwd, agentDir: join(root, "agent"), sessionRoot: join(root, "state"), sessionMode, initialSessionManager: manager,
    providerTestBackend: { cwd, modelIds: [], load: async () => "dummy-budget-key", request: async (_url, init) => {
      const body = String(init?.body);
      expect(body).not.toContain("opaque-reasoning-");
      if (body.includes(`"max_output_tokens":${SUMMARY_OUTPUT_TOKENS}`)) {
        summaries++;
        expect(body).toContain(latest);
        if (outcome === "cancel") cancellation = binding.session.abort();
        if (outcome === "summary failure") return new Response("private upstream failure", { status: 503 });
        return fixtureResponse(latest);
      }
      continuations++;
      expect(body).toContain(latest);
      return fixtureResponse("Check-in completed.");
    } } });
  const checkpoint = outcome === "checkpoint failure" ? vi.spyOn(manager, "appendCompaction").mockImplementation(() => {
    throw new Error("Checkpoint fixture failure sk-privatecheckpointsecret " + "x".repeat(2000));
  }) : undefined;
  const lifecycle: string[] = [];
  const unsubscribe = binding.session.subscribeCompaction?.((event) => lifecycle.push(event.type));
  try {
    const prompt = binding.session.prompt(outcome === "oversized input" ? "x".repeat(320000) : "Continue with the check-in.");
    if (success) await prompt;
    else if (outcome === "cancel") await expect(prompt).rejects.toThrow(/cancelled/i);
    else if (outcome === "checkpoint failure") {
      const error = await prompt.catch((error: unknown) => error);
      expect(error).toBeInstanceOf(Error);
      if (!(error instanceof Error)) throw new Error("Expected checkpoint failure");
      expect(error.message).toContain("Checkpoint fixture failure [REDACTED]");
      expect(error.message.length).toBeLessThan(1700);
    } else await expect(prompt).rejects.toThrow(outcome === "oversized input" ? /Context budget exceeded/ : /compaction/i);
    await cancellation;
    expect(summaries).toBe(1);
    expect(continuations).toBe(success ? 1 : 0);
    expect(manager.getEntries().slice(0, archived.length)).toEqual(archived);
    const completed = success || outcome === "oversized input";
    expect(manager.getEntries().filter((entry) => entry.type === "compaction")).toHaveLength(completed ? 1 : 0);
    expect(lifecycle).toEqual(["started", completed ? "completed" : outcome === "cancel" ? "cancelled" : "failed"]);
    if (sessionMode === "persistent") {
      const path = manager.getSessionFile();
      if (!path) throw new Error("Missing persisted fixture session");
      const reopened = SessionManager.open(path);
      expect(reopened.buildSessionProjection().messages).toEqual(manager.buildSessionProjection().messages);
      expect(reopened.getEntries().slice(0, archived.length)).toEqual(archived);
    }
  } finally { checkpoint?.mockRestore(); unsubscribe?.(); await binding.dispose(); process.chdir(original); await rm(root, { recursive: true, force: true }); }
});

it.each(["memory", "persistent"] as const)("writes once, compacts, then performs a correlated native read with %s archive", async (sessionMode) => {
  const { readFile } = await import("node:fs/promises");
  const { fixtureChatToolResponse } = await import("../../src/security/fixture-provider.js");
  const { readSessionArchive } = await import("../../src/runtime/session-history.js");
  const original = process.cwd();
  const root = await mkdtemp(join(tmpdir(), "pi-write-compact-read-"));
  const cwd = join(root, "workspace"); await mkdir(cwd);
  const directory = getRoleSessionDirectory(cwd, "B", join(root, "state")); await mkdir(directory, { recursive: true });
  const manager = sessionMode === "persistent" ? SessionManager.create(cwd, directory) : SessionManager.inMemory(cwd);
  manager.appendMessage({ role: "user", content: "Preserve approved objective. " + "x".repeat(100000), timestamp: 1 });
  const written = "VERIFIED_NATIVE_WRITE\n" + "y".repeat(40000);
  let requests = 0; let writes = 0; let summaries = 0;
  const events: string[] = [];
  const a = await createRoleRuntime({ role: "A", cwd, agentDir: join(root, "agent"), sessionRoot: join(root, "state"), sessionMode: "memory",
    providerTestBackend: { cwd, modelIds: [], load: async () => "dummy-write-compact-key", request: async () => {
      summaries++; return fixtureResponse("result.txt was written exactly once. Read it natively, then report. Never repeat the write.");
    } } });
  const b = await createRoleRuntime({ role: "B", cwd, agentDir: join(root, "agent"), sessionRoot: join(root, "state"), sessionMode,
    initialSessionManager: manager, summarizeCompaction: a.summarizeCompaction, onMutation: () => { writes++; },
    providerTestBackend: { cwd, modelIds: [], load: async () => { throw new Error("B cloud auth forbidden"); }, request: async () => {
      requests++;
      if (requests === 1) return fixtureChatToolResponse("write", { path: "result.txt", content: written }, "write-once");
      if (requests === 2) {
        expect(events).toContain("compaction:completed");
        return fixtureChatToolResponse("read", { path: "result.txt" }, "read-after-compaction");
      }
      return fixtureChatResponse("Observed the file after compaction.");
    } } });
  b.session.subscribeCompaction?.(event => events.push(`compaction:${event.type}`));
  b.session.subscribe(event => { if (event.type === "tool_execution_start") events.push(`tool:${event.toolName}`); });
  try {
    await b.session.prompt("Write result.txt exactly once, compact as necessary, read it, then stop.");
    expect(await readFile(join(cwd, "result.txt"), "utf8")).toBe(written);
    expect(writes).toBe(1); expect(requests).toBe(3); expect(summaries).toBe(1);
    expect(events).toEqual(["tool:write", "compaction:started", "compaction:completed", "tool:read"]);
    const read = b.session.messages?.find(message => message.role === "toolResult" && message.toolCallId === "read-after-compaction");
    expect(read).toMatchObject({ toolName: "read", isError: false });
    expect(JSON.stringify(read)).toContain("VERIFIED_NATIVE_WRITE");
    if (sessionMode === "persistent") {
      const path = manager.getSessionFile(); if (!path) throw new Error("Missing archive");
      const bytes = await readFile(path);
      const archive = readSessionArchive(path);
      expect(archive.entries.filter(entry => entry.message?.role === "assistant").flatMap(entry => Array.isArray(entry.message?.content) ? entry.message.content : []).filter(part => part.type === "toolCall" && part.name === "write")).toHaveLength(1);
      expect(await readFile(path)).toEqual(bytes);
    }
  } finally { await b.dispose(); await a.dispose(); process.chdir(original); await rm(root, { recursive: true, force: true }); }
}, 30_000);
