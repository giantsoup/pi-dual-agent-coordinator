import { describe, expect, it } from "vitest";

import {
  deriveActivityUpdate,
  renderActivityText,
  sanitizeToolArgs,
  summarizeToolActivity
} from "../../src/app/activity-summary.js";
import type { CoordinatorStatusSnapshot } from "../../src/types/status.js";
import type { NormalizedTelemetryEvent } from "../../src/types/telemetry.js";

describe("activity summary", () => {
  it("renders read activity with a relative path target", () => {
    const summary = summarizeToolActivity(
      "read",
      { path: "/tmp/project/src/app/repl-progress.ts" },
      "/tmp/project"
    );

    expect(summary.label).toBe("reading");
    expect(summary.target).toBe("src/app/repl-progress.ts");
  });

  it("renders grep activity with sanitized pattern and path", () => {
    const summary = summarizeToolActivity(
      "grep",
      {
        pattern: "super long pattern that should be truncated after forty characters total",
        path: "/tmp/project/src"
      },
      "/tmp/project"
    );

    expect(renderActivityText({
      role: "A",
      phase: "planning",
      kind: "tool",
      label: summary.label,
      target: summary.target,
      startedAt: "2026-04-19T00:00:00.000Z"
    })).toBe('grepping "super long pattern that should be tru..." in src');
  });

  it("redacts bash secret-like values", () => {
    const sanitized = sanitizeToolArgs(
      "bash",
      {
        command:
          "OPENAI_API_KEY=sk-test curl -H 'Authorization: Bearer abc123' --token secret --api-key xyz npm test"
      }
    );

    expect(sanitized.command).toContain("OPENAI_API_KEY=[REDACTED]");
    expect(sanitized.command).toContain("Authorization: Bearer");
    expect(sanitized.command).not.toContain("abc123");
    expect(sanitized.command).toContain("[REDACTED]");
    expect(sanitized.command).not.toContain("secret");
    expect(sanitized.command).not.toContain("xyz");
  });

  it("never exposes write content bodies or edit replacement text", () => {
    const writeArgs = sanitizeToolArgs("write", {
      path: "/tmp/project/src/index.ts",
      content: "secret file body"
    }, "/tmp/project");
    const editArgs = sanitizeToolArgs("edit", {
      path: "/tmp/project/src/index.ts",
      edits: [{ oldText: "before", newText: "after" }]
    }, "/tmp/project");

    expect(writeArgs).toEqual({ path: "src/index.ts" });
    expect(editArgs).toEqual({ path: "src/index.ts", edits: 1 });
  });

  it("keeps per-role summaries stable when tool events interleave", () => {
    const status = createStatus();
    const activity = new Map<"A" | "B", string>();
    const targets = new Map<"A" | "B", string>();

    for (const event of [
      createEvent("pi.tool_execution_start", "A", {
        toolName: "read",
        toolArgs: { path: "/tmp/project/src/a.ts" }
      }),
      createEvent("pi.tool_execution_start", "B", {
        toolName: "grep",
        toolArgs: { pattern: "needle", path: "/tmp/project/src" }
      }),
      createEvent("pi.tool_execution_end", "A", { toolName: "read" })
    ]) {
      const update = deriveActivityUpdate(event, {
        ...status,
        runtimes: status.runtimes.map((runtime) => ({
          ...runtime,
          currentActivity: activity.get(runtime.role),
          currentTarget: targets.get(runtime.role)
        }))
      });
      if (update?.snapshot && update.role !== "coordinator") {
        activity.set(update.role, renderActivityText(update.snapshot));
        if (update.snapshot.target) {
          targets.set(update.role, update.snapshot.target);
        }
      }
    }

    expect(activity.get("A")).toBe("finished reading src/a.ts");
    expect(activity.get("B")).toBe('grepping "needle" in src');
  });

  it("renders direct MCP tools with an explicit MCP label", () => {
    const update = deriveActivityUpdate(
      createEvent("pi.tool_execution_start", "A", {
        toolName: "search-docs",
        toolArgs: { queries: ["routing"] }
      }),
      {
        ...createStatus(),
        mcp: {
          enabled: true,
          configSources: [],
          roleA: {
            role: "A",
            enabled: true,
            servers: [
              {
                name: "laravel-boost",
                connected: true,
                transport: "stdio",
                directTools: ["search-docs"]
              }
            ]
          },
          roleB: {
            role: "B",
            enabled: true,
            servers: []
          }
        }
      }
    );

    expect(renderActivityText(update?.snapshot!)).toBe(
      "MCP tool running: laravel-boost/search-docs"
    );
  });

  it("renders proxy MCP tool activity with action details", () => {
    const update = deriveActivityUpdate(
      createEvent("pi.tool_execution_start", "B", {
        toolName: "mcp",
        toolArgs: {
          action: "call_tool",
          tool: "laravel-boost/search-docs"
        }
      }),
      {
        ...createStatus(),
        activeRole: "B",
        activeRoleLabel: "Agent B",
        mcp: {
          enabled: true,
          configSources: [],
          roleA: {
            role: "A",
            enabled: true,
            servers: []
          },
          roleB: {
            role: "B",
            enabled: true,
            servers: []
          }
        }
      }
    );

    expect(renderActivityText(update?.snapshot!)).toBe(
      "MCP tool running: mcp call_tool laravel-boost/search-docs"
    );
  });
});

function createStatus(): CoordinatorStatusSnapshot {
  return {
    cwd: "/tmp/project",
    conversationMode: "planning",
    phase: "execution",
    phaseLabel: "Execution",
    activeRole: "B",
    activeRoleLabel: "Agent B",
    activeModelName: "Qwen3",
    activeModelProvider: "local",
    activeModelId: "qwen3",
    activeModelCanonical: "local/qwen3",
    activeModelDisplay: "Qwen3 (local/qwen3)",
    sessionRoot: "/tmp/sessions",
    currentIteration: 1,
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
        modelDisplay: "Qwen3 (local/qwen3)",
        thinking: "medium"
      }
    ],
    metrics: {}
  };
}

function createEvent(
  eventType: string,
  role: "A" | "B",
  details: Record<string, unknown>
): NormalizedTelemetryEvent {
  return {
    eventType,
    role,
    sessionId: `${role}-session-1`,
    timestamp: "2026-04-19T00:00:00.000Z",
    details
  };
}
