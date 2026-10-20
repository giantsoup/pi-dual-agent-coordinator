import { describe, expect, it, vi } from "vitest";
import { HistoryIndex } from "../../src/app/interactive/history.js";
import { RequestTranscript } from "../../src/app/interactive/transcript.js";
import { toolGroupSummary } from "../../src/app/tui/workspace.js";
import { readableAssistantOutput } from "../../src/app/interactive/history-detail.js";
import type { ArchiveEntry } from "../../src/runtime/session-history.js";
import type { NormalizedTelemetryEvent } from "../../src/types/telemetry.js";

const timestamp = "2026-10-19T12:00:00Z";
function setup(read = vi.fn(async (): Promise<ArchiveEntry[]> => [])) {
  const history = new HistoryIndex();
  const transcript = new RequestTranscript(read, (runId) => history.getMessageSequences(runId));
  const emit = (eventType: string, runId: string, details: Record<string, unknown> = {}, role: "A" | "B" = "B", turnId = "turn") => {
    const event: NormalizedTelemetryEvent = { eventType, role, sessionId: role, runId, operatorTurnId: turnId, timestamp, details };
    history.observe(event); transcript.observeTool(event, history.eventSequence);
  };
  const output = (runId: string, messageId: string, text: string, committed = false) => {
    const run = history.get(runId);
    if (!run || run.kind !== "run") throw new Error("Missing run");
    const owner = { runId, messageId, role: run.role, sessionId: run.sessionId, timestamp };
    transcript.observeOutput(committed ? { ...owner, type: "assistant_turn_committed", text } : { ...owner, type: "assistant_text_delta", delta: text }, run, history.eventSequence + .1);
  };
  const blocks = () => transcript.blocks(history.snapshot().records, "turn");
  emit("ui.turn_started", "b", { objective: "Narrative" }); emit("runtime.run_started", "b", { provenance: "coordinator_handoff" });
  return { history, transcript, emit, output, blocks, read };
}

