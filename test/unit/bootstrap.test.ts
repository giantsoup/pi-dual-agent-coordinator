import { describe, expect, it } from "vitest";

import {
  bootstrapRepl,
  isReplTerminationError,
  runReplLoop,
  type ReplCoordinatorLike,
  type ReplUiLike,
  type ReplReadlineLike
} from "../../src/app/bootstrap.js";
import type { CoordinatorStatusSnapshot } from "../../src/types/status.js";
import type { NormalizedTelemetryEvent } from "../../src/types/telemetry.js";
import type { InteractiveCoordinatorService } from "../../src/app/interactive/service.js";
import type { InteractiveUiState, UiAction, UiEvent } from "../../src/types/ui.js";
import type { Terminal } from "@mariozechner/pi-tui";

class FakeReadline implements ReplReadlineLike {
  public closeCalls = 0;
  public readonly prompts: string[] = [];
  private index = 0;

  public constructor(private readonly responses: Array<string | Error>) {}

  public async question(prompt: string): Promise<string> {
    this.prompts.push(prompt);
    const response = this.responses[this.index++];
    if (response instanceof Error) {
      throw response;
    }
    return response ?? "/quit";
  }

  public close(): void {
    this.closeCalls += 1;
  }
}

function createCoordinator(): ReplCoordinatorLike & {
  readonly disposeCalls: number;
} {
  let disposeCalls = 0;
  const status = createStatusSnapshot();

  return {
    async start() {},
    async submitUserInput(text: string) {
      if (text === "plan it") {
        return {
          mode: "planning" as const,
          userResponse: "Here is the implementation plan.",
          pendingPlan: {
            objective: "Implement the change",
            summary: "Ready for approval",
            acceptanceCriteria: ["Tests pass"],
            relevantPaths: ["src/index.ts"],
            executionPlan: ["Update the implementation", "Run focused tests"],
            constraints: ["Keep the diff scoped"],
            proposedAt: "2026-04-19T00:00:00.000Z",
            requestId: "req-plan",
            proposedByRole: "A"
          },
          nextActionHint:
            "Run /approve to start coordinated execution with Agent B, send another message to revise the plan, or run /discard to clear it.",
          workflow: undefined
        };
      }
      return {
        mode: "planning" as const,
        userResponse: `submitted:${text}`,
        workflow: undefined
      };
    },
    async approvePendingPlan() {
      return {
        mode: "planning" as const,
        userResponse: "approved:pending-plan",
        workflow: undefined
      };
    },
    discardPendingPlan() {},
    getStatus() {
      return status;
    },
    getSessions() {
      return status.runtimes;
    },
    async getLastHandoff() {
      return { state: { workflows: {}, records: [] } };
    },
    subscribeEvents(_listener: (event: NormalizedTelemetryEvent) => void) {
      return () => {};
    },
    async replaceRuntime() {},
    async dispose() {
      disposeCalls += 1;
    },
    get disposeCalls() {
      return disposeCalls;
    }
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
    activeModelName: "GPT-5.4",
    activeModelProvider: "openai",
    activeModelId: "gpt-5.4",
    activeModelCanonical: "openai/gpt-5.4",
    activeModelDisplay: "GPT-5.4 (openai/gpt-5.4)",
    sessionRoot: "/tmp/sessions",
    pendingPlanReady: false,
    currentActivity: "reading src/app/repl-progress.ts",
    currentReason: "reading the relevant files before proposing a concrete change",
    repairCount: 0,
    maxReviewRounds: 3,
    runtimes: [
      {
        role: "A",
        healthy: true,
        sessionId: "A-session-1",
        sessionFile: "/tmp/sessions/A.jsonl",
        cwd: "/tmp/project",
        modelName: "GPT-5.4",
        modelProvider: "openai",
        modelId: "gpt-5.4",
        modelCanonical: "openai/gpt-5.4",
        modelDisplay: "GPT-5.4 (openai/gpt-5.4)",
        thinking: "high",
        currentActivity: "reading src/app/repl-progress.ts",
        currentReason: "reading the relevant files before proposing a concrete change",
        currentTarget: "src/app/repl-progress.ts",
        lastToolName: "read"
      },
      {
        role: "B",
        healthy: true,
        sessionId: "B-session-1",
        sessionFile: "/tmp/sessions/B.jsonl",
        cwd: "/tmp/project",
        modelName: "Qwen3 Coder Next",
        modelProvider: "local-qwen",
        modelId: "qwen3-coder-next",
        modelCanonical: "local-qwen/qwen3-coder-next",
        modelDisplay: "Qwen3 Coder Next (local-qwen/qwen3-coder-next)",
        thinking: "off"
      }
    ],
    metrics: { "pi.turn_end": 1 }
  };
}

