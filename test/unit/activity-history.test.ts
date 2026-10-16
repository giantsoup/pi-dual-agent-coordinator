import { describe, expect, it } from "vitest";

import {
  applyActivityHistoryEvent,
  renderRuntimeActivitySummary,
  syncActivityHistoryWithStatus
} from "../../src/app/activity-history.js";
import type { ActivitySnapshot } from "../../src/app/activity-summary.js";
import type { CoordinatorStatusSnapshot } from "../../src/types/status.js";
import type { NormalizedTelemetryEvent } from "../../src/types/telemetry.js";
import type { UiActivityState } from "../../src/types/ui.js";

describe("activity history", () => {
  it("rolls up tool counts and recent items for a runtime", () => {
    const startSnapshot = createSnapshot({
      label: "reading",
      target: "src/app/tui/app.ts"
    });
    const endSnapshot = createSnapshot({
      label: "finished reading",
      target: "src/app/tui/app.ts"
    });

    const afterStart = applyActivityHistoryEvent(
      createActivityState(),
      createToolEvent("pi.tool_execution_start", {
        toolName: "read",
        toolCallId: "tool-read-1"
      }),
      startSnapshot
    );
    const afterEnd = applyActivityHistoryEvent(
      afterStart,
      createToolEvent("pi.tool_execution_end", {
        toolName: "read",
        toolCallId: "tool-read-1",
        isError: false
      }),
      endSnapshot
    );

    expect(afterEnd.history.A?.totals.reads).toBe(1);
    expect(renderRuntimeActivitySummary(afterEnd.history.A)).toEqual(["1 read"]);
    expect(afterEnd.history.A?.recent).toMatchObject([
      {
        toolCallId: "tool-read-1",
        text: "finished reading src/app/tui/app.ts",
        status: "completed"
      }
    ]);
  });

  it("counts MCP calls separately and ignores machine-block pseudo tools", () => {
    const afterMcp = applyActivityHistoryEvent(
      createActivityState(),
      createToolEvent("pi.tool_execution_start", {
        toolName: "mcp",
        toolCallId: "tool-mcp-1"
      }),
      createSnapshot({
        label: "MCP tool running:",
        target: "mcp call_tool filesystem/read_file"
      })
    );
    const afterPseudo = applyActivityHistoryEvent(
      afterMcp,
      createToolEvent("pi.tool_execution_start", {
        toolName: "pi-plan",
        toolCallId: "tool-pseudo-1"
      }),
      createSnapshot({
        label: "running",
        target: "pi-plan"
      })
    );

    expect(afterPseudo.history.A?.totals.mcpCalls).toBe(1);
    expect(afterPseudo.history.A?.totals.otherTools).toBe(0);
    expect(afterPseudo.history.A?.recent).toHaveLength(1);
  });

  it("resets runtime history when the session changes", () => {
    const withHistory = applyActivityHistoryEvent(
      createActivityState(),
      createToolEvent("pi.tool_execution_start", {
        toolName: "grep",
        toolCallId: "tool-grep-1"
      }),
      createSnapshot({
        label: 'grepping "needle" in',
        target: "src"
      })
    );

    const synced = syncActivityHistoryWithStatus(withHistory, {
      ...createStatusSnapshot(),
      runtimes: [
        {
          ...createStatusSnapshot().runtimes[0]!,
          sessionId: "A-session-2"
        }
      ]
    });

    expect(synced.history.A?.sessionId).toBe("A-session-2");
    expect(synced.history.A?.recent).toEqual([]);
    expect(synced.history.A?.totals.searches).toBe(0);
  });
});

function createActivityState(): UiActivityState {
  return {
    runtimes: {},
    history: {}
  };
}

function createToolEvent(
  eventType: NormalizedTelemetryEvent["eventType"],
  details: Record<string, unknown>
): NormalizedTelemetryEvent {
  return {
    role: "A",
    sessionId: "A-session-1",
    eventType,
    timestamp: "2026-04-20T12:00:00.000Z",
    details
  };
}

function createSnapshot(input: {
  label: string;
  target?: string | undefined;
}): ActivitySnapshot {
  return {
    role: "A",
    phase: "planning",
    kind: "tool",
    label: input.label,
    target: input.target,
    startedAt: "2026-04-20T12:00:00.000Z"
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
        cwd: "/tmp/project",
        modelDisplay: "GPT-5.4 (openai/gpt-5.4)",
        thinking: "high"
      }
    ],
    metrics: {}
  };
}

it("keeps the bounded recent projection idempotent and never reopens a completed tool", () => {
  const start = createToolEvent("pi.tool_execution_start", { toolName: "read", toolCallId: "reused" });
  start.runId = "run-one";
  const end = { ...start, eventType: "pi.tool_execution_end", details: { ...start.details, isError: true } };
  let state = createActivityState();
  for (const event of [start, start, end, end, start]) state = applyActivityHistoryEvent(state, event);
  expect(state.history.A?.totals.reads).toBe(1);
  expect(state.history.A?.recent).toHaveLength(1);
  expect(state.history.A?.recent[0]?.status).toBe("failed");
  state = applyActivityHistoryEvent(state, { ...start, runId: "run-two" });
  expect(state.history.A?.totals.reads).toBe(2);
  expect(state.history.A?.recent).toHaveLength(2);
});