describe("request transcript projection", () => {
  it.each(["pi-execute", "pi-handoff"])("shows the validated %s summary when A supplies no surrounding prose", (kind) => {
    const data = { schemaVersion: 1, workflowId: "workflow", handoffId: "handoff", iteration: 1, objective: "Fix arithmetic", summary: "Explain the arithmetic change",
      executionPlan: ["Update arithmetic.js"], relevantPaths: ["arithmetic.js"], acceptanceCriteria: ["Arithmetic tests pass"] };
    const visible = readableAssistantOutput(`\`\`\`${kind}\n${JSON.stringify(data)}\n\`\`\``);
    expect(visible).toContain("Explain the arithmetic change"); expect(visible).toContain("Arithmetic tests pass");
    expect(visible).not.toMatch(/schemaVersion|workflowId|pi-execute|pi-handoff/);
  });
  it("rolls up tool-only turns, splits on model prose and role boundaries, and counts replayed executions once", () => {
    const { emit, output, blocks, history } = setup();
    output("b", "b1", "I will inspect the files.");
    for (let i = 1; i <= 3; i++) {
      const details = { toolName: "read", toolCallId: `call-${i}`, messageId: `b${i}` };
      emit("pi.tool_execution_start", "b", details); emit("pi.tool_execution_start", "b", details);
      emit("pi.tool_execution_end", "b", { ...details, isError: i === 2 });
      output("b", `b${i}`, i === 1 ? "I will inspect the files." : "", true);
    }
    emit("runtime.run_started", "a", { provenance: "execution_check_in" }, "A");
    output("a", "a1", "The work remains on scope."); output("a", "a1", "The work remains on scope.", true);
    emit("runtime.run_finished", "a", { outcome: "completed" }, "A");
    output("b", "b4", "I am continuing with the fix.");
    emit("pi.tool_execution_start", "b", { toolName: "edit", toolCallId: "edit", messageId: "b4" });
    expect(blocks().map((block) => block.kind === "response" ? block.text : block.kind === "tools" ? `${block.callIds.length} calls` : block.label)).toEqual([
      "I will inspect the files.", "3 calls", "The work remains on scope.", "I am continuing with the fix.", "1 calls"
    ]);
    const calls = history.snapshot().records.filter((record) => record.kind === "tool");
    expect(toolGroupSummary(calls)).toContain("4 tool calls · 1 failed · 1 running");
  });

  it("hydrates safe full responses without thinking or machine blocks, preserves archive order, and shares reads", async () => {
    const text = Array.from({ length: 120 }, (_, i) => `paragraph ${i}`).join("\n");
    const read = vi.fn(async (): Promise<ArchiveEntry[]> => [{ type: "message", id: "archived", parentId: null, timestamp, message: { role: "assistant", content: [
      { type: "thinking", text: "PRIVATE_THINKING" }, { type: "text", text: text + "\n```pi-plan\ninvalid protocol\n```\n\x1b]52;c;unsafe\x07SAFE_END" }
    ] } }]);
    const { emit, transcript, history, blocks } = setup(read);
    emit("pi.message_end", "b", { messageRole: "assistant", messageId: "b1" });
    emit("runtime.run_finished", "b", { outcome: "completed" });
    await Promise.all([transcript.hydrate(history.snapshot().records, "turn"), transcript.hydrate(history.snapshot().records, "turn")]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(blocks()).toHaveLength(1);
    expect(blocks()[0]).toMatchObject({ kind: "response", text: text + "\n\nSAFE_END" });
    expect(JSON.stringify(blocks())).not.toMatch(/thinking|PRIVATE_THINKING|invalid protocol|52;c|unsafe/);
  });

  it("ignores archive reads completed after request navigation or disposal", async () => {
    let release = (_entries: ArchiveEntry[]) => {};
    const read = vi.fn(() => new Promise<ArchiveEntry[]>((resolve) => { release = resolve; }));
    const { emit, transcript, history, blocks } = setup(read);
    emit("runtime.run_finished", "b", { outcome: "completed" });
    const pending = transcript.hydrate(history.snapshot().records, "turn");
    await transcript.hydrate(history.snapshot().records, "other");
    release([{ type: "message", id: "late", timestamp, message: { role: "assistant", content: [{ type: "text", text: "stale output" }] } }]);
    await pending;
    expect(blocks()).toEqual([]);
    transcript.reset(); expect(blocks()).toEqual([]);
  });

  it("keeps safe streamed output when an archive is unavailable", async () => {
    const { emit, output, transcript, history, blocks } = setup(vi.fn(async () => { throw new Error("missing archive"); }));
    output("b", "b1", "Already visible partial response.");
    emit("runtime.run_finished", "b", { outcome: "cancelled" });
    await transcript.hydrate(history.snapshot().records, "turn");
    expect(blocks()).toMatchObject([{ kind: "response", text: "Already visible partial response." }]);
  });

  it("preserves an interrupted response that never reached the archive", async () => {
    const { emit, output, transcript, history, blocks } = setup();
    output("b", "b1", "The provider was interrupted here.");
    emit("runtime.run_finished", "b", { outcome: "cancelled" });
    await transcript.hydrate(history.snapshot().records, "turn");
    expect(blocks()).toMatchObject([{ kind: "response", text: "The provider was interrupted here." }]);
  });
});

it("keeps request milestones deduplicated and separate from settled run outcomes in live and replay history", () => {
  const events: NormalizedTelemetryEvent[] = [];
  const index = new HistoryIndex();
  const emit = (eventType: string, details: Record<string, unknown> = {}, runId?: string) => {
    const event: NormalizedTelemetryEvent = { eventType, details, operatorTurnId: "turn", requestId: "request", role: "A", sessionId: "A", timestamp, runId };
    events.push(event); index.observe(event);
  };
  emit("ui.turn_started", { objective: "Review" });
  emit("planning.plan_ready"); emit("planning.plan_ready");
  emit("planning.plan_approved");
  emit("runtime.run_started", { provenance: "coordinator_review", workflowId: "workflow" }, "review");
  emit("runtime.run_finished", { outcome: "completed" }, "review");
  expect(index.get("review")).not.toHaveProperty("reviewDisposition");
  emit("workflow.finalized", { decision: "maybe", workflowId: "workflow" });
  expect(index.get("review")).not.toHaveProperty("reviewDisposition");
  emit("workflow.iteration_prepared", { iteration: 2, workflowId: "workflow", handoffId: "revision" });
  expect(index.get("review")).toMatchObject({ outcome: { kind: "completed" }, reviewDisposition: "revision_requested" });
  const milestones = index.snapshot().milestones ?? [];
  expect(milestones.map((item) => item.label)).toEqual(["Plan ready / waiting for operator approval", "Operator approved the plan / execution authorized", "A requested a revision / next handoff prepared"]);
  expect(milestones.every((item) => item.turnId === "turn" && !("runId" in item))).toBe(true);
  const restored = new HistoryIndex(); restored.restore({ events, warnings: [] });
  expect(restored.snapshot().milestones).toEqual(milestones);
  expect(restored.get("review")).toEqual(index.get("review"));
  expect(restored.get("turn")?.outcome).toEqual({ kind: "interrupted", endedAt: null });
});

it("restores a pending approval as interrupted history without resurrecting an approval", () => {
  const index = new HistoryIndex();
  const base = { role: "A" as const, sessionId: "A", timestamp, operatorTurnId: "turn" };
  index.restore({ events: [{ ...base, eventType: "ui.turn_started", details: {} }, { ...base, eventType: "ui.turn_finished", details: { outcome: "waiting_approval" } }], warnings: [] });
  expect(index.get("turn")?.outcome).toEqual({ kind: "interrupted", endedAt: null });
});

it("rejects mismatched native ownership before changing narrative or unread revisions", () => {
  const { emit, history } = setup();
  const before = history.snapshot();
  for (const mismatch of [{ role: "A" as const }, { sessionId: "old" }, { requestId: "old" }, { operatorTurnId: "old" }, { runId: "old" }]) {
    history.observe({ eventType: "pi.tool_execution_start", role: "B", sessionId: "B", runId: "b", operatorTurnId: "turn", timestamp, details: { toolName: "read", toolCallId: "stale" }, ...mismatch });
    expect(history.snapshot()).toEqual(before);
  }
  emit("runtime.run_finished", "b", { outcome: "completed" });
  const ended = history.snapshot();
  emit("pi.tool_execution_start", "b", { toolName: "read", toolCallId: "late" });
  expect(history.snapshot()).toEqual(ended);
});

it("does not apply a duplicate earlier revision milestone to a later review run", () => {
  const index = new HistoryIndex();
  const base = { role: "A" as const, sessionId: "A", timestamp, operatorTurnId: "turn", requestId: "request" };
  index.observe({ ...base, eventType: "ui.turn_started", details: {} });
  index.observe({ ...base, runId: "first", eventType: "runtime.run_started", details: { provenance: "coordinator_review", workflowId: "workflow" } });
  index.observe({ ...base, runId: "first", eventType: "runtime.run_finished", details: { outcome: "completed" } });
  const revision = { ...base, eventType: "workflow.iteration_prepared", details: { iteration: 2, workflowId: "workflow", handoffId: "handoff" } };
  index.observe(revision);
  index.observe({ ...base, runId: "later", eventType: "runtime.run_started", details: { provenance: "coordinator_review", workflowId: "workflow" } });
  const before = index.snapshot();
  index.observe(revision);
  expect(index.snapshot()).toEqual(before);
  expect(index.get("first")).toHaveProperty("reviewDisposition", "revision_requested");
  expect(index.get("later")).not.toHaveProperty("reviewDisposition");
});
