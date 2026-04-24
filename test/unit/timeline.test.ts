import { describe, expect, it } from "vitest";

import {
  applyRuntimeUiEventToTimeline,
  applyTelemetryEventToTimeline
} from "../../src/app/interactive/timeline.js";
import type { CoordinatorStatusSnapshot } from "../../src/types/status.js";
import type { NormalizedTelemetryEvent } from "../../src/types/telemetry.js";

describe("interactive timeline", () => {
  it("converts thinking deltas into a completed group before the final message", () => {
    const status = createStatus();
    const thinking = applyRuntimeUiEventToTimeline([], status, {
      type: "assistant_thinking_delta",
      role: "A",
      sessionId: "A-session-1",
      timestamp: "2026-04-20T00:00:00.000Z",
      delta: "Inspecting the project",
      summary: "Inspecting the project"
    });
    const committed = applyRuntimeUiEventToTimeline(thinking.timeline, status, {
      type: "assistant_turn_committed",
      role: "A",
      sessionId: "A-session-1",
      timestamp: "2026-04-20T00:00:01.000Z",
      text: "Here is the plan."
    });

    expect(committed.timeline[0]).toMatchObject({
      kind: "group",
      activityKind: "thinking",
      status: "completed"
    });
    expect(committed.timeline[1]).toMatchObject({
      kind: "message",
      text: "Here is the plan."
    });
  });

  it("keeps streaming thinking on a single row while deltas arrive", () => {
    const status = createStatus();

    const first = applyRuntimeUiEventToTimeline([], status, {
      type: "assistant_thinking_delta",
      role: "A",
      sessionId: "A-session-1",
      requestId: "req-1",
      turnIndex: 1,
      timestamp: "2026-04-20T00:00:00.000Z",
      delta: "php",
      summary: "Streaming internal reasoning"
    });
    const second = applyRuntimeUiEventToTimeline(first.timeline, status, {
      type: "assistant_thinking_delta",
      role: "A",
      sessionId: "A-session-1",
      requestId: "req-1",
      turnIndex: 1,
      timestamp: "2026-04-20T00:00:00.100Z",
      delta: "php artisan",
      summary: "Streaming internal reasoning"
    });

    expect(second.timeline).toHaveLength(1);
    expect(second.timeline[0]).toMatchObject({
      kind: "group",
      activityKind: "thinking",
      rows: [
        {
          detailPreview: "php artisan"
        }
      ]
    });
    const thinkingGroup = second.timeline[0];
    expect(thinkingGroup?.kind).toBe("group");
    if (!thinkingGroup || thinkingGroup.kind !== "group") {
      throw new Error("Expected a thinking group.");
    }
    expect(thinkingGroup.rows).toHaveLength(1);
  });

  it("classifies MCP and harness tool groups separately", () => {
    const status = createStatus({
      mcp: {
        enabled: true,
        configSources: [],
        roleA: {
          role: "A",
          enabled: true,
          servers: [
            {
              name: "github",
              transport: "stdio",
              connected: true,
              directTools: ["github__search"],
              lastMetadataSync: "2026-04-20T00:00:00.000Z",
              lastError: undefined
            }
          ]
        },
        roleB: {
          role: "B",
          enabled: false,
          servers: []
        }
      }
    });

    const first = applyTelemetryEventToTimeline([], status, createToolEvent("github__search"));
    const second = applyTelemetryEventToTimeline(first.timeline, status, createToolEvent("bash"));

    expect(second.timeline[0]).toMatchObject({
      kind: "group",
      activityKind: "mcp"
    });
    expect(second.timeline[1]).toMatchObject({
      kind: "group",
      activityKind: "harness"
    });
  });
});

function createToolEvent(toolName: string): NormalizedTelemetryEvent {
  return {
    role: "A",
    sessionId: "A-session-1",
    eventType: "pi.tool_execution_start",
    timestamp: "2026-04-20T00:00:00.000Z",
    details: {
      toolName,
      toolArgs: {}
    }
  };
}

function createStatus(
  overrides: Partial<CoordinatorStatusSnapshot> = {}
): CoordinatorStatusSnapshot {
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
    activeModelDisplay: "GPT-5.4",
    sessionRoot: "/tmp/sessions",
    repairCount: 0,
    maxReviewRounds: 3,
    runtimes: [],
    metrics: {},
    ...overrides
  };
}
