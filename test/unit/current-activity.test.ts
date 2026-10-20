import { describe, expect, it } from "vitest";
import { CurrentActivityReducer } from "../../src/app/interactive/current-activity.js";
import { HistoryIndex } from "../../src/app/interactive/history.js";
import { createInitialInteractiveUiState } from "../../src/app/interactive/store.js";
import type { CoordinatorStatusSnapshot } from "../../src/types/status.js";
import type { NormalizedTelemetryEvent } from "../../src/types/telemetry.js";

function setup() {
  let now = 0;
  const status: CoordinatorStatusSnapshot = { cwd: "/fixture", conversationMode: "planning", phase: "planning", phaseLabel: "Planning", activeRole: "A", activeRoleLabel: "Agent A", activeModelDisplay: "fixture", sessionRoot: "memory", repairCount: 0, maxReviewRounds: 3, metrics: {}, runtimes: ["A", "B"].map((role) => ({ role: role === "A" ? "A" : "B", sessionId: role, cwd: "/fixture", modelDisplay: `${role}-model`, thinking: "high", healthy: true })) };
  const state = createInitialInteractiveUiState(status);
  state.operation = { kind: "running" };
  const history = new HistoryIndex();
  const reducer = new CurrentActivityReducer(() => now);
  const events: NormalizedTelemetryEvent[] = [];
  const emit = (eventType: string, details: Record<string, unknown> = {}, overrides: Partial<NormalizedTelemetryEvent> = {}) => {
    const event: NormalizedTelemetryEvent = { role: status.activeRole, sessionId: status.activeRole, operatorTurnId: "turn", runId: status.activeRole, requestId: "request", timestamp: "2026-10-19T12:00:00Z", eventType, details, ...overrides };
    events.push(event);
    history.observe(event); state.history = history.snapshot();
    return reducer.update(state, event);
  };
  emit("ui.turn_started", { objective: "Activity" }); emit("runtime.run_started");
  return { state, status, reducer, emit, events, advance: (time: number) => { now += time; } };
}

