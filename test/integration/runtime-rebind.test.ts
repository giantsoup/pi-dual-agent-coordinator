import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { Coordinator } from "../../src/coordinator/coordinator.js";
import type { CreateRoleRuntimeOptions } from "../../src/runtime/create-role-runtime.js";
import { createFakeBinding, FakeRuntime, FakeSession } from "../helpers/fakes.js";
import { SessionLedger } from "../../src/persistence/session-ledger.js";

describe("runtime rebind", () => {
  it("replaces a runtime and tears down old subscriptions", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-rebind-"));
    const runtimes = new Map<string, FakeRuntime>();

    const coordinator = new Coordinator({
      cwd: process.cwd(),
      sessionRoot: root,
      sessionMode: "memory",
      jsonLogs: false,
      verbose: false,
      createRoleRuntime: async (options: CreateRoleRuntimeOptions) => {
        const runtime = new FakeRuntime(
          process.cwd(),
          new FakeSession(`${options.role}-session-1`, join(root, `${options.role}.jsonl`)),
          options.role
        );
        runtimes.set(options.role, runtime);
        return createFakeBinding(options.role, runtime);
      }
    });

    await coordinator.start();
    const runtimeA = runtimes.get("A");
    const originalSession = runtimeA?.session;

    await coordinator.replaceRuntime("A", { type: "new", role: "A" });

    expect(originalSession?.listeners.size).toBe(0);
    expect(originalSession?.unsubscribeCalls).toBeGreaterThan(0);
    expect(runtimeA?.createdSessions.at(-1)?.bindExtensionsCalls).toBeGreaterThan(0);

    await coordinator.dispose();
  });

  it("supersedes an active recovered workflow when a runtime is replaced", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-rebind-active-"));
    const ledger = new SessionLedger(join(root, "ledger", "handoffs.jsonl"));
    await ledger.append({
      workflowId: "wf-active",
      handoffId: "h-1",
      iteration: 1,
      status: "prepared",
      role: "A",
      requestId: "req-1",
      sessionId: "a-1",
      timestamp: new Date().toISOString()
    });

    const coordinator = new Coordinator({
      cwd: process.cwd(),
      sessionRoot: root,
      sessionMode: "persistent",
      jsonLogs: false,
      verbose: false,
      createRoleRuntime: async (options: CreateRoleRuntimeOptions) => {
        const runtime = new FakeRuntime(
          process.cwd(),
          new FakeSession(`${options.role}-session-1`, join(root, `${options.role}.jsonl`)),
          options.role
        );
        return createFakeBinding(options.role, runtime);
      }
    });

    await coordinator.start();
    await coordinator.replaceRuntime("A", { type: "new", role: "A" });

    const status = await coordinator.getWorkflowStatus();
    expect(status.state.activeWorkflowId).toBeUndefined();
    expect(status.state.workflows["wf-active"]?.status).toBe("blocked");
    expect(status.ledgerTail?.status).toBe("superseded");

    await coordinator.dispose();
  });
});
