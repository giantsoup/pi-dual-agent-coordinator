import { renderActivityText, renderReasonText, type ActivitySnapshot } from "./activity-summary.js";
import type { CoordinatorStatusSnapshot } from "../types/status.js";
import type { Role } from "../types/role.js";
import type { NormalizedTelemetryEvent } from "../types/telemetry.js";
import type {
  UiActivityState,
  UiRuntimeActivityHistory,
  UiRuntimeActivityHistoryItem,
  UiRuntimeActivityTotals
} from "../types/ui.js";

const MAX_RECENT_ACTIVITY_ITEMS = 8;
const MACHINE_BLOCK_PSEUDO_TOOLS = new Set([
  "pi-plan",
  "pi-execute",
  "pi-handoff",
  "pi-completion",
  "pi-final"
]);

export function createEmptyRuntimeActivityTotals(): UiRuntimeActivityTotals {
  return {
    reads: 0,
    searches: 0,
    listings: 0,
    writes: 0,
    edits: 0,
    commands: 0,
    mcpCalls: 0,
    otherTools: 0
  };
}

export function createRuntimeActivityHistory(sessionId: string): UiRuntimeActivityHistory {
  return {
    sessionId,
    totals: createEmptyRuntimeActivityTotals(),
    recent: []
  };
}

export function syncActivityHistoryWithStatus(
  activity: UiActivityState,
  status: CoordinatorStatusSnapshot
): UiActivityState {
  const nextHistory: UiActivityState["history"] = {};
  let changed = false;

  for (const runtime of status.runtimes) {
    const existing = activity.history[runtime.role];
    if (!existing || existing.sessionId !== runtime.sessionId) {
      nextHistory[runtime.role] = createRuntimeActivityHistory(runtime.sessionId);
      changed = true;
      continue;
    }
    nextHistory[runtime.role] = existing;
  }

  const currentRoles = new Set(status.runtimes.map((runtime) => runtime.role));
  for (const role of Object.keys(activity.history) as Role[]) {
    if (!currentRoles.has(role)) {
      changed = true;
    }
  }

  if (!changed) {
    return activity;
  }

  return {
    ...activity,
    history: nextHistory
  };
}

export function applyActivityHistoryEvent(
  activity: UiActivityState,
  event: NormalizedTelemetryEvent,
  snapshot?: ActivitySnapshot | undefined
): UiActivityState {
  const previous = activity.history[event.role];
  const next = reduceRuntimeActivityHistory(previous, event, snapshot);
  if (!next || next === previous) {
    return activity;
  }

  return {
    ...activity,
    history: {
      ...activity.history,
      [event.role]: next
    }
  };
}

