import { describe, expect, it, vi } from "vitest";

import { HeadlessInteractiveCoordinatorService } from "../../src/app/interactive/service.js";
import type { RuntimeUiBridgeEvent } from "../../src/coordinator/bind-runtime-events.js";
import type { CoordinatorStatusSnapshot } from "../../src/types/status.js";
import type { NormalizedTelemetryEvent } from "../../src/types/telemetry.js";
import type { CoordinatorTurnResult, PendingExecutionPlanSnapshot } from "../../src/types/workflow.js";

class FakeCoordinator {
  private readonly telemetryListeners = new Set<(event: NormalizedTelemetryEvent) => void>();
  private readonly runtimeUiListeners = new Set<(event: RuntimeUiBridgeEvent) => void>();
  private status = createStatusSnapshot();
  public startError: Error | undefined;
  public disposeCalls = 0;

  public async start(): Promise<void> {
    if (this.startError) {
      throw this.startError;
    }
  }

  public async submitUserInput(text: string): Promise<CoordinatorTurnResult> {
    if (text === "plan it") {
      const pendingPlan = createPendingPlan();
      this.status = {
        ...this.status,
        pendingPlan,
        pendingPlanReady: true,
        nextActionHint: "Run /approve to start coordinated execution with Agent B."
      };
      return {
        mode: "planning",
        userResponse: "Here is the implementation plan.",
        pendingPlan,
        nextActionHint: "Run /approve to start coordinated execution with Agent B."
      };
    }

    this.status = {
      ...this.status,
      pendingPlan: undefined,
      pendingPlanReady: false,
      nextActionHint: undefined
    };
    return {
      mode: "planning",
      userResponse: `submitted:${text}`
    };
  }

  public async approvePendingPlan(): Promise<CoordinatorTurnResult> {
    this.status = {
      ...this.status,
      pendingPlan: undefined,
      pendingPlanReady: false,
      nextActionHint: undefined
    };
    return {
      mode: "planning",
      userResponse: "approved:pending-plan"
    };
  }

  public discardPendingPlan(): void {
    this.status = {
      ...this.status,
      pendingPlan: undefined,
      pendingPlanReady: false,
      nextActionHint: undefined
    };
  }

  public getStatus(): CoordinatorStatusSnapshot {
    return this.status;
  }

  public getSessions(): unknown {
    return this.status.runtimes;
  }

  public async getLastHandoff(): Promise<unknown> {
    return { state: { workflows: {}, records: [] } };
  }

  public subscribeEvents(listener: (event: NormalizedTelemetryEvent) => void): () => void {
    this.telemetryListeners.add(listener);
    return () => {
      this.telemetryListeners.delete(listener);
    };
  }

  public subscribeRuntimeUiEvents(listener: (event: RuntimeUiBridgeEvent) => void): () => void {
    this.runtimeUiListeners.add(listener);
    return () => {
      this.runtimeUiListeners.delete(listener);
    };
  }

  public async replaceRuntime(): Promise<void> {}

  public async dispose(): Promise<void> {
    this.disposeCalls += 1;
  }

  public emitTelemetryEvent(event: NormalizedTelemetryEvent): void {
    for (const listener of this.telemetryListeners) {
      listener(event);
    }
  }

  public emitRuntimeUiEvent(event: RuntimeUiBridgeEvent): void {
    for (const listener of this.runtimeUiListeners) {
      listener(event);
    }
  }
}

