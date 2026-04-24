import { mkdtempSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  HeadlessInteractiveCoordinatorService,
  InteractiveActionError
} from "../../src/app/interactive/service.js";
import { ProjectLauncherService } from "../../src/app/project-launcher-service.js";
import { loadWorkspaceIndex, readThreadView } from "../../src/app/workspace-index.js";
import type { PortalCliOptions } from "../../src/app/cli.js";
import type { UiSettingsProviderCatalog } from "../../src/types/ui.js";
import type { RuntimeUiBridgeEvent } from "../../src/coordinator/bind-runtime-events.js";
import type { CoordinatorStatusSnapshot } from "../../src/types/status.js";
import type { NormalizedTelemetryEvent } from "../../src/types/telemetry.js";
import type { CoordinatorTurnResult, PendingExecutionPlanSnapshot } from "../../src/types/workflow.js";

const ORIGINAL_HOME = process.env.PI_DUAL_COORDINATOR_HOME;

afterEach(() => {
  if (ORIGINAL_HOME === undefined) {
    delete process.env.PI_DUAL_COORDINATOR_HOME;
  } else {
    process.env.PI_DUAL_COORDINATOR_HOME = ORIGINAL_HOME;
  }
});

class FakeCoordinator {
  private readonly telemetryListeners = new Set<(event: NormalizedTelemetryEvent) => void>();
  private readonly runtimeUiListeners = new Set<(event: RuntimeUiBridgeEvent) => void>();
  private status: CoordinatorStatusSnapshot;
  public startError: Error | undefined;
  public startCalls = 0;
  public disposeCalls = 0;

  public constructor(status = createStatusSnapshot()) {
    this.status = status;
  }

