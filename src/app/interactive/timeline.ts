import { randomUUID } from "node:crypto";

import {
  sanitizeToolArgs,
  summarizeToolActivity
} from "../activity-summary.js";
import type { RuntimeUiBridgeEvent } from "../../coordinator/bind-runtime-events.js";
import type { CoordinatorStatusSnapshot } from "../../types/status.js";
import type { NormalizedTelemetryEvent } from "../../types/telemetry.js";
import type {
  UiConversationEntry,
  UiTimelineActor,
  UiTimelineChildRow,
  UiTimelineGroupItem,
  UiTimelineItem,
  UiTimelineMessageItem
} from "../../types/ui.js";

const PSEUDO_TOOLS = new Set([
  "pi-plan",
  "pi-execute",
  "pi-handoff",
  "pi-completion",
  "pi-final"
]);

export function appendConversationEntryToTimeline(
  timeline: UiTimelineItem[],
  status: CoordinatorStatusSnapshot,
  entry: UiConversationEntry
): UiTimelineItem[] {
  const message = createMessageItem(status.threadId, {
    actor:
      entry.kind === "assistant_planning_response"
        ? entry.role
        : entry.kind === "operator_message"
          ? "operator"
          : "system",
    createdAt: entry.createdAt,
    text: entry.text,
    sourceLabel: labelForConversationEntry(entry)
  });
  return collapseCompletedGroups([...timeline, message]);
}

export function applyRuntimeUiEventToTimeline(
  timeline: UiTimelineItem[],
  status: CoordinatorStatusSnapshot,
  event: RuntimeUiBridgeEvent
): { timeline: UiTimelineItem[]; appended: UiTimelineItem[] } {
  if (event.type === "assistant_text_delta") {
    const next = upsertStreamingMessage(timeline, status.threadId, event.role, event.timestamp, event.delta);
    return {
      timeline: next,
      appended: []
    };
  }

  if (event.type === "assistant_thinking_delta") {
    const row = createThinkingRow(event);
    const next = upsertActivityGroup(timeline, {
      threadId: status.threadId,
      actor: event.role,
      activityKind: "thinking",
      sourceLabel: "Thinking",
      requestId: event.requestId,
      turnIndex: event.turnIndex,
      timestamp: event.timestamp,
      summary: event.summary ?? `Agent ${event.role} is thinking`,
      row,
      expanded: true,
      status: "active"
    });
    return {
      timeline: next,
      appended: []
    };
  }

  if (event.type === "assistant_turn_committed") {
    const next = commitStreamingMessage(timeline, status.threadId, event.role, event.timestamp, event.text);
    return {
      timeline: finalizeThinkingGroups(next, event.role),
      appended: []
    };
  }

  return {
    timeline,
    appended: []
  };
}

