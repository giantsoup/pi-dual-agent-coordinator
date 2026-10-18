import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkflowOrchestrator } from "../../src/coordinator/workflow-orchestrator.js";
import { RuntimeEventBridge } from "../../src/coordinator/bind-runtime-events.js";
import { createEmptyHandoffState, replayHandoffState } from "../../src/coordinator/handoff-state-machine.js";
import { SessionLedger } from "../../src/persistence/session-ledger.js";
import { TelemetryLogger } from "../../src/telemetry/logger.js";
import { Metrics } from "../../src/telemetry/metrics.js";
import { assistantTurnEnd, createFakeBinding, FakeRuntime, FakeSession } from "../helpers/fakes.js";
import type { NormalizedTelemetryEvent } from "../../src/types/telemetry.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const block = (name: string, value: unknown) => `\`\`\`${name}\n${JSON.stringify(value)}\n\`\`\``;

describe.each(["handoff", "review", "cap", "completion"] as const)("%s required response budget", (target) => {
  it.each([1, 2, 10, Infinity])("accepts attempt %s or exhausts without advancing execution", async (successAt) => {
    const root = await mkdtemp(join(tmpdir(), "pi-repair-workflow-")); roots.push(root);
    const logger = new TelemetryLogger({ filePath: join(root, "events"), jsonLogs: false, verbose: false });
    const metrics = new Metrics(); const bridge = new RuntimeEventBridge(logger, metrics);
    const events: NormalizedTelemetryEvent[] = []; logger.subscribe((event) => events.push(event));
    const ledger = new SessionLedger(join(root, "ledger"));
    let workflowId = ""; let executed = false; let attempts = 0;
    const handoff = () => ({ schemaVersion: 1, workflowId, handoffId: "handoff-1", iteration: 1, objective: "Work", summary: "Plan", acceptanceCriteria: ["done"], relevantPaths: ["file"] });
    const final = () => ({ schemaVersion: 1, workflowId, iteration: 1, decision: "blocked", summary: "Needs operator", userResponse: "Intentional blocker", changedPaths: [] });
    const sessionA = new FakeSession("A", undefined, async (text) => {
      workflowId ||= /Workflow ID: ([^\n]+)/.exec(text)?.[1] ?? "";
      const targeted = target === "handoff" ? !executed : executed && (target === "review" || target === "cap");
      if (targeted && ++attempts < successAt) {
        await sessionA.emit(assistantTurnEnd(executed ? block("pi-final", { ...final(), iteration: 2 }) : block("pi-check-in", {})));
      } else await sessionA.emit(assistantTurnEnd(executed ? block("pi-final", final()) : block("pi-handoff", handoff())));
    });
    const sessionB = new FakeSession("B", undefined, async () => {
      executed = true;
      await sessionB.emit(assistantTurnEnd(block("pi-completion", { schemaVersion: 1, workflowId,
        handoffId: target === "completion" && ++attempts < successAt ? "stale" : "handoff-1", iteration: 1, summary: "Done", changedPaths: [] })));
    });
    const bindingA = createFakeBinding("A", new FakeRuntime(root, sessionA, "A"));
    const bindingB = createFakeBinding("B", new FakeRuntime(root, sessionB, "B"));
    await bridge.bind(bindingA); await bridge.bind(bindingB);
    const orchestrator = new WorkflowOrchestrator(ledger, bridge, logger, metrics, () => {}, () => {});
    try {
      const result = await orchestrator.run({ bindingA, bindingB, requestId: "request", userTask: "Work", maxReviewRounds: target === "cap" ? 1 : 3, state: createEmptyHandoffState() });
      expect(attempts).toBe(Math.min(successAt, 10));
      if (successAt === Infinity) expect(result.result.userResponse).toContain("Workflow blocked");
      else expect(result.result.userResponse).toBe("Intentional blocker");
      const records = await ledger.loadAll(); const repairs = records.filter((record) => record.status === "repair_requested");
      expect(repairs).toHaveLength(Math.min(successAt, 10) - 1);
      expect(repairs.every((record) => record.iteration === 1)).toBe(true);
      const replayed = replayHandoffState(records);
      expect(replayed.workflows[workflowId]).toMatchObject({ currentIteration: 1, repairCount: repairs.length, status: "blocked" });
      expect(replayed).toEqual(result.state);
      expect(sessionB.prompts.filter((text) => text.includes('provenance="coordinator_handoff"'))).toHaveLength(target === "handoff" && successAt === Infinity ? 0 : 1);
      expect(events.filter((event) => event.eventType === "response.exhausted")).toHaveLength(successAt === Infinity ? 1 : 0);
    } finally { bridge.dispose(); }
  });
});