  public async start(): Promise<void> {
    this.startCalls += 1;
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

class FakeSettingsProviderService {
  public catalog: UiSettingsProviderCatalog = {
    providers: [],
    catalogByProvider: {}
  };
  public refreshCalls = 0;
  public verifyCalls: Array<{ provider: string; modelId?: string | undefined }> = [];
  public catalogPromise: Promise<UiSettingsProviderCatalog> | undefined;

  public async getCatalog(): Promise<UiSettingsProviderCatalog> {
    this.refreshCalls += 1;
    if (this.catalogPromise) {
      return this.catalogPromise;
    }
    return this.catalog;
  }

  public async connectProviderOauth(): Promise<UiSettingsProviderCatalog> {
    return this.catalog;
  }

  public async saveOpenAiApiKey(): Promise<UiSettingsProviderCatalog> {
    return this.catalog;
  }

  public async saveCustomProvider(): Promise<UiSettingsProviderCatalog> {
    return this.catalog;
  }

  public async verifyTarget(input: {
    provider: string;
    modelId?: string | undefined;
  }): Promise<UiSettingsProviderCatalog> {
    this.verifyCalls.push(input);
    this.catalog = {
      providers: [
        {
          id: input.provider,
          kind: "openai",
          label: "OpenAI API",
          auth: {
            connected: true,
            label: "Authenticated",
            source: "stored-key"
          },
          discovery: {
            available: true,
            reachable: true,
            modelsFound: 1,
            label: "Authenticated"
          },
          verify: {
            status: "passed",
            target: `${input.provider}/${input.modelId ?? "unknown"}`
          },
          sourceModelCount: 1,
          defaultModelId: input.modelId
        }
      ],
      catalogByProvider: {
        [input.provider]: [
          {
            id: input.modelId ?? "unknown",
            provider: input.provider,
            canonicalRef: `${input.provider}/${input.modelId ?? "unknown"}`,
            name: input.modelId ?? "unknown",
            available: true,
            reasoning: true,
            supportsReasoningEffort: true,
            input: ["text"]
          }
        ]
      }
    };
    return this.catalog;
  }

  public async ensureManagedProviderForModelRef(): Promise<void> {}
}

function createService(
  coordinator: FakeCoordinator,
  dependencies: {
    createCoordinator?: ((options: PortalCliOptions) => FakeCoordinator) | undefined;
    portalOptions?: PortalCliOptions | undefined;
  } = {}
) {
  const settingsProviderService = new FakeSettingsProviderService();
  const projectLauncherService = new ProjectLauncherService();
  return {
    service: new HeadlessInteractiveCoordinatorService(coordinator, {
      settingsProviderService: settingsProviderService as never,
      createCoordinator: dependencies.createCoordinator as never,
      portalOptions: dependencies.portalOptions,
      projectLauncherService
    }),
    projectLauncherService,
    settingsProviderService
  };
}

describe("interactive coordinator service", () => {
  it("builds operator and assistant transcript entries from shared dispatch", async () => {
    const coordinator = new FakeCoordinator();
    const { service } = createService(coordinator);
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
    const { service } = createService(coordinator);
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
    const { service } = createService(coordinator);
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
    const { service } = createService(coordinator);
    coordinator.startError = new Error("startup failed");

    await expect(service.start()).rejects.toThrow("startup failed");

    coordinator.startError = undefined;
    await expect(service.start()).resolves.toBeUndefined();
    await service.dispose();
  });

  it("rejects dispatch after disposal without mutating state", async () => {
    const coordinator = new FakeCoordinator();
    const { service } = createService(coordinator);
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
    const { service } = createService(coordinator);
    await service.start();

    await service.dispose();
    await service.dispose();

    expect(coordinator.disposeCalls).toBe(1);
  });

  it("rolls up runtime tool history from telemetry and preserves it after workflow finalization", async () => {
    const coordinator = new FakeCoordinator();
    const { service } = createService(coordinator);
    await service.start();

    coordinator.emitTelemetryEvent({
      role: "A",
      sessionId: "thread-1-A-session-1",
      eventType: "pi.tool_execution_start",
      timestamp: "2026-04-20T00:00:00.000Z",
      details: {
        toolName: "read",
        toolCallId: "tool-read-1"
      }
    });
    coordinator.emitTelemetryEvent({
      role: "A",
      sessionId: "thread-1-A-session-1",
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
      sessionId: "thread-1-A-session-1",
      eventType: "workflow.finalized",
      timestamp: "2026-04-20T00:00:02.000Z",
      details: {}
    });

    expect(service.getState().activity.history.A?.totals.reads).toBe(1);
    expect(service.getState().activity.history.A?.recent[0]?.status).toBe("completed");
    expect(service.getState().activity.runtimes).toEqual({});

    await service.dispose();
  });

  it("handles provider verification actions through the settings service", async () => {
    const coordinator = new FakeCoordinator();
    const { service, settingsProviderService } = createService(coordinator);
    await service.start();

    await service.dispatch({
      type: "verify_provider_target",
      provider: "openai",
      modelId: "gpt-5.4"
    });

    expect(settingsProviderService.verifyCalls).toEqual([
      {
        provider: "openai",
        modelId: "gpt-5.4"
      }
    ]);
    await waitFor(() => {
      const verify = service.getState().settings.providers[0]?.verify;
      return verify?.status === "passed";
    });
    expect(service.getState().settings.providers[0]?.verify).toMatchObject({
      status: "passed",
      target: "openai/gpt-5.4"
    });

    await service.dispose();
  });

  it("opens settings immediately while provider discovery continues in the background", async () => {
    const coordinator = new FakeCoordinator();
    const { service, settingsProviderService } = createService(coordinator);
    let releaseCatalog: ((value: UiSettingsProviderCatalog) => void) | undefined;
    await service.start();

    settingsProviderService.catalogPromise = new Promise((resolve) => {
      releaseCatalog = resolve;
    });

    await service.dispatch({
      type: "open_settings",
      scope: "project"
    });

    expect(service.getState().activeView).toBe("settings");
    expect(service.getState().settings.activeScope).toBe("project");
    expect(service.getState().settings.providerOperation).toMatchObject({
      kind: "refresh",
      provider: "settings",
      status: "running"
    });

    releaseCatalog?.({
      providers: [],
      catalogByProvider: {}
    });
    await waitFor(() => service.getState().settings.providerOperation === undefined);

    expect(service.getState().settings.providerOperation).toBeUndefined();

    await service.dispose();
  });

  it("handles launch_project_thread by persisting the old live thread and selecting the new live thread", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-interactive-launch-"));
    process.env.PI_DUAL_COORDINATOR_HOME = root;
    const projectA = join(root, "project-a");
    const projectB = join(root, "project-b");
    mkdirSync(projectA, { recursive: true });
    mkdirSync(projectB, { recursive: true });

    const firstCoordinator = new FakeCoordinator(
      createStatusSnapshot({
        cwd: projectA,
        threadId: "thread-a",
        threadTitle: "Thread A"
      })
    );
    const secondCoordinator = new FakeCoordinator(
      createStatusSnapshot({
        cwd: projectB,
        threadId: "thread-b",
        threadTitle: "Thread B"
      })
    );
    const createdOptions: Array<{ cwd: string }> = [];
    const { service } = createService(firstCoordinator, {
      createCoordinator(options) {
        createdOptions.push({
          cwd: options.cwd
        });
        return secondCoordinator;
      },
      portalOptions: {
        command: "portal",
        cwd: projectA,
        sessionMode: "persistent",
        jsonLogs: false,
        verbose: false,
        modelA: "cli/model-a",
        maxReviewRounds: 3,
        port: 4317
      }
    });
    await service.start();

    await service.dispatch({
      type: "launch_project_thread",
      projectPath: projectB
    });

    expect(createdOptions).toEqual([{ cwd: realpathSync(projectB) }]);
    expect(firstCoordinator.disposeCalls).toBe(1);
    expect(secondCoordinator.startCalls).toBe(1);
    expect(service.getState().status.threadId).toBe("thread-b");
    expect(service.getState().status.cwd).toBe(projectB);
    expect(service.getState().workspace.activeThreadId).toBe("thread-b");
    expect(service.getState().workspace.selectedThreadId).toBe("thread-b");
    expect(service.getState().workspace.recentProjects[0]?.path).toBe(realpathSync(projectB));

    const oldThread = await readThreadView("thread-a");
    const newThread = await readThreadView("thread-b");
    expect(oldThread?.status.cwd).toBe(projectA);
    expect(newThread?.status.cwd).toBe(projectB);

    const workspace = await loadWorkspaceIndex({
      activeThreadId: "thread-b",
      selectedThreadId: "thread-b"
    });
    expect(workspace.workspace.threads.map((thread) => thread.threadId).sort()).toEqual([
      "thread-a",
      "thread-b"
    ]);
    expect(workspace.workspace.threads.find((thread) => thread.threadId === "thread-a")?.isActive).toBe(false);

    await service.dispose();
  });

  it("blocks project switching when a plan is pending", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-interactive-pending-"));
    process.env.PI_DUAL_COORDINATOR_HOME = root;
    const projectA = join(root, "project-a");
    const projectB = join(root, "project-b");
    mkdirSync(projectA, { recursive: true });
    mkdirSync(projectB, { recursive: true });

    const coordinator = new FakeCoordinator(
      createStatusSnapshot({
        cwd: projectA,
        pendingPlan: createPendingPlan(),
        pendingPlanReady: true
      })
    );
    const { service } = createService(coordinator, {
      createCoordinator() {
        return new FakeCoordinator();
      },
      portalOptions: {
        command: "portal",
        cwd: projectA,
        sessionMode: "persistent",
        jsonLogs: false,
        verbose: false,
        maxReviewRounds: 3,
        port: 4317
      }
    });
    await service.start();

    await expect(
      service.dispatch({
        type: "launch_project_thread",
        projectPath: projectB
      })
    ).rejects.toThrow(InteractiveActionError);
    expect(service.getState().lastError?.message).toContain("pending plan");

    await service.dispose();
  });

  it("blocks project switching when a workflow is active", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-interactive-workflow-"));
    process.env.PI_DUAL_COORDINATOR_HOME = root;
    const projectA = join(root, "project-a");
    const projectB = join(root, "project-b");
    mkdirSync(projectA, { recursive: true });
    mkdirSync(projectB, { recursive: true });

    const coordinator = new FakeCoordinator(
      createStatusSnapshot({
        cwd: projectA,
        activeWorkflowId: "wf-1"
      })
    );
    const { service } = createService(coordinator, {
      createCoordinator() {
        return new FakeCoordinator();
      },
      portalOptions: {
        command: "portal",
        cwd: projectA,
        sessionMode: "persistent",
        jsonLogs: false,
        verbose: false,
        maxReviewRounds: 3,
        port: 4317
      }
    });
    await service.start();

    await expect(
      service.dispatch({
        type: "launch_project_thread",
        projectPath: projectB
      })
    ).rejects.toThrow(InteractiveActionError);
    expect(service.getState().lastError?.message).toContain("active workflow");

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

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }
    await flushMicrotasks();
  }
  throw new Error("Timed out waiting for condition.");
}