export function applyTelemetryEventToTimeline(
  timeline: UiTimelineItem[],
  status: CoordinatorStatusSnapshot,
  event: NormalizedTelemetryEvent
): { timeline: UiTimelineItem[]; appended: UiTimelineItem[] } {
  if (event.eventType.startsWith("planning.")) {
    const next = upsertActivityGroup(timeline, {
      threadId: status.threadId,
      actor: "system",
      activityKind: "plan",
      sourceLabel: "Plan",
      requestId: event.requestId,
      turnIndex: event.turnIndex,
      timestamp: event.timestamp,
      summary: summarizeLifecycleEvent(event),
      row: {
        id: randomUUID(),
        summary: summarizeLifecycleEvent(event),
        status: isTerminalLifecycleEvent(event) ? "completed" : "active",
        startedAt: event.timestamp,
        updatedAt: event.timestamp
      },
      expanded: true,
      status: isTerminalLifecycleEvent(event) ? "completed" : "active"
    });
    return {
      timeline: next,
      appended: []
    };
  }

  if (event.eventType.startsWith("workflow.")) {
    const next = upsertActivityGroup(timeline, {
      threadId: status.threadId,
      actor: "system",
      activityKind: "workflow",
      sourceLabel: "Workflow",
      requestId: event.requestId,
      turnIndex: event.turnIndex,
      timestamp: event.timestamp,
      summary: summarizeLifecycleEvent(event),
      row: {
        id: randomUUID(),
        summary: summarizeLifecycleEvent(event),
        status: isTerminalLifecycleEvent(event)
          ? event.eventType === "workflow.blocked"
            ? "failed"
            : "completed"
          : "active",
        startedAt: event.timestamp,
        updatedAt: event.timestamp
      },
      expanded: true,
      status: isTerminalLifecycleEvent(event)
        ? event.eventType === "workflow.blocked"
          ? "failed"
          : "completed"
        : "active"
    });
    return {
      timeline: next,
      appended: []
    };
  }

  if (event.eventType === "pi.tool_execution_start") {
    const toolName = stringValue(event.details.toolName);
    if (!toolName || PSEUDO_TOOLS.has(toolName)) {
      return { timeline, appended: [] };
    }
    const kind = classifyToolKind(toolName, status, event.role);
    const summary = summarizeToolForTimeline(toolName, event.details.toolArgs, status.cwd);
    const row = createToolRow(event, status.cwd, "active");
    return {
      timeline: upsertActivityGroup(timeline, {
        threadId: status.threadId,
        actor: event.role,
        activityKind: kind,
        sourceLabel: kind === "mcp" ? "MCP" : "Harness",
        requestId: event.requestId,
        turnIndex: event.turnIndex,
        timestamp: event.timestamp,
        summary,
        row,
        expanded: true,
        status: "active"
      }),
      appended: []
    };
  }

  if (event.eventType === "pi.tool_execution_update") {
    const toolName = stringValue(event.details.toolName);
    if (!toolName || PSEUDO_TOOLS.has(toolName)) {
      return { timeline, appended: [] };
    }
    const kind = classifyToolKind(toolName, status, event.role);
    return {
      timeline: upsertActivityGroup(timeline, {
        threadId: status.threadId,
        actor: event.role,
        activityKind: kind,
        sourceLabel: kind === "mcp" ? "MCP" : "Harness",
        requestId: event.requestId,
        turnIndex: event.turnIndex,
        timestamp: event.timestamp,
        summary: summarizeToolForTimeline(toolName, event.details.toolArgs, status.cwd),
        row: createToolRow(event, status.cwd, "active"),
        expanded: true,
        status: "active"
      }),
      appended: []
    };
  }

  if (event.eventType === "pi.tool_execution_end") {
    const toolName = stringValue(event.details.toolName);
    if (!toolName || PSEUDO_TOOLS.has(toolName)) {
      return { timeline, appended: [] };
    }
    const kind = classifyToolKind(toolName, status, event.role);
    return {
      timeline: upsertActivityGroup(timeline, {
        threadId: status.threadId,
        actor: event.role,
        activityKind: kind,
        sourceLabel: kind === "mcp" ? "MCP" : "Harness",
        requestId: event.requestId,
        turnIndex: event.turnIndex,
        timestamp: event.timestamp,
        summary: summarizeToolForTimeline(toolName, undefined, status.cwd),
        row: createToolRow(event, status.cwd, event.details.isError === true ? "failed" : "completed"),
        expanded: true,
        status: event.details.isError === true ? "failed" : "completed"
      }),
      appended: []
    };
  }

  if (event.eventType === "pi.turn_end") {
    return {
      timeline: collapseCompletedGroups(
        timeline.map((item) =>
          item.kind === "group" && item.actor === event.role && item.status === "active"
            ? {
                ...item,
                status: "completed",
                updatedAt: event.timestamp,
                durationMs: durationMs(item.startedAt, event.timestamp)
              }
            : item
        )
      ),
      appended: []
    };
  }

  return { timeline, appended: [] };
}

export function setTimelineGroupExpanded(
  timeline: UiTimelineItem[],
  itemId: string,
  expanded: boolean
): UiTimelineItem[] {
  return timeline.map((item) =>
    item.kind === "group" && item.id === itemId
      ? {
          ...item,
          expanded,
          expansionMode: "manual"
        }
      : item
  );
}

function upsertStreamingMessage(
  timeline: UiTimelineItem[],
  threadId: string,
  actor: "A" | "B",
  timestamp: string,
  delta: string
): UiTimelineItem[] {
  const last = timeline.at(-1);
  if (last?.kind === "message" && last.streaming && last.actor === actor) {
    return [
      ...timeline.slice(0, -1),
      {
        ...last,
        createdAt: timestamp,
        text: `${last.text}${delta}`
      }
    ];
  }

  return [
    ...collapseCompletedGroups(timeline),
    {
      id: randomUUID(),
      kind: "message",
      threadId,
      activityKind: "message",
      actor,
      sourceLabel: `Agent ${actor}`,
      createdAt: timestamp,
      text: delta,
      streaming: true
    }
  ];
}