describe("current activity ownership", () => {
  it("retains B's failure after a completed A check-in, including read-only replay", () => {
    const { emit, status, reducer, state, events } = setup();
    status.activeRole = "B";
    emit("runtime.run_started", { provenance: "coordinator_handoff" });
    status.activeRole = "A";
    emit("runtime.run_started", { provenance: "coordinator_check_in" }, { runId: "check" });
    emit("runtime.run_finished", { outcome: "completed" }, { runId: "check" });
    status.activeRole = "B";
    emit("pi.message_update", { assistantEventType: "toolcall_delta" });
    emit("runtime.run_finished", { outcome: "failed", reason: "LM Studio response stalled: no upstream data for 120 seconds." });
    state.operation = { kind: "failed" };
    // The coordinator returns to planning after settlement. Failure ownership must survive.
    status.activeRole = "A";
    emit("ui.turn_finished", { outcome: "failed" });
    const expected = { owner: { kind: "runtime", role: "B", runId: "B" }, phase: "Execution",
      action: { kind: "terminal", outcome: "failed", failure: { role: "B", reason: "LM Studio response stalled: no upstream data for 120 seconds." } } };
    expect(reducer.update(state)).toMatchObject(expected);
    const restored = new HistoryIndex();
    restored.restore({ events, warnings: [] });
    state.history = restored.snapshot();
    state.operation = { kind: "idle" };
    expect(new CurrentActivityReducer().update(state)).toMatchObject(expected);
    state.operation = { kind: "cancelled" };
    expect(reducer.update(state).action).toEqual({ kind: "terminal", outcome: "cancelled" });
  });
  it("distinguishes observed actions and retains action time across deltas and render ticks", () => {
    const { emit, advance, reducer, state } = setup();
    expect(reducer.update(state).action).toEqual({ kind: "waiting", reason: "provider" });
    advance(100);
    expect(emit("pi.message_update", { assistantEventType: "thinking_start" }).startedAt).toBe(100);
    advance(500);
    const thinking = emit("pi.message_update", { assistantEventType: "thinking_delta", delta: "PRIVATE_REASONING" });
    expect(thinking).toMatchObject({ action: { kind: "thinking" }, startedAt: 100, lastEventAt: 600 });
    expect(JSON.stringify(thinking)).not.toContain("PRIVATE_REASONING");
    advance(1000);
    expect(reducer.update(state)).toEqual(thinking);
    expect(emit("pi.message_update", { assistantEventType: "text_start" }).action.kind).toBe("writing");
    expect(emit("pi.message_update", { assistantEventType: "text_end" }).action.kind).toBe("waiting");
    expect(emit("pi.message_update", { assistantEventType: "toolcall_start" }).action.kind).toBe("tool_preparation");
  });

  it("gives native calls precedence, matches results, and rejects duplicate or stale calls", () => {
    const { emit, advance } = setup();
    emit("pi.tool_execution_start", { toolName: "bash", toolCallId: "one", toolArgs: { command: "npm test --token private-token" } });
    advance(100);
    expect(emit("pi.tool_execution_start", { toolName: "read", toolCallId: "two", toolArgs: { path: "result.ts" } })).toMatchObject({ action: { kind: "tool_execution", callId: "one", additionalCalls: 1 }, startedAt: 0 });
    expect(emit("pi.message_update", { assistantEventType: "text_delta" }).action.kind).toBe("tool_execution");
    expect(emit("pi.tool_execution_end", { toolName: "bash", toolCallId: "other" }).action.kind).toBe("tool_execution");
    const second = emit("pi.tool_execution_end", { toolName: "bash", toolCallId: "one" });
    expect(second).toMatchObject({ action: { kind: "tool_execution", callId: "two", additionalCalls: 0 }, startedAt: 100 });
    expect(emit("pi.tool_execution_start", { toolName: "bash", toolCallId: "one" })).toEqual(second);
    expect(emit("pi.tool_execution_end", { toolName: "read", toolCallId: "two" }).action.kind).toBe("waiting");
  });

  it("rejects mismatched requests, sessions and runs and restores B after a check-in", () => {
    const { emit, status, reducer, state } = setup();
    status.activeRole = "B"; status.phase = "execution";
    emit("runtime.run_started", { provenance: "coordinator_handoff" });
    emit("pi.message_update", { assistantEventType: "thinking_start" });
    status.activeRole = "A"; status.phase = "review";
    emit("runtime.run_started", { provenance: "coordinator_check_in" }, { runId: "check" });
    expect(emit("pi.message_update", { assistantEventType: "text_delta" }, { runId: "check" }).owner).toMatchObject({ role: "A", runId: "check" });
    emit("runtime.run_finished", { outcome: "completed" }, { runId: "check" });
    status.activeRole = "B"; status.phase = "execution";
    const resumed = emit("pi.message_update", { assistantEventType: "text_delta" });
    expect(resumed).toMatchObject({ owner: { role: "B", runId: "B" }, action: { kind: "writing" } });
    for (const overrides of [{ operatorTurnId: "old" }, { requestId: "old" }, { sessionId: "old" }, { runId: "old" }, { role: "A" as const, sessionId: "A", runId: "check" }]) {
      expect(emit("pi.message_update", { assistantEventType: "thinking_delta" }, overrides)).toEqual(resumed);
    }
    expect(reducer.update(state).owner).toMatchObject({ role: "B" });
  });

  it("keeps cleanup and terminal outcomes above late events; restored work never runs", () => {
    const { state, reducer, emit, advance } = setup();
    state.operation = { kind: "cancelling" }; advance(100);
    const cleanup = emit("pi.message_update", { assistantEventType: "thinking_delta" });
    expect(cleanup.action.kind).toBe("cancelling");
    advance(500);
    expect(reducer.update(state).startedAt).toBe(cleanup.startedAt);
    state.operation = { kind: "cancelled" };
    expect(emit("pi.tool_execution_start", { toolName: "bash", toolCallId: "late" }).action).toEqual({ kind: "terminal", outcome: "cancelled" });
    state.operation = { kind: "idle" };
    state.history.records = state.history.records.map((record) => ({ ...record, outcome: { kind: "interrupted", endedAt: null } }));
    expect(reducer.update(state).action).toEqual({ kind: "terminal", outcome: "interrupted" });
  });
});