function createUi(writes?: string[]): ReplUiLike {
  return {
    renderHelp() {
      writes?.push(
        "Help\nModes switch automatically\n/approve starts execution from a pending plan\n/new creates a fresh role session\n"
      );
    },
    getPrompt() {
      return "pi-dual [Planning · GPT-5.4 (openai/gpt-5.4)]> ";
    },
    beforeTextOutput() {}
  };
}

function createService(
  state: InteractiveUiState
): InteractiveCoordinatorService & {
  readonly startCalls: number;
  readonly disposeCalls: number;
} {
  const stateListeners = new Set<(state: InteractiveUiState) => void>();
  const uiListeners = new Set<(event: UiEvent) => void>();
  let startCalls = 0;
  let disposeCalls = 0;

  return {
    async start() {
      startCalls += 1;
    },
    async dispose() {
      disposeCalls += 1;
    },
    async dispatch(_action: UiAction) {},
    getState() {
      return state;
    },
    subscribeState(listener: (nextState: InteractiveUiState) => void) {
      stateListeners.add(listener);
      listener(state);
      return () => {
        stateListeners.delete(listener);
      };
    },
    subscribeUiEvents(listener: (event: UiEvent) => void) {
      uiListeners.add(listener);
      return () => {
        uiListeners.delete(listener);
      };
    },
    get startCalls() {
      return startCalls;
    },
    get disposeCalls() {
      return disposeCalls;
    }
  };
}

function createTerminal(): Terminal & { started: boolean } {
  return {
    started: false,
    start() {
      this.started = true;
    },
    stop() {},
    async drainInput() {},
    write(_data: string) {},
    get columns() {
      return 120;
    },
    get rows() {
      return 40;
    },
    get kittyProtocolActive() {
      return false;
    },
    moveBy(_lines: number) {},
    hideCursor() {},
    showCursor() {},
    clearLine() {},
    clearFromCursor() {},
    clearScreen() {},
    setTitle(_title: string) {}
  };
}

