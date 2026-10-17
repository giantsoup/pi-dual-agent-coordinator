import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { RuntimeEventBridge } from "../../src/coordinator/bind-runtime-events.js";
import { createExecutionSupervisor, ExecutionCheckInError } from "../../src/coordinator/execution-supervisor.js";
import { TelemetryLogger } from "../../src/telemetry/logger.js";
import { Metrics } from "../../src/telemetry/metrics.js";
import { protectSecret } from "../../src/security/redact.js";
import type { HandoffEnvelope } from "../../src/types/handoff.js";
import { assistantMessage, assistantTurnEnd, createFakeBinding, FakeRuntime, FakeSession } from "../helpers/fakes.js";
import type { ModelTurnEnd } from "../../src/runtime/create-role-runtime.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const envelope: HandoffEnvelope = {
  schemaVersion: 1, workflowId: "workflow", handoffId: "handoff", requestId: "request", iteration: 1,
  objective: "Fix parser", summary: "Handle the empty case", relevantPaths: ["parser.ts"],
  acceptanceCriteria: ["Empty input returns an empty list"], executionPlan: ["Update parse() and run parser tests"]
};

function toolTurn(text = "Inspecting parser"): ModelTurnEnd {
  const message = assistantMessage(text);
  message.content.push({ type: "toolCall", id: "read", name: "read", arguments: { path: "parser.ts" } });
  return { type: "turn_end", message, toolResults: [] };
}

async function setup(response: (count: number) => Record<string, unknown> = () => ({ decision: "continue", nextSteps: [] })) {
  const root = await mkdtemp(join(tmpdir(), "pi-supervisor-")); roots.push(root);
  const bridge = new RuntimeEventBridge(new TelemetryLogger({ filePath: join(root, "events"), jsonLogs: false, verbose: false }), new Metrics());
  const session = new FakeSession("A", undefined, async (text) => {
    const turnCount = Number(/after (\d+) completed/.exec(text)?.[1]);
    await session.emit(assistantTurnEnd("```pi-check-in\n" + JSON.stringify({
      schemaVersion: 1, workflowId: envelope.workflowId, handoffId: envelope.handoffId, iteration: 1,
      turnCount, reason: "The last actions match the plan.", ...response(turnCount)
    }) + "\n```"));
  });
  const bindingA = createFakeBinding("A", new FakeRuntime(root, session, "A"));
  await bridge.bind(bindingA);
  const events: string[] = [];
  const progress: Record<string, unknown>[] = [];
  const supervisor = createExecutionSupervisor({ bindingA, bridge, envelope, cwd: root,
    setUiState: () => {}, logEvent: (type, details) => {
      if (type === "workflow.execution_progress") progress.push(details);
      else events.push(type);
    } });
  const signal = new AbortController().signal;
  const advance = async (count: number) => {
    const steering: string[] = [];
    for (let i = 0; i < count; i++) {
      const result = await supervisor(toolTurn(), signal);
      if (result) steering.push(result);
    }
    return steering;
  };
  return { bridge, session, supervisor, advance, signal, events, progress };
}