function commitStreamingMessage(
  timeline: UiTimelineItem[],
  threadId: string,
  actor: "A" | "B",
  timestamp: string,
  text: string
): UiTimelineItem[] {
  const last = timeline.at(-1);
  if (last?.kind === "message" && last.streaming && last.actor === actor) {
    return [
      ...timeline.slice(0, -1),
      {
        ...last,
        threadId,
        createdAt: timestamp,
        text,
        streaming: false
      }
    ];
  }

  return collapseCompletedGroups([
    ...timeline,
    {
      id: randomUUID(),
      kind: "message",
      threadId,
      activityKind: "message",
      actor,
      sourceLabel: `Agent ${actor}`,
      createdAt: timestamp,
      text,
      streaming: false
    }
  ]);
}

function upsertActivityGroup(
  timeline: UiTimelineItem[],
  input: {
    activityKind: UiTimelineGroupItem["activityKind"];
    actor: UiTimelineActor;
    expanded: boolean;
    requestId?: string | undefined;
    row: UiTimelineChildRow;
    sourceLabel: string;
    status: UiTimelineGroupItem["status"];
    summary: string;
    threadId: string;
    timestamp: string;
    turnIndex?: number | undefined;
  }
): UiTimelineItem[] {
  const last = timeline.at(-1);
  if (
    last?.kind === "group" &&
    last.threadId === input.threadId &&
    last.actor === input.actor &&
    last.activityKind === input.activityKind &&
    last.requestId === input.requestId &&
    last.turnIndex === input.turnIndex
  ) {
    const nextRows = upsertGroupRow(last.rows, input.row);
    return [
      ...timeline.slice(0, -1),
      {
        ...last,
        sourceLabel: input.sourceLabel,
        summary: input.summary,
        status: input.status,
        updatedAt: input.timestamp,
        durationMs:
          input.status === "active" ? undefined : durationMs(last.startedAt, input.timestamp),
        expanded:
          last.expansionMode === "manual"
            ? last.expanded
            : input.status === "active"
              ? true
              : nextRows.length > 1,
        rows: nextRows
      }
    ];
  }

  return collapseCompletedGroups([
    ...timeline,
    {
      id: randomUUID(),
      kind: "group",
      threadId: input.threadId,
      actor: input.actor,
      activityKind: input.activityKind,
      sourceLabel: input.sourceLabel,
      summary: input.summary,
      startedAt: input.timestamp,
      updatedAt: input.timestamp,
      status: input.status,
      expanded: input.expanded,
      rows: [input.row],
      requestId: input.requestId,
      turnIndex: input.turnIndex,
      inline: false,
      expansionMode: "auto"
    }
  ]);
}

function upsertGroupRow(
  rows: UiTimelineChildRow[],
  row: UiTimelineChildRow
): UiTimelineChildRow[] {
  const matchIndex = rows.findIndex(
    (entry) =>
      (entry.toolCallId && row.toolCallId && entry.toolCallId === row.toolCallId) ||
      entry.id === row.id
  );
  if (matchIndex === -1) {
    return [...rows, row];
  }
  const next = [...rows];
  const current = next[matchIndex]!;
  next[matchIndex] = {
    ...current,
    ...row,
    detailPreview:
      current.detailPreview && row.detailPreview && row.detailPreview.startsWith(current.detailPreview)
        ? row.detailPreview
        : row.detailPreview ?? current.detailPreview
  };
  return next;
}

function createThinkingRow(
  event: Extract<RuntimeUiBridgeEvent, { type: "assistant_thinking_delta" }>
): UiTimelineChildRow {
  return {
    id: thinkingRowId(event),
    summary: event.summary ?? "Streaming internal reasoning",
    status: "active",
    startedAt: event.timestamp,
    updatedAt: event.timestamp,
    detailPreview: event.delta
  };
}

function thinkingRowId(
  event: Extract<RuntimeUiBridgeEvent, { type: "assistant_thinking_delta" }>
): string {
  return [
    "thinking",
    event.role,
    event.sessionId,
    event.requestId ?? "no-request",
    String(event.turnIndex ?? "no-turn")
  ].join(":");
}

function createMessageItem(
  threadId: string,
  input: Omit<UiTimelineMessageItem, "activityKind" | "id" | "kind" | "streaming" | "threadId">
): UiTimelineMessageItem {
  return {
    id: randomUUID(),
    kind: "message",
    threadId,
    activityKind: "message",
    actor: input.actor,
    sourceLabel: input.sourceLabel,
    createdAt: input.createdAt,
    text: input.text,
    streaming: false
  };
}