describe("interactive coordinator service", () => {
  it("loads check-in details for readable output and explicit metadata inspection", async () => {
    const checkIn = { schemaVersion: 1, workflowId: "workflow", handoffId: "handoff", iteration: 1,
      turnCount: 10, decision: "redirect", reason: "Finish verification before more edits.", nextSteps: ["Run the focused tests."] };
    const text = "```pi-check-in\n" + JSON.stringify(checkIn) + "\n```";
    const timestamp = "2026-10-17T00:00:00.000Z";
    const coordinator = Object.assign(new FakeCoordinator(), { getRunArchive: vi.fn(async () => [{
      type: "message", id: "message", parentId: null, timestamp,
      message: { role: "assistant", content: [{ type: "text", text }] }
    }]) });
    const service = new HeadlessInteractiveCoordinatorService(coordinator);
    await service.start();
    try {
      for (const eventType of ["ui.turn_started", "runtime.run_started"]) coordinator.emitTelemetryEvent({
        eventType, timestamp, role: "A", sessionId: "session", operatorTurnId: "turn", runId: "check-in",
        details: { provenance: "coordinator_check_in" }
      });
      expect((await service.loadHistoryDetail("check-in", "output")).lines.join("\n")).toContain("Progress check after turn 10: Adjusting course");
      const metadata = await service.loadHistoryDetail("check-in", "metadata");
      expect(JSON.parse(metadata.lines.join("\n")).checkIn).toEqual(checkIn);
      expect(coordinator.getRunArchive).toHaveBeenCalledTimes(2);
    } finally { await service.dispose(); }
  });

  it("notifies terminal subscribers about streaming before the prompt completes", async () => {
    const coordinator = new FakeCoordinator();
    const service = new HeadlessInteractiveCoordinatorService(coordinator);
    let finishTurn = () => {};
    const pendingTurn = new Promise<void>((resolve) => {
      finishTurn = resolve;
    });
    vi.spyOn(coordinator, "submitUserInput").mockImplementation(async (text) => {
      await pendingTurn;
      return { mode: "planning", userResponse: text };
    });
    await service.start();
    const streamedText: string[] = [];
    service.subscribeState((state) => {
      if (state.liveStream) {
        streamedText.push(state.liveStream.text);
      }
    });

    const dispatch = service.dispatch({ type: "submit_input", input: "plan it" });
    try {
      coordinator.emitRuntimeUiEvent({
        type: "assistant_text_delta",
        role: "A",
        sessionId: "A-session-1",
        timestamp: "2026-10-16T00:00:00.000Z",
        delta: "Still working"
      });
      expect(streamedText).toContain("Still working");
    } finally {
      finishTurn();
      await dispatch;
      await service.dispose();
    }
  });

  it("accepts once, blocks concurrent work, and keeps read-only controls available", async () => {
    const coordinator = new FakeCoordinator();
    const service = new HeadlessInteractiveCoordinatorService(coordinator);
    let finish = () => {};
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const submit = vi.spyOn(coordinator, "submitUserInput").mockImplementation(async () => {
      await gate;
      return { mode: "planning", userResponse: "done" };
    });
    await service.start();
    const accepted = vi.fn();
    const rejected = vi.fn();
    const running = service.dispatch({ type: "submit_input", input: "first" }, accepted);
    expect(accepted).toHaveBeenCalledOnce();
    expect(service.getState().operation.kind).toBe("running");
    await service.dispatch({ type: "submit_input", input: "draft" }, rejected);
    await service.dispatch({ type: "submit_input", input: "/new A" }, rejected);
    await service.dispatch({ type: "submit_input", input: "/new" }, rejected);
    expect(rejected).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledOnce();
    expect(service.getState().notification?.code).toBe("operation.busy");
    await service.dispatch({ type: "submit_input", input: "/status" });
    expect(service.getState().modal.kind).toBe("status");
    finish(); await running;
    expect(service.getState().operation.kind).toBe("completed");
    await service.dispose();
  });

  it("retains authoritative completed prose once, even without deltas", async () => {
    const coordinator = new FakeCoordinator();
    const service = new HeadlessInteractiveCoordinatorService(coordinator);
    await service.start();
    vi.spyOn(coordinator, "submitUserInput").mockImplementation(async () => {
      const event: RuntimeUiBridgeEvent = { type: "assistant_turn_committed", role: "A",
        sessionId: "A-session-1", timestamp: "now", messageId: "request:turn",
        text: "Completed prose\n```pi-plan\n{}\n```" };
      coordinator.emitRuntimeUiEvent({type:"assistant_text_delta",role:"A",sessionId:"A-session-1",timestamp:"before",delta:"Wrong partial text"});
      coordinator.emitRuntimeUiEvent(event);
      coordinator.emitRuntimeUiEvent(event);
      coordinator.emitRuntimeUiEvent({ ...event, role: "B", sessionId: "B-session-1", messageId: "execution", text: "Execution detail" });
      return { mode: "planning", userResponse: "Completed prose" };
    });
    await service.dispatch({ type: "submit_input", input: "task" });
    expect(service.getState().conversation.map((entry) => entry.text)).toEqual(["task", "Completed prose", "Execution detail"]);
    await service.dispose();
  });

  it("builds operator and assistant transcript entries from shared dispatch", async () => {
    const coordinator = new FakeCoordinator();
    const service = new HeadlessInteractiveCoordinatorService(coordinator);
    await service.start();

    await service.dispatch({
      type: "submit_input",
      input: "ship it"
    });

    expect(service.getState().conversation).toMatchObject([
      { kind: "operator_message", text: "ship it" },
      { kind: "assistant_planning_response", text: "submitted:ship it" }
    ]);

    await service.dispose();
  });

  it("does not announce approval or execution when no plan exists", async () => {
    const coordinator = new FakeCoordinator();
    const service = new HeadlessInteractiveCoordinatorService(coordinator);
    await service.start();
    const approve = vi.spyOn(coordinator, "approvePendingPlan");
    await service.dispatch({type:"submit_input",input:"/approve"});
    expect(approve).not.toHaveBeenCalled();
    expect(service.getState().conversation.some((entry) => entry.kind === "approval_discard")).toBe(false);
    expect(service.getState().lastError?.message).toContain("No pending plan");
    await service.dispose();
  });

  it("assembles plan-ready transcript state without reading telemetry logs", async () => {
    const coordinator = new FakeCoordinator();
    const service = new HeadlessInteractiveCoordinatorService(coordinator);
    await service.start();

    await service.dispatch({
      type: "submit_input",
      input: "plan it"
    });

    expect(service.getState().pendingPlan?.plan.summary).toBe("Ready for approval");
    expect(service.getState().conversation.map((entry) => entry.kind)).toEqual([
      "operator_message",
      "assistant_planning_response",
      "plan_ready"
    ]);

    await service.dispose();
  });

  it("tracks streaming deltas and clears the live buffer on commit", async () => {
    const coordinator = new FakeCoordinator();
    const service = new HeadlessInteractiveCoordinatorService(coordinator);
    const events: string[] = [];
    await service.start();
    service.subscribeUiEvents((event) => {
      events.push(event.type);
    });

    coordinator.emitRuntimeUiEvent({
      type: "assistant_text_delta",
      role: "A",
      sessionId: "A-session-1",
      timestamp: "2026-04-20T00:00:00.000Z",
      delta: "Hello"
    });
    expect(service.getState().liveStream?.text).toBe("Hello");

    coordinator.emitRuntimeUiEvent({
      type: "assistant_turn_committed",
      role: "A",
      sessionId: "A-session-1",
      timestamp: "2026-04-20T00:00:01.000Z",
      text: "Hello"
    });
    expect(service.getState().liveStream).toBeUndefined();
    expect(events).toContain("stream_delta_appended");
    expect(events).toContain("stream_committed");

    await service.dispose();
  });

  it("ignores stale events after a role session has been replaced", async () => {
    const coordinator = new FakeCoordinator();
    const service = new HeadlessInteractiveCoordinatorService(coordinator);
    await service.start();
    const next = createStatusSnapshot();
    next.runtimes = next.runtimes.map((runtime) => runtime.role === "A" ? {...runtime,sessionId:"A-new"} : runtime);
    vi.spyOn(coordinator,"getStatus").mockReturnValue(next);
    coordinator.emitRuntimeUiEvent({type:"assistant_text_delta",role:"A",sessionId:"A-session-1",timestamp:"old",delta:"stale"});
    expect(service.getState().liveStream).toBeUndefined();
    coordinator.emitRuntimeUiEvent({type:"assistant_text_delta",role:"A",sessionId:"A-new",timestamp:"new",delta:"current"});
    expect(service.getState().liveStream?.text).toBe("current");
    await service.dispose();
  });

  it("leaves the service restartable after a startup failure", async () => {
    const coordinator = new FakeCoordinator();
    const service = new HeadlessInteractiveCoordinatorService(coordinator);
    coordinator.startError = new Error("startup failed");

    await expect(service.start()).rejects.toThrow("startup failed");

    coordinator.startError = undefined;
    await expect(service.start()).resolves.toBeUndefined();
    await service.dispose();
  });

  it("rejects dispatch after disposal without mutating state", async () => {
    const coordinator = new FakeCoordinator();
    const service = new HeadlessInteractiveCoordinatorService(coordinator);
    await service.start();
    await service.dispose();

    const previousState = service.getState();
    await expect(
      service.dispatch({
        type: "submit_input",
        input: "ship it"
      })
    ).rejects.toThrow("already been disposed");
    expect(service.getState()).toBe(previousState);
    expect(coordinator.disposeCalls).toBe(1);
  });

  it("disposes idempotently", async () => {
    const coordinator = new FakeCoordinator();
    const service = new HeadlessInteractiveCoordinatorService(coordinator);
    await service.start();

    await service.dispose();
    await service.dispose();

    expect(coordinator.disposeCalls).toBe(1);
  });

  it("rolls up runtime tool history from telemetry and preserves it after workflow finalization", async () => {
    const coordinator = new FakeCoordinator();
    const service = new HeadlessInteractiveCoordinatorService(coordinator);
    await service.start();

    coordinator.emitTelemetryEvent({
      role: "A",
      sessionId: "A-session-1",
      eventType: "pi.tool_execution_start",
      timestamp: "2026-04-20T00:00:00.000Z",
      details: {
        toolName: "read",
        toolCallId: "tool-read-1"
      }
    });
    coordinator.emitTelemetryEvent({
      role: "A",
      sessionId: "A-session-1",
      eventType: "pi.tool_execution_end",
      timestamp: "2026-04-20T00:00:01.000Z",
      details: {
        toolName: "read",
        toolCallId: "tool-read-1",
        isError: false
      }
    });
    coordinator.emitTelemetryEvent({
      role: "A",
      sessionId: "A-session-1",
      eventType: "workflow.finalized",
      timestamp: "2026-04-20T00:00:02.000Z",
      details: {}
    });

    expect(service.getState().activity.history.A?.totals.reads).toBe(1);
    expect(service.getState().activity.history.A?.recent[0]?.status).toBe("completed");
    expect(service.getState().activity.runtimes).toEqual({});

    await service.dispose();
  });
});