describe("execution supervisor", () => {
  it("publishes the same completed-turn counter for multi-tool turns and senior check-ins", async () => {
    const run = await setup();
    try {
      expect(run.progress.at(-1)).toMatchObject({ completedTurns: 0, checkIn: { kind: "scheduled", afterTurn: 10 } });
      for (let i = 0; i < 9; i++) {
        const turn = toolTurn();
        if (turn.message.role === "assistant") turn.message.content.push({ type: "toolCall", id: "second", name: "read", arguments: { path: "other.ts" } });
        await run.supervisor(turn, run.signal);
      }
      expect(run.session.prompts).toHaveLength(0);
      expect(run.progress.at(-1)).toMatchObject({ completedTurns: 9, checkIn: { kind: "scheduled", afterTurn: 10 } });
      await run.advance(1);
      expect(run.progress.slice(-2)).toMatchObject([
        { completedTurns: 10, checkIn: { kind: "checking", afterTurn: 10 } },
        { completedTurns: 10, checkIn: { kind: "scheduled", afterTurn: 20 } }
      ]);
      await run.supervisor({ type: "turn_end", message: assistantMessage("Finished"), toolResults: [] }, run.signal);
      expect(run.progress.at(-1)).toMatchObject({ completedTurns: 11, checkIn: { kind: "final_review" } });
    } finally { run.bridge.dispose(); }
  });
  it("checks every ten completed B turns and returns validated continue guidance", async () => {
    const run = await setup();
    try {
      expect(await run.advance(9)).toEqual([]);
      expect(run.session.prompts).toHaveLength(0);
      const steering = await run.advance(11);
      expect(steering).toHaveLength(2);
      expect(steering[0]).toContain("after turn 10: continue");
      expect(steering[1]).toContain("after turn 20: continue");
      expect(run.session.prompts[1]).not.toContain("Turn 1:");
    } finally { run.bridge.dispose(); }
  });

  it.each([
    { decision: "redirect", nextSteps: [] },
    { workflowId: "other", decision: "continue", nextSteps: [] },
    { handoffId: "old", decision: "continue", nextSteps: [] },
    { turnCount: 9, decision: "continue", nextSteps: [] },
    { iteration: 2, decision: "continue", nextSteps: [] },
    { decision: "unknown", nextSteps: [] }
  ])("stops on invalid or stale check-in fields: %j", async (response) => {
    const run = await setup(() => response);
    try {
      await expect(run.advance(10)).rejects.toThrow("Agent A check-in");
      expect(run.events.at(-1)).toBe("workflow.check_in_failed");
    } finally { run.bridge.dispose(); }
  });

  it("stops on an explicit blocker", async () => {
    const run = await setup(() => ({ decision: "blocked", nextSteps: [], reason: "Operator must choose the data source." }));
    try {
      await expect(run.advance(10)).rejects.toThrow("Operator must choose the data source");
      expect(run.events).toEqual(["workflow.check_in_started", "workflow.check_in_completed"]);
    }
    finally { run.bridge.dispose(); }
  });

  it("attributes planner failures to the check-in without continuing", async () => {
    const run = await setup(() => { throw new Error("Planner unavailable"); });
    try {
      await expect(run.advance(10)).rejects.toBeInstanceOf(ExecutionCheckInError);
      expect(run.events).toEqual(["workflow.check_in_started", "workflow.check_in_failed"]);
    } finally { run.bridge.dispose(); }
  });

  it("bounds and redacts evidence and excludes private thinking", async () => {
    const run = await setup();
    const release = protectSecret("private-fixture-secret");
    try {
      for (let i = 0; i < 10; i++) {
        const event = toolTurn("RAW_ASSISTANT_PROSE" + "x".repeat(20_000));
        if (event.message.role === "assistant") event.message.content.push({ type: "thinking", thinking: "PRIVATE_THOUGHT" });
        if (event.message.role === "assistant") for (let j = 0; j < 10; j++) event.message.content.push({
          type: "toolCall", id: `read-${j}`, name: "read", arguments: { path: `private-fixture-secret/${"x".repeat(200)}` }
        });
        event.toolResults.push({ role: "toolResult", toolCallId: "read", toolName: "read",
          content: [{ type: "text", text: "RAW_TOOL_OUTPUT private-fixture-secret" }], isError: false, timestamp: Date.now() });
        await run.supervisor(event, run.signal);
      }
      const prompt = run.session.prompts[0];
      expect(prompt?.length).toBeLessThan(15_000);
      expect(prompt).toContain("[truncated]");
      expect(prompt).toContain("[REDACTED]");
      expect(prompt).not.toContain("private-fixture-secret");
      expect(prompt).not.toContain("PRIVATE_THOUGHT");
      expect(prompt).not.toContain("RAW_ASSISTANT_PROSE");
      expect(prompt).not.toContain("RAW_TOOL_OUTPUT");
    } finally { release(); run.bridge.dispose(); }
  });

  it("does not count provider failures or start a check after cancellation", async () => {
    const run = await setup();
    try {
      const failed = toolTurn();
      if (failed.message.role === "assistant") failed.message.stopReason = "error";
      for (let i = 0; i < 10; i++) await run.supervisor(failed, run.signal);
      expect(run.session.prompts).toHaveLength(0);
      expect(run.progress.at(-1)?.completedTurns).toBe(0);
      const controller = new AbortController();
      controller.abort();
      await expect(run.supervisor(toolTurn(), controller.signal)).rejects.toThrow();
      expect(run.session.prompts).toHaveLength(0);
    } finally { run.bridge.dispose(); }
  });
});
