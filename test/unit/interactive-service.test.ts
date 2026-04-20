import { describe, expect, it } from "vitest";

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

  public emitRuntimeUiEvent(event: RuntimeUiBridgeEvent): void {
    for (const listener of this.runtimeUiListeners) {
      listener(event);
    }
  }
}

describe("interactive coordinator service", () => {
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
