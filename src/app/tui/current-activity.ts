import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { currentActionText } from "../interactive/current-activity.js";
import { safeDisplayText } from "../../security/display-text.js";
import type { InteractiveUiState } from "../../types/ui.js";
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
  const inner = Math.max(1, width - 2);
  const actionLine = `${marker} ${bold(safeDisplayText(currentActionText(action)))}`;
  const failure = action.kind === "terminal" && action.outcome === "failed" ? action.failure : undefined;
  const reason = failure ? safeDisplayText(failure.reason) : undefined;
  const roleText = role ? action.kind === "terminal" ? `Agent ${role}` : `Active: ${role === "A" ? "A - Senior" : "B - Junior"}` : "Coordinator";
  const phase = safeDisplayText(activity.phase);
  const model = activity.model ? truncateToWidth(safeDisplayText(activity.model), Math.max(1, inner - roleText.length - phase.length - 6), "…") : undefined;
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
  const rows = [identity, actionLine];
  if (reason) rows.push(...wrapTextWithAnsi(reason, inner).slice(0, Math.max(1, budget - rows.length - 1)));
  const progress = activity.progress;
  const timing = [activity.startedAt !== undefined && action.kind !== "terminal" && !(action.kind === "compaction" && action.outcome !== "running") ? `${seconds(now - activity.startedAt)}s elapsed` : undefined,
    activity.lastEventAt !== undefined && active ? `last event ${seconds(now - activity.lastEventAt)}s ago` : undefined].filter(Boolean).join(" / ");
  const next = action.kind === "compaction" ? undefined : action.kind === "approval_waiting" ? "/approve starts B / /discard clears the plan" : active ? "Esc then x cancel / Ctrl+C cancel" : undefined;
  const requiredTail = [progress, returnHint].filter((row): row is string => Boolean(row));
  if (action.kind === "tool_execution" && action.target) {
    const targetBudget = Math.max(1, Math.min(width >= 100 ? 2 : 1, budget - rows.length - requiredTail.length - (timing ? 1 : 0)));
    rows.push(...wrapTextWithAnsi(safeDisplayText(action.target), inner).slice(0, targetBudget));
  }
  if (timing && rows.length + requiredTail.length < budget) rows.push(timing);
  rows.push(...requiredTail.slice(0, budget - rows.length));
  if (next && !returnHint && rows.length < budget) rows.push(next);
  for (const item of activity.recent) {
    if (rows.length >= budget) break;
    rows.push(`Recent: ${safeDisplayText(item.text)}`);
  }
  const label = action.kind === "compaction" && action.outcome !== "running" ? action.outcome : action.kind === "terminal" ? action.outcome.replaceAll("_", " ") : action.kind === "approval_waiting" ? "waiting approval" : active ? "live" : "ready";
  return frame(`Current activity / ${label}`, rows.map((row, index) => index === 0 ? paintRole(row, role) : row), width, height, role);
}

function seconds(milliseconds: number): number { return Math.max(0, Math.floor(milliseconds / 1000)); }
