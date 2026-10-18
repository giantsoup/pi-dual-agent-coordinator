import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRoleRuntime } from "../../src/runtime/create-role-runtime.js";
import { ManagedSession } from "../../src/runtime/managed-session.js";
import { RuntimeEventBridge, OperationStoppedError } from "../../src/coordinator/bind-runtime-events.js";
import { repairResponse } from "../../src/coordinator/response-repair.js";
import { fixtureResponse } from "../../src/security/fixture-provider.js";
import { extractAssistantText } from "../../src/handoff/handoff-envelope.js";
import { TelemetryLogger } from "../../src/telemetry/logger.js";
import { Metrics } from "../../src/telemetry/metrics.js";
const roots: string[] = [];
const originalCwd = process.cwd();
afterEach(async () => { process.chdir(originalCwd); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("real formatting submission lifecycle", () => {
  it.each([false, true])("drains compaction before restoring tools, cancellation=%s", async (cancel) => {
    const root = await mkdtemp(join(tmpdir(), "pi-repair-drain-")); roots.push(root);
    const cwd = join(root, "workspace"); await mkdir(cwd);
    let calls = 0; let entered = () => {}; let release = () => {};
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const binding = await createRoleRuntime({ cwd, role: "A", sessionRoot: join(root, "state"), sessionMode: "persistent",
      providerTestBackend: { cwd, modelIds: [], load: async () => "fixture-key", request: async (_url, init) => {
        calls++;
        if (calls === 1) return fixtureResponse("invalid");
        if (calls === 2) {
          const response = fixtureResponse("valid");
          return new Response((await response.text()).replace('"input_tokens":10', '"input_tokens":10000000'), { headers: response.headers });
        }
        entered();
        if (cancel) return new Promise<Response>((_resolve, reject) => {
          const aborted = () => { release(); reject(new Error("fixture compaction cancelled")); };
          if (init?.signal?.aborted) aborted(); else init?.signal?.addEventListener("abort", aborted, { once: true });
        });
        await gate;
        return fixtureResponse("Preserved fixture conversation summary");
      } }
    });
    if (!(binding.session instanceof ManagedSession)) throw new Error("Missing managed session");
    const session = binding.session;
    session.piSession.sessionManager.appendMessage({ role: "user", content: "Earlier task to preserve", timestamp: 1 });
    session.piSession.sessionManager.appendMessage({ role: "user", content: "Historical context ".repeat(6000), timestamp: 1 });
    const previous = session.piSession.getActiveToolNames();
    const logger = new TelemetryLogger({ filePath: join(root, "events"), jsonLogs: false, verbose: false });
    const bridge = new RuntimeEventBridge(logger, new Metrics()); await bridge.bind(binding);
    const controller = new AbortController(); bridge.beginOperation(controller.signal);
    let settled = false;
    const work = repairResponse({ bridge, binding, kind: "planning", identifiers: { requestId: "request" }, shape: "Nonempty prose valid",
      submit: (responseId) => bridge.promptAndWaitForTurnEnd(binding, "ORIGINAL_TASK", { responseId }),
      validate: (message) => extractAssistantText(message) === "valid" ? { value: true } : { reason: "Expected valid" }
    }).finally(() => { settled = true; });
    const outcome = work.then((value) => value, (error: unknown) => error);
    try {
      await ready;
      expect(settled).toBe(false); expect(session.piSession.getActiveToolNames()).toEqual([]);
      if (cancel) { controller.abort(); await binding.session.abort(); }
      else release();
      const result = await outcome;
      if (cancel) expect(result).toBeInstanceOf(OperationStoppedError); else expect(result).toBe(true);
      expect(calls).toBe(3);
      expect(session.piSession.getActiveToolNames()).toEqual(previous);
      await bridge.waitForIdle();
    } finally { release(); bridge.dispose(); await binding.dispose(); }
  }, 20_000);
});
