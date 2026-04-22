import { describe, expect, it } from "vitest";

import { bootstrapPortal } from "../../src/app/portal/bootstrap.js";
import type { InteractiveCoordinatorService } from "../../src/app/interactive/service.js";
import type { InteractiveUiState, UiAction, UiEvent } from "../../src/types/ui.js";

class DisposableService implements InteractiveCoordinatorService {
  public startCalls = 0;
  public disposeCalls = 0;
  private readonly state = createState();

  public async start(): Promise<void> {
    this.startCalls += 1;
  }

  public async dispose(): Promise<void> {
    this.disposeCalls += 1;
  }

  public async dispatch(_action: UiAction): Promise<void> {}

  public getState(): InteractiveUiState {
    return this.state;
  }

  public subscribeState(_listener: (state: InteractiveUiState) => void): () => void {
    return () => {};
  }

  public subscribeUiEvents(_listener: (event: UiEvent) => void): () => void {
    return () => {};
  }
}

describe("portal bootstrap", () => {
  it("disposes the service if portal startup fails", async () => {
    const service = new DisposableService();

    await expect(
      bootstrapPortal(
        {
          command: "portal",
          cwd: "/tmp/project",
          port: 0,
          sessionMode: "memory",
          jsonLogs: false,
          verbose: false,
          maxReviewRounds: 3
        },
        {
          createService: () => service,
          startServer: async () => {
            throw new Error("bind failed");
          }
        }
      )
    ).rejects.toThrow("bind failed");

    expect(service.startCalls).toBe(1);
    expect(service.disposeCalls).toBe(1);
  });
});

function createState(): InteractiveUiState {
  return {
    status: {
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
      runtimes: [],
      metrics: {}
    },
    conversation: [],
    activity: {
      runtimes: {},
      history: {}
    },
    modal: { kind: "none" },
    commandPalette: {
      open: false
    },
    notifications: [],
    shouldExit: false
  };
}
