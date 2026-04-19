import { describe, expect, it } from "vitest";

import {
  buildHelpText,
  buildPromptLabel,
  buildStartupBanner,
  ReplProgressRenderer
} from "../../src/app/repl-progress.js";
import type { CoordinatorStatusSnapshot } from "../../src/types/status.js";
import type { NormalizedTelemetryEvent } from "../../src/types/telemetry.js";

describe("repl progress renderer", () => {
  it("renders the startup banner and prompt with model displays", () => {
    const status = createStatus();

    expect(buildStartupBanner(status, false)).toContain("Project: /tmp/project");
    expect(buildStartupBanner(status, false)).toContain("Agent A model: GPT-5.4 (openai/gpt-5.4)");
    expect(buildStartupBanner(status, false)).toContain("waits for /approve");
    expect(buildStartupBanner(status, false)).toContain("Modes switch automatically");
    expect(buildPromptLabel(status)).toBe(
      "pi-dual [Planning · GPT-5.4 (openai/gpt-5.4)]> "
    );
    expect(buildHelpText(false)).toContain("/help /status /approve /discard /sessions /handoff /new A|B /switch A|B /quit");
  });

  it("prints one thinking line for repeated deltas and emits tool/workflow progress", () => {
    const stderrWrites: string[] = [];
    const stdoutWrites: string[] = [];
    let status = createStatus();
    const renderer = new ReplProgressRenderer({
      stdout: {
        write: (chunk: string) => {
          stdoutWrites.push(chunk);
          return true;
        }
      },
      stderr: {
        write: (chunk: string) => {
          stderrWrites.push(chunk);
          return true;
        }
      },
      isTTY: false,
      getStatus: () => status
    });

    renderer.handleEvent(createEvent("pi.message_update", "A", { assistantEventType: "text_delta" }));
    renderer.handleEvent(createEvent("pi.message_update", "A", { assistantEventType: "thinking_delta" }));
    renderer.handleEvent(createEvent("planning.plan_ready", "A"));
    renderer.handleEvent(
      createEvent("pi.tool_execution_start", "A", {
        toolName: "read",
        toolArgs: { path: "/tmp/project/src/app/repl-progress.ts" }
      })
    );
    renderer.handleEvent(createEvent("pi.tool_execution_end", "A", { toolName: "read" }));
    renderer.handleEvent(createEvent("pi.turn_end", "A"));

    status = {
      ...status,
      phase: "execution",
      phaseLabel: "Execution",
      activeRole: "B",
      activeRoleLabel: "Agent B",
      activeModelName: "Qwen3 Coder Next",
      activeModelProvider: "local-qwen",
      activeModelId: "qwen3-coder-next",
      activeModelCanonical: "local-qwen/qwen3-coder-next",
      activeModelDisplay: "Qwen3 Coder Next (local-qwen/qwen3-coder-next)",
      currentIteration: 1,
      runtimes: [
        status.runtimes[0]!,
        {
          ...status.runtimes[1]!,
          currentActivity: "reading src/app/repl-progress.ts",
          currentTarget: "src/app/repl-progress.ts"
        }
      ]
    };
    renderer.handleEvent(
      createEvent("workflow.iteration_prepared", "A", {
        iteration: 1,
        modelDisplayB: "Qwen3 Coder Next (local-qwen/qwen3-coder-next)"
      })
    );
    renderer.handleEvent(
      createEvent("workflow.repair_requested", "B", {
        iteration: 1,
        reason: "missing pi-completion block",
        modelDisplayB: "Qwen3 Coder Next (local-qwen/qwen3-coder-next)"
      })
    );
    renderer.handleEvent(
      createEvent("workflow.finalized", "A", {
        decision: "approved",
        modelDisplayA: "GPT-5.4 (openai/gpt-5.4)"
      })
    );
    renderer.beforeTextOutput();

    const progress = stderrWrites.join("");
    expect(
      progress.match(
        /reason: inspecting the codebase before deciding whether execution is necessary/g
      )
    ).toHaveLength(1);
    expect(progress).toContain(
      "Planning · Agent A · GPT-5.4 (openai/gpt-5.4) prepared a plan for approval"
    );
    expect(progress).toContain(
      "Planning · Agent A · GPT-5.4 (openai/gpt-5.4) reason: the plan is ready for operator approval before starting Agent B"
    );
    expect(progress).toContain(
      "Planning · Agent A · GPT-5.4 (openai/gpt-5.4) reading src/app/repl-progress.ts"
    );
    expect(progress).toContain(
      "Planning · Agent A · GPT-5.4 (openai/gpt-5.4) finished reading src/app/repl-progress.ts"
    );
    expect(progress).toContain(
      "Planning · Agent A · GPT-5.4 (openai/gpt-5.4) reason: reading the relevant files before proposing a concrete change"
    );
    expect(progress).toContain(
      "Execution · Agent A · GPT-5.4 (openai/gpt-5.4) prepared iteration 1 for Agent B"
    );
    expect(progress).toContain(
      "Repair · Agent B · Qwen3 Coder Next (local-qwen/qwen3-coder-next) requesting repair from Agent B"
    );
    expect(progress).toContain(
      "Repair · Agent B · Qwen3 Coder Next (local-qwen/qwen3-coder-next) reason: requesting a repair because the expected machine block was missing or invalid"
    );
    expect(progress).toContain("Execution · Agent A · GPT-5.4 (openai/gpt-5.4) approved the workflow");
    expect(stdoutWrites.join("")).toBe("\n");
  });
});

function createStatus(): CoordinatorStatusSnapshot {
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
        thinking: "high"
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
    metrics: {}
  };
}

function createEvent(
  eventType: string,
  role: "A" | "B",
  details: Record<string, unknown> = {}
): NormalizedTelemetryEvent {
  return {
    eventType,
    role,
    sessionId: `${role}-session-1`,
    timestamp: "2026-04-19T00:00:00.000Z",
    details
  };
}