function createStatusSnapshot(
  overrides: Partial<CoordinatorStatusSnapshot> = {}
): CoordinatorStatusSnapshot {
  const cwd = overrides.cwd ?? "/tmp/project";
  const threadId = overrides.threadId ?? "thread-1";
  return {
    threadId,
    threadTitle: overrides.threadTitle ?? "Thread 1",
    threadStartedAt: overrides.threadStartedAt ?? "2026-04-20T00:00:00.000Z",
    threadUpdatedAt: overrides.threadUpdatedAt ?? "2026-04-20T00:00:00.000Z",
    cwd,
    conversationMode: overrides.conversationMode ?? "planning",
    phase: overrides.phase ?? "planning",
    phaseLabel: overrides.phaseLabel ?? "Planning",
    activeRole: overrides.activeRole ?? "A",
    activeRoleLabel: overrides.activeRoleLabel ?? "Agent A",
    activeModelDisplay: overrides.activeModelDisplay ?? "GPT-5.4 (openai/gpt-5.4)",
    sessionRoot: overrides.sessionRoot ?? "/tmp/sessions",
    pendingPlan: overrides.pendingPlan,
    pendingPlanReady: overrides.pendingPlanReady ?? false,
    nextActionHint: overrides.nextActionHint,
    activeWorkflowId: overrides.activeWorkflowId,
    repairCount: overrides.repairCount ?? 0,
    maxReviewRounds: overrides.maxReviewRounds ?? 3,
    runtimes: overrides.runtimes ?? [
      {
        role: "A",
        healthy: true,
        sessionId: `${threadId}-A-session-1`,
        sessionFile: "/tmp/sessions/A.jsonl",
        cwd,
        modelDisplay: "GPT-5.4 (openai/gpt-5.4)",
        thinking: "high"
      },
      {
        role: "B",
        healthy: true,
        sessionId: `${threadId}-B-session-1`,
        sessionFile: "/tmp/sessions/B.jsonl",
        cwd,
        modelDisplay: "Qwen3 Coder Next (local-qwen/qwen3-coder-next)",
        thinking: "off"
      }
    ],
    metrics: overrides.metrics ?? {}
  };
}