export function renderRuntimeActivitySummary(history?: UiRuntimeActivityHistory): string[] {
  if (!history) {
    return ["no tool activity yet"];
  }

  const parts = [
    formatSummaryPart(history.totals.reads, "read"),
    formatSummaryPart(history.totals.searches, "search", "searches"),
    formatSummaryPart(history.totals.listings, "listing"),
    formatSummaryPart(history.totals.edits, "edit"),
    formatSummaryPart(history.totals.writes, "write"),
    formatSummaryPart(history.totals.commands, "command"),
    formatSummaryPart(history.totals.mcpCalls, "MCP call"),
    formatSummaryPart(history.totals.otherTools, "other tool")
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts : ["no tool activity yet"];
}

function reduceRuntimeActivityHistory(
  history: UiRuntimeActivityHistory | undefined,
  event: NormalizedTelemetryEvent,
  snapshot?: ActivitySnapshot | undefined
): UiRuntimeActivityHistory | undefined {
  const current =
    history && history.sessionId === event.sessionId
      ? history
      : createRuntimeActivityHistory(event.sessionId);

  switch (event.eventType) {
    case "pi.tool_execution_start":
      return applyToolStart(current, event, snapshot);
    case "pi.tool_execution_end":
      return applyToolEnd(current, event, snapshot);
    default:
      return current === history ? history : current;
  }
}

function applyToolStart(
  history: UiRuntimeActivityHistory,
  event: NormalizedTelemetryEvent,
  snapshot?: ActivitySnapshot | undefined
): UiRuntimeActivityHistory {
  const toolName = stringValue(event.details.toolName);
  if (!toolName || MACHINE_BLOCK_PSEUDO_TOOLS.has(toolName)) {
    return history;
  }

  const toolCallId = stringValue(event.details.toolCallId);
  const item: UiRuntimeActivityHistoryItem = {
    id: (event.runId && toolCallId ? `${event.runId}:${toolCallId}` : toolCallId) ?? `${event.role}:${toolName}:${event.timestamp}`,
    text: snapshot ? renderActivityText(snapshot) : `running ${toolName}`,
    detail: snapshot ? renderReasonText(snapshot) : undefined,
    status: "active",
    toolName,
    toolCallId,
    startedAt: event.timestamp,
    updatedAt: event.timestamp
  };

  if (history.seenCalls?.includes(item.id)) return history;

  return {
    ...history,
    totals: incrementToolTotal(history.totals, toolName, snapshot),
    seenCalls: [...(history.seenCalls ?? []), item.id],
    recent: upsertRecentItem(history.recent, item),
    updatedAt: event.timestamp
  };
}

function applyToolEnd(
  history: UiRuntimeActivityHistory,
  event: NormalizedTelemetryEvent,
  snapshot?: ActivitySnapshot | undefined
): UiRuntimeActivityHistory {
  const toolName = stringValue(event.details.toolName);
  if (!toolName || MACHINE_BLOCK_PSEUDO_TOOLS.has(toolName)) {
    return history;
  }

  const toolCallId = stringValue(event.details.toolCallId);
  const status = event.details.isError === true ? "failed" : "completed";
  const item: UiRuntimeActivityHistoryItem = {
    id: (event.runId && toolCallId ? `${event.runId}:${toolCallId}` : toolCallId) ?? `${event.role}:${toolName}:${event.timestamp}`,
    text: snapshot ? renderActivityText(snapshot) : `finished ${toolName}`,
    detail: snapshot ? renderReasonText(snapshot) : undefined,
    status,
    toolName,
    toolCallId,
    startedAt: history.recent.find((item) => item.id === (event.runId && toolCallId ? `${event.runId}:${toolCallId}` : toolCallId))?.startedAt ?? event.timestamp,
    updatedAt: event.timestamp
  };

  const existing = history.recent.find((previous) => previous.id === item.id);
  if (existing && existing.status !== "active") return history;

  return {
    ...history,
    recent: upsertRecentItem(history.recent, item),
    updatedAt: event.timestamp
  };
}

function incrementToolTotal(
  totals: UiRuntimeActivityTotals,
  toolName: string,
  snapshot?: ActivitySnapshot | undefined
): UiRuntimeActivityTotals {
  if (isMcpTool(toolName, snapshot)) {
    return {
      ...totals,
      mcpCalls: totals.mcpCalls + 1
    };
  }

  switch (toolName) {
    case "read":
      return {
        ...totals,
        reads: totals.reads + 1
      };
    case "grep":
    case "find":
      return {
        ...totals,
        searches: totals.searches + 1
      };
    case "ls":
      return {
        ...totals,
        listings: totals.listings + 1
      };
    case "write":
      return {
        ...totals,
        writes: totals.writes + 1
      };
    case "edit":
      return {
        ...totals,
        edits: totals.edits + 1
      };
    case "bash":
      return {
        ...totals,
        commands: totals.commands + 1
      };
    default:
      return {
        ...totals,
        otherTools: totals.otherTools + 1
      };
  }
}

function upsertRecentItem(
  recent: UiRuntimeActivityHistoryItem[],
  item: UiRuntimeActivityHistoryItem
): UiRuntimeActivityHistoryItem[] {
  const index = recent.findIndex((previous) => previous.id === item.id);
  if (index === -1) {
    return [...recent, item].slice(-MAX_RECENT_ACTIVITY_ITEMS);
  }

  const next = [...recent];
  next[index] = {
    ...next[index]!,
    ...item,
    startedAt: next[index]!.startedAt
  };
  return next.slice(-MAX_RECENT_ACTIVITY_ITEMS);
}

function isMcpTool(toolName: string, snapshot?: ActivitySnapshot | undefined): boolean {
  return toolName === "mcp" || snapshot?.label.includes("MCP tool") === true;
}

function formatSummaryPart(
  count: number,
  singular: string,
  plural = `${singular}s`
): string | undefined {
  if (count <= 0) {
    return undefined;
  }
  return `${count} ${count === 1 ? singular : plural}`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