describe("bootstrap repl", () => {
  it("prints the startup banner before the first prompt", async () => {
    const rl = new FakeReadline(["/quit"]);
    const coordinator = createCoordinator();
    const writes: string[] = [];

    await expect(
      bootstrapRepl(
        {
          command: "repl",
          cwd: "/tmp/project",
          sessionMode: "memory",
          jsonLogs: false,
          verbose: false,
          maxReviewRounds: 3
        },
        {
          createCoordinator: () => coordinator,
          createReadline: () => rl,
          stdout: {
            write: (chunk: string) => {
              writes.push(chunk);
              return true;
            }
          },
          stderr: { write: (_chunk: string) => true },
          isTTY: false
        }
      )
    ).resolves.toBeUndefined();

    const output = writes.join("");
    expect(output).toContain("Project: /tmp/project");
    expect(output).toContain("Agent A model: GPT-5.4 (openai/gpt-5.4)");
    expect(output).toContain("Agent B model: Qwen3 Coder Next (local-qwen/qwen3-coder-next)");
    expect(output).toContain("Modes switch automatically");
    expect(output).toContain("Commands: /help /status /approve /discard /sessions /handoff /new A|B /switch A|B /quit");
    expect(output).toContain("Keys: Enter submit | Ctrl+C exit");
  });

  it("exits cleanly when the readline interface closes", async () => {
    const closed = Object.assign(new Error("readline was closed"), {
      code: "ERR_USE_AFTER_CLOSE"
    });
    const rl = new FakeReadline(["/status", "ship it", closed]);
    const coordinator = createCoordinator();
    const writes: string[] = [];

    await expect(
      runReplLoop(coordinator, rl, {
        stdout: {
          write: (chunk: string) => {
            writes.push(chunk);
            return true;
          }
        },
        stderr: { write: (_chunk: string) => true }
      }, createUi())
    ).resolves.toBeUndefined();

    expect(writes.join("")).toContain('"phaseLabel": "Planning"');
    expect(writes.join("")).toContain('"currentActivity": "reading src/app/repl-progress.ts"');
    expect(writes.join("")).toContain('"currentReason": "reading the relevant files before proposing a concrete change"');
    expect(writes.join("")).toContain("submitted:ship it");
    expect(rl.prompts[0]).toContain("Planning");
    expect(rl.prompts[0]).toContain("GPT-5.4");
    expect(coordinator.disposeCalls).toBe(1);
    expect(rl.closeCalls).toBe(1);
  });

  it("renders help output", async () => {
    const rl = new FakeReadline(["/help", "/quit"]);
    const coordinator = createCoordinator();
    const writes: string[] = [];

    await expect(
      runReplLoop(
        coordinator,
        rl,
        {
          stdout: {
            write: (chunk: string) => {
              writes.push(chunk);
              return true;
            }
          },
          stderr: { write: (_chunk: string) => true }
        },
        createUi(writes)
      )
    ).resolves.toBeUndefined();

    expect(writes.join("")).toContain("Help");
    expect(writes.join("")).toContain("Modes switch automatically");
    expect(writes.join("")).toContain("/approve");
    expect(writes.join("")).toContain("/new creates a fresh role session");
  });

  it("renders a structured pending plan and supports approve/discard commands", async () => {
    const rl = new FakeReadline(["plan it", "/approve", "/discard", "/quit"]);
    const coordinator = createCoordinator();
    const writes: string[] = [];

    await expect(
      runReplLoop(
        coordinator,
        rl,
        {
          stdout: {
            write: (chunk: string) => {
              writes.push(chunk);
              return true;
            }
          },
          stderr: { write: (_chunk: string) => true }
        },
        createUi()
      )
    ).resolves.toBeUndefined();

    const output = writes.join("");
    expect(output).toContain("Plan Ready · Agent A");
    expect(output).toContain("Summary: Ready for approval");
    expect(output).toContain("Next: Run /approve to start coordinated execution with Agent B");
    expect(output).toContain("approved:pending-plan");
    expect(output).toContain("No pending plan to discard.");
  });

  it("recognizes readline termination errors", () => {
    expect(
      isReplTerminationError(
        Object.assign(new Error("readline was closed"), {
          code: "ERR_USE_AFTER_CLOSE"
        })
      )
    ).toBe(true);
    expect(isReplTerminationError(new Error("boom"))).toBe(false);
  });

  it("selects the TUI path by default on TTY when --plain is not set", async () => {
    const service = createService({
      status: createStatusSnapshot(),
      conversation: [],
      activity: { runtimes: {}, history: {} },
      modal: { kind: "none" },
      commandPalette: { open: false },
      notifications: [],
      shouldExit: true
    });
    const terminal = createTerminal();

    await expect(
      bootstrapRepl(
        {
          command: "repl",
          cwd: "/tmp/project",
          sessionMode: "memory",
          jsonLogs: false,
          verbose: false,
          maxReviewRounds: 3
        },
        {
          createService: () => service,
          createTerminal: () => terminal,
          stdout: { write: (_chunk: string) => true },
          isTTY: true
        }
      )
    ).resolves.toBeUndefined();

    expect(terminal.started).toBe(true);
    expect(service.startCalls).toBe(1);
    expect(service.disposeCalls).toBe(1);
  });
});
