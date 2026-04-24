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

  it("groups same-context progress under one header and compacts reason lines", () => {
    const { renderer, stderrWrites } = createRenderer();

    renderer.handleEvent(createEvent("pi.message_update", "A", { assistantEventType: "text_delta" }));
    renderer.handleEvent(createEvent("pi.message_update", "A", { assistantEventType: "thinking_delta" }));
    renderer.handleEvent(
      createEvent("pi.tool_execution_start", "A", {
        toolName: "read",
        toolArgs: { path: "/tmp/project/src/app/repl-progress.ts" }
      })
    );
    renderer.handleEvent(createEvent("pi.tool_execution_end", "A", { toolName: "read" }));
    const progress = stderrWrites.join("");

    expect(
      progress.match(/Planning · Agent A · GPT-5.4 \(openai\/gpt-5.4\)/g)
    ).toHaveLength(1);
    expect(
      progress.match(
        /  reason: inspecting the codebase before deciding whether execution is necessary/g
      )
    ).toHaveLength(1);
    expect(progress).toContain("  reading src/app/repl-progress.ts");
    expect(progress).toContain("  finished reading src/app/repl-progress.ts");
    expect(progress).toContain(
      "  reason: reading the relevant files before proposing a concrete change"
    );
  });

  it("renders MCP tool progress with an explicit MCP prefix", () => {
    const statusRef = {
      current: {
        ...createStatus(),
        mcp: {
          enabled: true,
          configSources: [],
          roleA: {
            role: "A" as const,
            enabled: true,
            servers: [
              {
                name: "laravel-boost",
                connected: true,
                transport: "stdio" as const,
                directTools: ["search-docs"]
              }
            ]
          },
          roleB: {
            role: "B" as const,
            enabled: true,
            servers: []
          }
        }
      }
    };
    const { renderer, stderrWrites } = createRenderer(statusRef);

    renderer.handleEvent(
      createEvent("pi.tool_execution_start", "A", {
        toolName: "search-docs",
        toolArgs: { queries: ["routing"] }
      })
    );
    renderer.handleEvent(
      createEvent("pi.tool_execution_end", "A", {
        toolName: "search-docs"
      })
    );

    const progress = stderrWrites.join("");
    expect(progress).toContain("  MCP tool running: laravel-boost/search-docs");
    expect(progress).toContain("  finished MCP tool: laravel-boost/search-docs");
  });

  it("emits a fresh header when phase, role, or model display changes", () => {
    const statusRef = { current: createStatus() };
    const { renderer, stderrWrites } = createRenderer(statusRef);

    renderer.handleEvent(createEvent("planning.plan_ready", "A"));

    statusRef.current = {
      ...statusRef.current,
      phase: "execution",
      phaseLabel: "Execution",
      currentIteration: 1
    };
    renderer.handleEvent(
      createEvent("workflow.iteration_prepared", "A", {
        iteration: 1,
        modelDisplayA: "GPT-5.4 (openai/gpt-5.4)"
      })
    );

    statusRef.current = {
      ...statusRef.current,
      phase: "repair",
      phaseLabel: "Repair",
      activeRole: "B",
      activeRoleLabel: "Agent B",
      activeModelName: "Qwen3 Coder Next",
      activeModelProvider: "local-qwen",
      activeModelId: "qwen3-coder-next",
      activeModelCanonical: "local-qwen/qwen3-coder-next",
      activeModelDisplay: "Qwen3 Coder Next (local-qwen/qwen3-coder-next)"
    };
    renderer.handleEvent(
      createEvent("workflow.repair_requested", "B", {
        iteration: 1,
        reason: "missing pi-completion block",
        modelDisplayB: "Qwen3 Coder Next (local-qwen/qwen3-coder-next)"
      })
    );

    statusRef.current = {
      ...statusRef.current,
      phase: "execution",
      phaseLabel: "Execution",
      activeRole: "B",
      activeRoleLabel: "Agent B",
      activeModelName: "Qwen3 Coder Next v2",
      activeModelProvider: "local-qwen",
      activeModelId: "qwen3-coder-next-v2",
      activeModelCanonical: "local-qwen/qwen3-coder-next-v2",
      activeModelDisplay: "Qwen3 Coder Next v2 (local-qwen/qwen3-coder-next-v2)",
      runtimes: [
        statusRef.current.runtimes[0]!,
        {
          ...statusRef.current.runtimes[1]!,
          modelName: "Qwen3 Coder Next v2",
          modelId: "qwen3-coder-next-v2",
          modelCanonical: "local-qwen/qwen3-coder-next-v2",
          modelDisplay: "Qwen3 Coder Next v2 (local-qwen/qwen3-coder-next-v2)"
        }
      ]
    };
    renderer.handleEvent(
      createEvent("pi.message_update", "B", {
        assistantEventType: "thinking_delta",
        modelDisplay: "Qwen3 Coder Next v2 (local-qwen/qwen3-coder-next-v2)"
      })
    );

    expect(stderrWrites).toEqual([
      "Planning · Agent A · GPT-5.4 (openai/gpt-5.4)\n",
      "  prepared a plan for approval\n",
      "  reason: the plan is ready for operator approval before starting Agent B\n",
      "Execution · Agent A · GPT-5.4 (openai/gpt-5.4)\n",
      "  prepared iteration 1 for Agent B\n",
      "  reason: sending the next handoff to Agent B\n",
      "Repair · Agent B · Qwen3 Coder Next (local-qwen/qwen3-coder-next)\n",
      "  requesting repair from Agent B\n",
      "  reason: requesting a repair because the expected machine block was missing or invalid\n",
      "Execution · Agent B · Qwen3 Coder Next v2 (local-qwen/qwen3-coder-next-v2)\n",
      "  gathering local context\n",
      "  reason: gathering local context before making changes\n"
    ]);
  });

  it("resets the current burst after text output and clear boundaries", () => {
    const statusRef = { current: createStatus() };
    const { renderer, stderrWrites, stdoutWrites } = createRenderer(statusRef);

    renderer.handleEvent(createEvent("pi.message_update", "A", { assistantEventType: "thinking_delta" }));
    renderer.beforeTextOutput();
    renderer.handleEvent(createEvent("pi.message_update", "A", { assistantEventType: "thinking_delta" }));
    renderer.handleEvent(createEvent("pi.turn_end", "A"));
    renderer.handleEvent(createEvent("pi.message_update", "A", { assistantEventType: "thinking_delta" }));
    renderer.beforeTextOutput();
    renderer.handleEvent(createEvent("planning.plan_ready", "A"));
    renderer.handleEvent(createEvent("pi.turn_end", "A"));
    renderer.handleEvent(createEvent("planning.plan_ready", "A"));

    const progress = stderrWrites.join("");
    expect(
      progress.match(/Planning · Agent A · GPT-5.4 \(openai\/gpt-5.4\)/g)
    ).toHaveLength(5);
    expect(
      progress.match(/  prepared a plan for approval/g)
    ).toHaveLength(2);
    expect(stdoutWrites.join("")).toBe("\n\n");
  });
});

function createRenderer(
  statusRef: { current: CoordinatorStatusSnapshot } = { current: createStatus() }
): {
  renderer: ReplProgressRenderer;
  stderrWrites: string[];
  stdoutWrites: string[];
  statusRef: { current: CoordinatorStatusSnapshot };
} {
  const stderrWrites: string[] = [];
  const stdoutWrites: string[] = [];
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
    getStatus: () => statusRef.current
  });

  return { renderer, stderrWrites, stdoutWrites, statusRef };
}

function createStatus(): CoordinatorStatusSnapshot {
  return {
    threadId: "thread-1",
    threadTitle: "Thread 1",
    threadStartedAt: "2026-04-20T00:00:00.000Z",
    threadUpdatedAt: "2026-04-20T00:00:00.000Z",
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
