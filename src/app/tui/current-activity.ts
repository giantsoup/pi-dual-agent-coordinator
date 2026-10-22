import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { currentActionText } from "../interactive/current-activity.js";
import { safeDisplayText } from "../../security/display-text.js";
import type { InteractiveUiState } from "../../types/ui.js";
import type { HistoryRecord } from "../../types/history.js";
import { frame, paintRole } from "./workspace.js";

export interface WorkspaceViewStatus {
  unread: number;
  following: boolean;
  hidden: boolean;
  returnHint: string;
}

export function renderCurrentActivity(state: InteractiveUiState, width: number, height: number, now: number, view: WorkspaceViewStatus): string[] {
  if (height <= 0) return [];
  const activity = state.currentActivity;
  const action = activity.action;
  const role = activity.owner.kind === "runtime" ? activity.owner.role : undefined;
  const active = !(action.kind === "compaction" && action.outcome !== "running") && !["idle", "terminal", "approval_waiting"].includes(action.kind);
  const marker = active && process.env.TERM !== "dumb" ? ["●", "○"][Math.floor(now / 500) % 2] ?? "●" : active ? "*" : "-";
  const bold = (text: string) => process.env.TERM === "dumb" ? text : `\x1b[1m${text}\x1b[22m`;
  const inner = Math.max(1, width - 4);
  const actionLine = `${marker} ${bold(safeDisplayText(action.kind === "cancelling" ? "Cancelling" : currentActionText(action)))}`;
  const failure = action.kind === "terminal" && action.outcome === "failed" ? action.failure : undefined;
  const reason = failure ? safeDisplayText(failure.reason) : undefined;
  const roleText = role ? role === "A" ? "A - Senior" : "B - Junior" : "Coordinator";
  const phase = action.kind === "cancelling" ? "Cleanup" : safeDisplayText(activity.phase);
  const model = activity.model ? safeDisplayText(activity.model).replace(/\s+\([^()]+\/[^()]+\)$/, "") : undefined;
  const identity = `${roleText}${model ? ` / ${model}` : ""} / ${phase}`;
  const returnHint = view.unread ? `${view.unread} unread / ${view.returnHint}` : view.hidden || !view.following ? view.returnHint : undefined;
  if (height < 5) {
    if (height === 1) return [truncateToWidth(failure ? `${failure.role} failed: ${reason}` : actionLine, width, "…", true)];
    if (failure) return [truncateToWidth(`Agent ${failure.role} failed / ${phase}`, width, "…"), ...wrapTextWithAnsi(reason ?? "Request failed", width).slice(0, height - 1)];
    if (action.kind === "compaction") return [truncateToWidth(action.outcome === "running" ? `A compacting ${action.role} history / Ctrl+C cancel` : currentActionText(action), width, "…"), ...[actionLine, returnHint ?? identity].slice(0, height - 1)].map((row) => truncateToWidth(row, width, "…", true));
    const rows = [paintRole(`Current activity / ${role ? `Agent ${role}` : "Coordinator"}`, role), actionLine, ...(returnHint ? [returnHint] : [identity])];
    return rows.slice(0, height).map((row) => truncateToWidth(row, width, "…", true));
  }
  const budget = height - 2;
  const rows = [actionLine];
  if (reason) rows.push(...wrapTextWithAnsi(reason, inner).slice(0, Math.max(1, budget - rows.length - 1)));
  if (action.kind === "cancelling" && rows.length < budget) rows.push(secondary("Waiting for runtime cleanup"));
  const progress = activity.progress;
  const timing = [activity.startedAt !== undefined && action.kind !== "terminal" && !(action.kind === "compaction" && action.outcome !== "running") ? `${seconds(now - activity.startedAt)}s elapsed` : undefined,
    activity.lastEventAt !== undefined && active ? `last event ${seconds(now - activity.lastEventAt)}s ago` : undefined].filter(Boolean).join(" / ");
  const next = action.kind === "approval_waiting" ? "/approve starts B / /discard clears the plan" : undefined;
  const requiredTail = [progress, returnHint, next].filter((row): row is string => Boolean(row));
  if (action.kind === "tool_execution" && action.target) {
    const targetBudget = Math.max(1, Math.min(width >= 100 ? 2 : 1, budget - rows.length - requiredTail.length - (timing ? 1 : 0)));
    rows.push(...wrapTextWithAnsi(safeDisplayText(action.target), inner).slice(0, targetBudget));
  }
  if (timing && rows.length + requiredTail.length < budget) rows.push(secondary(timing));
  rows.push(...requiredTail.slice(0, budget - rows.length));
  const recent = recentCalls(state);
  if (recent && rows.length + 2 <= budget) rows.push("", paintRole(recent, role));
  const lines = frame("", rows.map((row) => ` ${row} `), width, height, role);
  const heading = truncateToWidth(` Current / ${identity} `, Math.max(0, width - 2), "…", true);
  lines[0] = truncateToWidth(paintRole(`+${heading}${"-".repeat(Math.max(0, width - 2 - visibleWidth(heading)))}+`, role), width, "…", true);
  return lines;
}

function seconds(milliseconds: number): number { return Math.max(0, Math.floor(milliseconds / 1000)); }

function secondary(text: string): string {
  return process.env.NO_COLOR !== undefined || process.env.TERM === "dumb" ? text : `\x1b[37;49m${text}\x1b[39m`;
}

function recentCalls(state: InteractiveUiState): string | undefined {
  const turnId = state.history.currentTurnId;
  if (!turnId) return undefined;
  const runs = new Set(state.history.records.filter((record) => record.kind === "run" && record.parentId === turnId).map((record) => record.id));
  const calls = state.history.records.filter((record): record is Extract<HistoryRecord, { kind: "tool" }> => record.kind === "tool" && runs.has(record.parentId) && record.outcome.kind !== "running")
    .sort((a, b) => Date.parse(b.outcome.kind === "running" ? b.timestamp : b.outcome.endedAt ?? b.timestamp) - Date.parse(a.outcome.kind === "running" ? a.timestamp : a.outcome.endedAt ?? a.timestamp) || (b.sequence ?? 0) - (a.sequence ?? 0)).slice(0, 3);
  if (!calls.length) return undefined;
  const outcomes = ["failed", "timed_out", "cancelled", "interrupted"] as const;
  const counts = outcomes.flatMap((kind) => {
    const count = calls.filter((call) => call.outcome.kind === kind).length;
    return count ? [`${count} ${kind.replaceAll("_", " ")}`] : [];
  });
  const failure = calls.find((call) => call.outcome.kind === "failed");
  const detail = failure ? `: ${safeDisplayText(failure.title).replaceAll(`${state.status.cwd.replace(/\/$/, "")}/`, "")}` : "";
  return `${calls.length} recent call${calls.length === 1 ? "" : "s"}${counts.length ? ` / ${counts.join(" / ")}` : ""}${detail}`;
}
