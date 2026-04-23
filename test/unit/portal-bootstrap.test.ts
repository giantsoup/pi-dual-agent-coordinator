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

  it("prints guided startup instructions for the web interface", async () => {
    const writes: string[] = [];

    class StoppableService extends DisposableService {
      public override subscribeState(listener: (state: InteractiveUiState) => void): () => void {
        queueMicrotask(() => {
          listener({
            ...createState(),
            shouldExit: true
          });
        });
        return () => {};
      }
    }

    const service = new StoppableService();

    await bootstrapPortal(
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
        openBrowser: async () => ({
          status: "failed"
        }),
        startServer: async () => ({
          authToken: "secret-token",
          healthCheckUrl: "http://127.0.0.1:4317/healthz",
          host: "127.0.0.1",
          launchUrl: "http://127.0.0.1:4317/?token=secret-token",
          localOnly: true,
          port: 4317,
          startupMessage: "",
          startupNotice: {
            scope: "startup",
            title: "PI Dual web interface is ready",
            message:
              "Open this link in any browser on this computer: http://127.0.0.1:4317/?token=secret-token"
          },
          stop: async () => {}
        }),
        stdout: {
          write(chunk: string) {
            writes.push(chunk);
            return true;
          }
        }
      }
    );

    const output = writes.join("");
    expect(output).toContain("PI Dual web interface is ready.");
    expect(output).toContain(
      "Open this link in any browser on this computer: http://127.0.0.1:4317/?token=secret-token"
    );
    expect(output).toContain(
      "If the link does not open automatically, copy and paste it into Chrome, Safari, Firefox, or another local browser."
    );
    expect(output).toContain(
      "This interface is only available on this machine because the server listens on localhost."
    );
    expect(output).toContain("Project loaded: /tmp/project");
    expect(output).toContain("Health check URL: http://127.0.0.1:4317/healthz");
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
