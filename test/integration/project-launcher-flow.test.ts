import { mkdtempSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { startInteractivePortalServer } from "../../src/app/portal/server.js";
import { HeadlessInteractiveCoordinatorService } from "../../src/app/interactive/service.js";
import { readThreadView } from "../../src/app/workspace-index.js";
import type { RuntimeUiBridgeEvent } from "../../src/coordinator/bind-runtime-events.js";
import type { CoordinatorStatusSnapshot } from "../../src/types/status.js";
import type { NormalizedTelemetryEvent } from "../../src/types/telemetry.js";
import type { CoordinatorTurnResult } from "../../src/types/workflow.js";

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

  public constructor(private readonly status: CoordinatorStatusSnapshot) {}

  public async start(): Promise<void> {}

  public async submitUserInput(_text: string): Promise<CoordinatorTurnResult> {
    return {
      mode: "planning",
      userResponse: "noop"
    };
  }

  public async approvePendingPlan(): Promise<CoordinatorTurnResult> {
    return {
      mode: "planning",
      userResponse: "approved"
    };
  }

  public discardPendingPlan(): void {}

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

  public async dispose(): Promise<void> {}
}

describe("project launcher integration", () => {
  it("switches the active coordinator to the new cwd and persists both threads", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-project-launch-integration-"));
    process.env.PI_DUAL_COORDINATOR_HOME = root;
    const projectA = join(root, "project-a");
    const projectB = join(root, "project-b");
    mkdirSync(projectA, { recursive: true });
    mkdirSync(projectB, { recursive: true });

    const service = new HeadlessInteractiveCoordinatorService(
      new FakeCoordinator(
        createStatusSnapshot({
          cwd: projectA,
          threadId: "thread-a",
          threadTitle: "Thread A"
        })
      ),
      {
        createCoordinator: (options) =>
          new FakeCoordinator(
            createStatusSnapshot({
              cwd: options.cwd,
              threadId: "thread-b",
              threadTitle: "Thread B"
            })
          ),
        portalOptions: {
          command: "portal",
          cwd: projectA,
          sessionMode: "persistent",
          jsonLogs: false,
          verbose: false,
          maxReviewRounds: 3,
          port: 0
        }
      }
    );
    await service.start();

    const portal = await startInteractivePortalServer({
      service,
      authToken: "secret-token"
    });

    const events = new AbortController();
    await fetch(
      `http://${portal.host}:${portal.port}/api/events?token=secret-token&controllerId=controller-a`,
      {
        signal: events.signal
      }
    );

    const response = await fetch(`http://${portal.host}:${portal.port}/api/actions`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        controllerId: "controller-a",
        action: {
          type: "launch_project_thread",
          projectPath: projectB
        }
      })
    });
    const body = (await response.json()) as {
      accepted: boolean;
      state: {
        status: { cwd: string; threadId: string };
        workspace: { threads: Array<{ threadId: string; isActive: boolean }> };
      };
    };

    expect(response.status).toBe(200);
    expect(body.accepted).toBe(true);
    expect(body.state.status.cwd).toBe(realpathSync(projectB));
    expect(body.state.status.threadId).toBe("thread-b");

    const stateResponse = await fetch(
      `http://${portal.host}:${portal.port}/api/state?token=secret-token`
    );
    const stateBody = (await stateResponse.json()) as {
      state: { status: { cwd: string; threadId: string } };
    };
    expect(stateBody.state.status.cwd).toBe(realpathSync(projectB));

    expect(body.state.workspace.threads.map((thread) => thread.threadId).sort()).toEqual([
      "thread-a",
      "thread-b"
    ]);
    expect(
      body.state.workspace.threads.find((thread) => thread.threadId === "thread-a")?.isActive
    ).toBe(false);
    expect((await readThreadView("thread-a"))?.status.cwd).toBe(projectA);
    expect((await readThreadView("thread-b"))?.status.cwd).toBe(realpathSync(projectB));

    events.abort();
    await portal.stop();
    await service.dispose();
  });
});

function createStatusSnapshot(
  overrides: Partial<CoordinatorStatusSnapshot> = {}
): CoordinatorStatusSnapshot {
  const cwd = overrides.cwd ?? "/tmp/project";
  const threadId = overrides.threadId ?? "thread-1";
  return {
    threadId,
    threadTitle: overrides.threadTitle ?? "Thread 1",
    threadStartedAt: "2026-04-20T00:00:00.000Z",
    threadUpdatedAt: "2026-04-20T00:00:00.000Z",
    cwd,
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
    metrics: {}
  };
}