function createToolRow(
  event: NormalizedTelemetryEvent,
  cwd: string,
  status: UiTimelineChildRow["status"]
): UiTimelineChildRow {
  const toolName = stringValue(event.details.toolName) ?? "tool";
  const args = sanitizeToolArgs(toolName, event.details.toolArgs, cwd);
  return {
    id: stringValue(event.details.toolCallId) ?? randomUUID(),
    toolCallId: stringValue(event.details.toolCallId),
    toolName,
    summary: summarizeToolForTimeline(toolName, event.details.toolArgs, cwd),
    target: stringValue(args.path) ?? stringValue(args.command),
    argsPreview: previewObject(args),
    resultPreview:
      stringValue(event.details.resultPreview) ?? stringValue(event.details.partialResultPreview),
    errorPreview: event.details.isError === true ? stringValue(event.details.resultPreview) ?? "Tool failed" : undefined,
    status,
    startedAt: event.timestamp,
    updatedAt: event.timestamp
  };
}

function summarizeToolForTimeline(
  toolName: string,
  args: unknown,
  cwd: string
): string {
  const summary = summarizeToolActivity(toolName, args, cwd);
  return summary.target ? `${summary.label} ${summary.target}` : summary.label;
}

function classifyToolKind(
  toolName: string,
  status: CoordinatorStatusSnapshot,
  role: "A" | "B"
): "mcp" | "harness" {
  if (toolName === "mcp") {
    return "mcp";
  }
  const roleMcp = role === "A" ? status.mcp?.roleA : status.mcp?.roleB;
  if (roleMcp?.servers.some((server) => server.directTools.includes(toolName))) {
    return "mcp";
  }
  return "harness";
}

function labelForConversationEntry(entry: UiConversationEntry): string {
  switch (entry.kind) {
    case "operator_message":
      return "Operator";
    case "assistant_planning_response":
      return `Agent ${entry.role}`;
    case "workflow_summary":
      return "Workflow";
    case "plan_ready":
      return "Plan";
    case "approval_discard":
      return "Operator";
    case "runtime_session":
      return "System";
    case "error":
      return "Error";
  }
}

function summarizeLifecycleEvent(event: NormalizedTelemetryEvent): string {
  switch (event.eventType) {
    case "planning.plan_ready":
      return "Plan ready for approval";
    case "planning.plan_approved":
      return "Plan approved";
    case "planning.plan_discarded":
      return "Plan discarded";
    case "workflow.iteration_prepared":
      return "Prepared the next workflow iteration";
    case "workflow.iteration_delivered":
      return "Delivered the next workflow iteration";
    case "workflow.repair_requested":
      return "Requested a repair";
    case "workflow.finalized":
      return "Workflow finalized";
    case "workflow.blocked":
      return "Workflow blocked";
    case "workflow.capped":
      return "Workflow capped";
    default:
      return event.eventType;
  }
}

function isTerminalLifecycleEvent(event: NormalizedTelemetryEvent): boolean {
  return (
    event.eventType === "planning.plan_ready" ||
    event.eventType === "planning.plan_approved" ||
    event.eventType === "planning.plan_discarded" ||
    event.eventType === "workflow.finalized" ||
    event.eventType === "workflow.blocked" ||
    event.eventType === "workflow.capped"
  );
}

function finalizeThinkingGroups(
  timeline: UiTimelineItem[],
  actor: "A" | "B"
): UiTimelineItem[] {
  return collapseCompletedGroups(
    timeline.map((item) =>
      item.kind === "group" && item.actor === actor && item.activityKind === "thinking" && item.status === "active"
        ? {
            ...item,
            status: "completed",
            expanded: item.expansionMode === "manual" ? item.expanded : false,
            durationMs: durationMs(item.startedAt, item.updatedAt)
          }
        : item
    )
  );
}

function collapseCompletedGroups(timeline: UiTimelineItem[]): UiTimelineItem[] {
  return timeline.map((item, index) => {
    if (item.kind !== "group" || item.expansionMode === "manual") {
      return item;
    }
    const isNewest = index === timeline.length - 1;
    if (item.status === "active") {
      return {
        ...item,
        expanded: true
      };
    }
    return {
      ...item,
      expanded: isNewest ? item.expanded : false,
      inline: item.rows.length <= 1 && !item.rows[0]?.argsPreview && !item.rows[0]?.resultPreview
    };
  });
}

function durationMs(startedAt: string, finishedAt: string): number | undefined {
  const start = Date.parse(startedAt);
  const end = Date.parse(finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return undefined;
  }
  return end - start;
}

function previewObject(value: Record<string, unknown>): string | undefined {
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return undefined;
  }
  return JSON.stringify(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
