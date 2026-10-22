import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoleRuntime } from "../../src/runtime/create-role-runtime.js";
import { ManagedSession } from "../../src/runtime/managed-session.js";
import { RuntimeEventBridge, OperationStoppedError } from "../../src/coordinator/bind-runtime-events.js";
import { repairResponse, ResponseFormatError } from "../../src/coordinator/response-repair.js";
import { fixtureResponse, fixtureChatResponse, fixtureChatToolResponse } from "../../src/security/fixture-provider.js";
import { extractAssistantText } from "../../src/handoff/handoff-envelope.js";
import { TelemetryLogger } from "../../src/telemetry/logger.js";
import { Metrics } from "../../src/telemetry/metrics.js";
import { readSessionArchive, readSessionHistory } from "../../src/runtime/session-history.js";

const roots: string[] = [];
const originalCwd = process.cwd();
afterEach(async () => { process.chdir(originalCwd); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("isolated formatting submission lifecycle", () => {
  it.each(["provider", "native-call", "budget"] as const)("drains a %s failure without aborting or poisoning the execution session", async (failure) => {
    const root = await mkdtemp(join(tmpdir(), "pi-repair-failure-")); roots.push(root);
    const cwd = join(root, "workspace"); await mkdir(cwd);
    const role = failure === "budget" ? "A" : "B";
    let requests = 0;
    let denyBudget = false;
    const binding = await createRoleRuntime({ cwd, role, sessionRoot: join(root, "state"), sessionMode: "memory",
      providerTestBackend: { cwd, modelIds: [], load: async () => "fixture-key",
        countRequest: async () => Response.json({ object: "response.input_tokens", input_tokens: denyBudget ? 10_000_000 : 100 }),
        request: async () => {
          requests++;
          if (requests === 2 && failure === "provider") throw new Error("fixture provider failure");
          if (requests === 2 && failure === "native-call") return fixtureChatToolResponse("write", { path: "repeated.txt", content: "MUST_NOT_RUN" });
          return (role === "A" ? fixtureResponse : fixtureChatResponse)(requests === 1 ? "original response" : "continued");
        }
      }
    });
    if (!(binding.session instanceof ManagedSession)) throw new Error("Missing managed session");
    const session = binding.session;
    const abort = vi.spyOn(session, "abort");
    const compactions: string[] = [];
    session.subscribe((event) => { if (event.type === "compaction_start") compactions.push(event.reason); });
    const bridge = new RuntimeEventBridge(new TelemetryLogger({ filePath: join(root, "events"), jsonLogs: false, verbose: false }), new Metrics());
    await bridge.bind(binding);
    try {
      await bridge.promptAndWaitForTurnEnd(binding, "Initial task");
      const tools = session.piSession.getActiveToolNames();
      const context = JSON.stringify(session.messages);
      denyBudget = failure === "budget";
      const result = await bridge.promptAndWaitForTurnEnd(binding, "Correct the report only", { formatting: {}, responseId: "format-response" }).catch((error: unknown) => error);
      expect(result).toBeInstanceOf(Error);
      expect(result instanceof ResponseFormatError).toBe(failure === "native-call");
      expect(requests).toBe(failure === "budget" ? 1 : 2);
      expect(abort).not.toHaveBeenCalled();
      expect(compactions).toEqual([]);
      expect(session.piSession.getActiveToolNames()).toEqual(tools);
      expect(JSON.stringify(session.messages)).toBe(context);
      await expect(readFile(join(cwd, "repeated.txt"))).rejects.toMatchObject({ code: "ENOENT" });
      denyBudget = false;
      expect(extractAssistantText(await bridge.promptAndWaitForTurnEnd(binding, "Continue normal work"))).toBe("continued");
      expect(session.piSession.getActiveToolNames()).toEqual(tools);
    } finally { bridge.dispose(); await binding.dispose(); }
  }, 20_000);

  it.each([false, true])("keeps execution tools and context unchanged while formatting drains, cancellation=%s", async (cancel) => {
    const root = await mkdtemp(join(tmpdir(), "pi-repair-isolated-")); roots.push(root);
    const cwd = join(root, "workspace"); await mkdir(cwd);
    let calls = 0; let entered = () => {}; let release = () => {};
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const toolCounts: number[] = [];
    const binding = await createRoleRuntime({ cwd, role: "B", sessionRoot: join(root, "state"), sessionMode: "persistent",
      providerTestBackend: { cwd, modelIds: [], load: async () => "fixture-key", request: async (_url, init) => {
        calls++;
        const body: unknown = JSON.parse(String(init?.body));
        toolCounts.push(body && typeof body === "object" && "tools" in body && Array.isArray(body.tools) ? body.tools.length : 0);
        if (calls === 1) return fixtureChatToolResponse("write", { path: "once.txt", content: "original" }, "write-once");
        if (calls === 2) return fixtureChatResponse("invalid report");
        if (calls === 3) {
          entered();
          if (cancel) return new Promise<Response>((_resolve, reject) => {
            const aborted = () => reject(new Error("fixture formatter cancelled"));
            if (init?.signal?.aborted) aborted(); else init?.signal?.addEventListener("abort", aborted, { once: true });
          });
          await gate;
          return fixtureChatResponse("valid report");
        }
        if (calls === 4) return fixtureChatToolResponse("read", { path: "once.txt" }, "read-after-format");
        return fixtureChatResponse("continued");
      } }
    });
    if (!(binding.session instanceof ManagedSession)) throw new Error("Missing managed session");
    const session = binding.session;
    const tools = session.piSession.getActiveToolNames();
    const bridge = new RuntimeEventBridge(new TelemetryLogger({ filePath: join(root, "events"), jsonLogs: false, verbose: false }), new Metrics());
    await bridge.bind(binding);
    const controller = new AbortController(); bridge.beginOperation(controller.signal);
    const work = repairResponse({ bridge, binding, kind: "completion", identifiers: { requestId: "request" }, shape: "Return valid report",
      submit: (responseId) => bridge.promptAndWaitForTurnEnd(binding, "Write once.txt once and report", { responseId }),
      validate: (message) => extractAssistantText(message) === "valid report" ? { value: true } : { reason: "Expected valid report" }
    });
    const outcome = work.then((value) => value, (error: unknown) => error);
    try {
      await ready;
      expect(session.piSession.getActiveToolNames()).toEqual(tools);
      expect(session.isStreaming).toBe(true);
      expect(toolCounts.slice(0, 2).every((count) => count > 0)).toBe(true);
      expect(toolCounts[2]).toBe(0);
      const context = JSON.stringify(session.messages);
      expect(context).not.toContain("Coordinator repair prompt");
      expect(context).not.toContain("toolsRemoved");
      if (cancel) { controller.abort(); await session.abort(); } else release();
      const result = await outcome;
      if (cancel) expect(result).toBeInstanceOf(OperationStoppedError); else expect(result).toBe(true);
      expect(JSON.stringify(session.messages)).toBe(context);
      expect(session.piSession.getActiveToolNames()).toEqual(tools);
      expect(await readFile(join(cwd, "once.txt"), "utf8")).toBe("original");
      expect(calls).toBe(3);
      if (!cancel) {
        const archive = readSessionArchive(session.sessionFile ?? "");
        expect(archive.entries.some((entry) => Array.isArray(entry.message?.content) && entry.message.content.some((part) => part.text === "valid report"))).toBe(true);
        expect(readSessionHistory(session.sessionFile ?? "").messages.some((message) => extractAssistantText(message) === "valid report")).toBe(false);
      }
      bridge.beginOperation(new AbortController().signal);
      const next = await bridge.promptAndWaitForTurnEnd(binding, "Read the existing file");
      expect(extractAssistantText(next)).toBe("continued");
      expect(toolCounts.slice(3).every((count) => count > 0)).toBe(true);
      expect(session.piSession.getActiveToolNames()).toEqual(tools);
    } finally { release(); bridge.dispose(); await binding.dispose(); }
  }, 20_000);
});