it("drops old bindings and older run starts without borrowing activity from another request", () => {
  const { emit, status, reducer, state, advance } = setup();
  emit("runtime.run_started", {}, { runId: "new-run" });
  const current = emit("pi.message_update", { assistantEventType: "text_delta" }, { runId: "new-run" });
  advance(100);
  expect(emit("runtime.run_started")).toEqual(current);
  const runtime = status.runtimes.find((item) => item.role === "A");
  if (!runtime) throw new Error("Missing fixture binding");
  runtime.sessionId = "replacement";
  expect(reducer.update(state).action.kind).toBe("preparing");
  expect(emit("pi.message_update", { assistantEventType: "thinking_delta" }).owner.kind).toBe("coordinator");
  state.history.currentTurnId = "another-request";
  expect(reducer.update(state).action.kind).toBe("preparing");
  expect(reducer.update(state).recent).toEqual([]);
});

it("shows model management, cleanup and error states above stale model activity", () => {
  const { state, emit, reducer } = setup();
  emit("pi.message_update", { assistantEventType: "thinking_delta" });
  state.modal = { kind: "model_loading", role: "B", operation: "switch", progress: { phase: "checking", message: "Checking the selected local model" }, startedAt: 0, cancelling: false, createdAt: "2026-10-19T12:00:00Z", title: "Preparing", content: "Checking", format: "text" };
  expect(reducer.update(state)).toMatchObject({ owner: { kind: "coordinator" }, action: { kind: "model_loading", role: "B", label: "Checking the selected local model" } });
  state.modal = { ...state.modal, cancelling: true };
  expect(reducer.update(state).action.kind).toBe("cancelling");
  state.modal = { kind: "model_error", title: "Model failed", content: "Unavailable", format: "text", createdAt: "2026-10-19T12:00:00Z" };
  expect(reducer.update(state).action).toEqual({ kind: "terminal", outcome: "failed" });
});

it("bounds safe recent outcomes to the current request and keeps failed calls", () => {
  const { emit, reducer, state } = setup();
  const running = emit("pi.tool_execution_start", { toolName: "bash", toolCallId: "secret", toolArgs: { command: "npm test --token private-token\u001b]52;c;unsafe\u0007" } });
  expect(JSON.stringify(running)).not.toMatch(/private-token|unsafe|52;c/);
  for (let index = 0; index < 5; index++) {
    emit("pi.tool_execution_start", { toolName: "read", toolCallId: String(index), toolArgs: { path: `file-${index}` } });
    emit("pi.tool_execution_end", { toolName: "read", toolCallId: String(index), isError: index === 4 });
  }
  const recent = reducer.update(state).recent;
  expect(recent).toHaveLength(3);
  expect(recent[0]?.text).toContain("file-4 / failed");
  expect(new Set(recent.map((item) => item.id)).size).toBe(3);
});

describe("visible compaction", () => {
  it("shows A summarizing B without changing the workflow role and rejects stale/duplicate events", () => {
    const { emit, status, advance, reducer, state } = setup();
    status.activeRole = "B";
    emit("runtime.run_started", { provenance: "coordinator_handoff" });
    const running = emit("compaction.started", { jobId: "compact-1" });
    expect(running.action).toEqual({ kind: "compaction", jobId: "compact-1", role: "B", outcome: "running" });
    expect(status.activeRole).toBe("B");
    advance(1000);
    expect(reducer.update(state).startedAt).toBe(running.startedAt);
    expect(emit("compaction.failed", { jobId: "old" }, { sessionId: "old" }).action).toEqual(running.action);
    expect(emit("compaction.completed", { jobId: "compact-1" }).action).toMatchObject({ outcome: "completed" });
    expect(emit("compaction.started", { jobId: "compact-1" }).action).toMatchObject({ outcome: "completed" });
    expect(emit("pi.message_update", { assistantEventType: "text_delta" }).action.kind).toBe("writing");
    expect(state.history.milestones?.some((milestone) => milestone.label === "Agent B history compacted by A")).toBe(true);
  });
  it("gives cancellation precedence and retains compaction failure after settlement", () => {
    const { emit, state, reducer } = setup();
    emit("compaction.started", { jobId: "compact-A" });
    state.operation = { kind: "cancelling" };
    expect(reducer.update(state).action.kind).toBe("cancelling");
    state.operation = { kind: "running" };
    emit("compaction.failed", { jobId: "compact-A" });
    state.operation = { kind: "failed" };
    expect(reducer.update(state).action).toMatchObject({ kind: "compaction", outcome: "failed" });
  });
});