function createPendingPlan(): PendingExecutionPlanSnapshot {
  return {
    objective: "Implement the change",
    summary: "Ready for approval",
    acceptanceCriteria: ["Tests pass"],
    relevantPaths: ["src/index.ts"],
    executionPlan: ["Update the implementation", "Run focused tests"],
    constraints: ["Keep the diff scoped"],
    proposedAt: "2026-04-20T00:00:00.000Z",
    requestId: "req-plan",
    proposedByRole: "A"
  };
}

function createStatusSnapshot(): CoordinatorStatusSnapshot {
  return {
    cwd: "/tmp/project",
    conversationMode: "planning",
    phase: "planning",
    phaseLabel: "Planning",
    activeRole: "A",
    activeRoleLabel: "Agent A",
    activeModelDisplay: "GPT-5.4 (openai/gpt-5.4)",
    sessionRoot: "/tmp/sessions",
    repairCount: 0,
    maxReviewRounds: 3,
    runtimes: [
      {
        role: "A",
        healthy: true,
        sessionId: "A-session-1",
        sessionFile: "/tmp/sessions/A.jsonl",
        cwd: "/tmp/project",
        modelDisplay: "GPT-5.4 (openai/gpt-5.4)",
        thinking: "high"
      },
      {
        role: "B",
        healthy: true,
        sessionId: "B-session-1",
        sessionFile: "/tmp/sessions/B.jsonl",
        cwd: "/tmp/project",
        modelDisplay: "Qwen3 Coder Next (local-qwen/qwen3-coder-next)",
        thinking: "off"
      }
    ],
    metrics: {}
  };
}
