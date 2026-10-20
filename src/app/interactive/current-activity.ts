import { summarizeToolActivity } from "../activity-summary.js";
import { safeDisplayText } from "../../security/display-text.js";
import type { HistoryRecord, HistorySnapshot } from "../../types/history.js";
import type { Role } from "../../types/role.js";
import type { NormalizedTelemetryEvent } from "../../types/telemetry.js";
import type { InteractiveUiState, CurrentActivity, CurrentAction } from "../../types/ui.js";

type Context = Pick<InteractiveUiState, "status" | "operation" | "modal" | "history" | "pendingPlan">;
type Run = Extract<HistoryRecord, { kind: "run" }>;
interface Observation {
  run: Run;
  action: CurrentAction;
  startedAt: number;
  lastEventAt: number;
  calls: Map<string, { action: Extract<CurrentAction, { kind: "tool_execution" }>; startedAt: number; lastEventAt: number }>;
  endedCalls: Set<string>;
  settled: boolean;
}

export function initialCurrentActivity(): CurrentActivity {
  return { action: { kind: "idle" }, owner: { kind: "coordinator" }, phase: "Planning", recent: [] };
}

/** Display state only. The service supplies the operation, binding and indexed request owners. */
export class CurrentActivityReducer {
  private readonly runs = new Map<Role, Observation>();
  private previous = initialCurrentActivity();
  private operation: Context["operation"]["kind"] = "idle";
  private turnId: string | undefined;
  private actionKey = "";
  private compaction: { action: Extract<CurrentAction, { kind: "compaction" }>; sessionId: string; startedAt: number; model?: string | undefined } | undefined;
  private readonly completedCompactions = new Set<string>();

  public constructor(private readonly now: () => number = () => performance.now()) {}

  public update(context: Context, event?: NormalizedTelemetryEvent): CurrentActivity {
    const now = this.now();
    const { status, operation, history, modal } = context;
    const turnId = history.currentTurnId;
    if (turnId !== this.turnId || operation.kind === "running" && this.operation !== "running" && this.operation !== "cancelling") {
      this.runs.clear();
      this.compaction = undefined;
      this.completedCompactions.clear();
      this.turnId = turnId;
    }
    this.operation = operation.kind;
    for (const [role, observation] of this.runs) {
      if (status.runtimes.find((runtime) => runtime.role === role)?.sessionId !== observation.run.sessionId) this.runs.delete(role);
    }
    if (event?.eventType.startsWith("compaction.") && event.operatorTurnId === turnId && operation.kind === "running") {
      const runtime = status.runtimes.find((item) => item.role === event.role);
      const jobId = event.details.jobId;
      if (runtime?.sessionId === event.sessionId && typeof jobId === "string") {
        if (event.eventType === "compaction.started" && !this.completedCompactions.has(jobId)) {
          if (this.compaction?.action.jobId !== jobId) this.compaction = { action: { kind: "compaction", jobId, role: event.role, outcome: "running" }, sessionId: event.sessionId, startedAt: now, model: typeof event.details.summarizerModel === "string" ? safeDisplayText(event.details.summarizerModel) : undefined };
        } else if (this.compaction?.action.jobId === jobId && !this.completedCompactions.has(jobId)) {
          const outcome = event.eventType === "compaction.completed" ? "completed" : event.eventType === "compaction.failed" ? "failed" : "cancelled";
          this.compaction.action = { ...this.compaction.action, outcome };
          this.completedCompactions.add(jobId);
        }
      }
    }
    if (this.compaction && status.runtimes.find((item) => item.role === this.compaction?.action.role)?.sessionId !== this.compaction.sessionId) this.compaction = undefined;
    if (event && event.operatorTurnId === turnId && event.sessionId === this.compaction?.sessionId && this.compaction?.action.outcome === "completed" && !event.eventType.startsWith("compaction.") && !event.eventType.startsWith("pi.compaction") && (event.eventType === "pi.message_update" || event.eventType === "runtime.run_finished")) this.compaction = undefined;
    if (event && operation.kind === "running" && event.operatorTurnId === turnId && turnId) this.observe(context, event, now);

    const recent = recentActivity(history, turnId);
    const base = { owner: { kind: "coordinator" } as const, phase: status.phaseLabel, recent, progress: activityProgress(context) };
    if (operation.kind === "cancelling" || modal.kind === "model_loading" && modal.cancelling) {
      return this.commit({ ...base, action: { kind: "cancelling" } }, now);
    }
    if (this.compaction && (operation.kind === "running" || this.compaction.action.outcome === "failed")) {
      return this.commit({ ...base, action: this.compaction.action, model: this.compaction.model, startedAt: this.compaction.startedAt, progress: this.compaction.action.outcome === "running" ? "Execution paused / Ctrl+C cancel" : undefined }, now);
    }
    if (modal.kind === "model_loading") {
      return this.commit({ ...base, action: { kind: "model_loading", role: modal.role, label: safeDisplayText(modal.progress.message) } }, now);
    }
    if (modal.kind === "model_error") return this.commit({ ...base, action: { kind: "terminal", outcome: "failed" } }, now);
    if (operation.kind !== "running") {
      const turn = history.records.find((record) => record.id === turnId);
      const action: CurrentAction = context.pendingPlan ? { kind: "approval_waiting" }
        : operation.kind !== "idle" ? { kind: "terminal", outcome: operation.kind }
        : turn && turn.outcome.kind !== "running" ? { kind: "terminal", outcome: turn.outcome.kind === "waiting_approval" ? "interrupted" : turn.outcome.kind }
        : { kind: "idle" };
      const latestRun = [...history.records].reverse().find((record) => record.kind === "run" && record.parentId === turnId);
      if (action.kind === "terminal" && action.outcome === "failed" && turnId) {
        const failedRun = history.records.filter((record): record is Run => record.kind === "run" && record.parentId === turnId && record.outcome.kind === "failed")
          .sort((a, b) => Date.parse(b.outcome.kind === "failed" ? b.outcome.endedAt : b.timestamp) - Date.parse(a.outcome.kind === "failed" ? a.outcome.endedAt : a.timestamp) || (b.sequence ?? 0) - (a.sequence ?? 0))[0];
        if (failedRun?.outcome.kind === "failed") return this.commit({ ...base,
          owner: { kind: "runtime", role: failedRun.role, sessionId: failedRun.sessionId, runId: failedRun.id, turnId, requestId: failedRun.requestId },
          phase: failedRun.phase, action: { ...action, ...(failedRun.outcome.reason ? { failure: { role: failedRun.role, reason: safeDisplayText(failedRun.outcome.reason) } } : {}) }
        }, now);
      }
      return this.commit({ ...base, phase: action.kind === "terminal" && latestRun?.kind === "run" ? latestRun.phase : base.phase, action }, now);
    }
    const observation = this.runs.get(status.activeRole);
    if (!observation || observation.settled) return this.commit({ ...base, action: { kind: "preparing", role: status.activeRole } }, now);
    const { run } = observation;
    const call = observation.calls.values().next().value;
    const action = call ? { ...call.action, additionalCalls: observation.calls.size - 1 } : observation.action;
    const runtime = status.runtimes.find((item) => item.role === run.role);
    return this.commit({ action, owner: { kind: "runtime", role: run.role, sessionId: run.sessionId, runId: run.id, turnId: run.parentId, requestId: run.requestId },
      phase: status.phase === "repair" ? status.phaseLabel : run.phase, model: runtime?.modelDisplay,
      startedAt: call?.startedAt ?? observation.startedAt, lastEventAt: call?.lastEventAt ?? observation.lastEventAt, recent, progress: base.progress }, now);
  }

  private observe(context: Context, event: NormalizedTelemetryEvent, now: number): void {
    const runtime = context.status.runtimes.find((item) => item.role === event.role);
    if (!runtime || runtime.sessionId !== event.sessionId || !event.runId) return;
    const run = context.history.records.find((record): record is Run => record.kind === "run" && record.id === event.runId
      && record.parentId === context.history.currentTurnId && record.sessionId === event.sessionId && record.role === event.role && record.requestId === event.requestId);
    if (!run) return;
    if (event.eventType === "runtime.run_started") {
      if (this.runs.get(event.role)?.run.id === run.id || run.outcome.kind !== "running") return;
      if ((this.runs.get(event.role)?.run.sequence ?? -1) > (run.sequence ?? -1)) return;
      this.runs.set(event.role, { run, action: { kind: "waiting", reason: "provider" }, startedAt: now, lastEventAt: now, calls: new Map(), endedCalls: new Set(), settled: false });
      return;
    }
    const observation = this.runs.get(event.role);
    if (!observation || observation.run.id !== run.id || observation.settled) return;
    if (event.eventType === "runtime.run_finished") { observation.settled = true; observation.calls.clear(); return; }
    // A paused B run remains bound, but cannot replace A's observed activity during a check-in.
    if (context.status.activeRole !== event.role) return;
    const d = event.details;
    const callId = typeof d.toolCallId === "string" ? d.toolCallId : undefined;
    if (event.eventType.startsWith("pi.tool_execution_") && callId) {
      if (event.eventType === "pi.tool_execution_end") {
        if (!observation.calls.delete(callId)) return;
        observation.endedCalls.add(callId);
        observation.action = { kind: "waiting", reason: "next_event" };
        observation.startedAt = now;
      } else if (!observation.endedCalls.has(callId)) {
        const previous = observation.calls.get(callId);
        if (previous && event.eventType === "pi.tool_execution_start") return;
        if (previous) previous.lastEventAt = now;
        else if (event.eventType === "pi.tool_execution_start" && typeof d.toolName === "string") {
          const summary = summarizeToolActivity(d.toolName, d.toolArgs, context.status.cwd);
          observation.calls.set(callId, { action: { kind: "tool_execution", callId, toolName: safeDisplayText(d.toolName), label: safeDisplayText(summary.label), target: summary.target ? safeDisplayText(summary.target) : undefined, additionalCalls: 0 }, startedAt: now, lastEventAt: now });
        } else return;
      } else return;
      observation.lastEventAt = now;
      return;
    }
    let action: CurrentAction;
    if (event.eventType === "pi.message_update") {
      switch (d.assistantEventType) {
        case "thinking_start": case "thinking_delta": action = { kind: "thinking" }; break;
        case "text_start": case "text_delta": action = { kind: "writing" }; break;
        case "toolcall_start": case "toolcall_delta": action = { kind: "tool_preparation" }; break;
        case "thinking_end": case "text_end": case "toolcall_end": action = { kind: "waiting", reason: "next_event" }; break;
        default: return;
      }
    } else if (event.eventType === "pi.turn_end") action = { kind: "waiting", reason: "next_event" };
    else return;
    if (JSON.stringify(action) !== JSON.stringify(observation.action)) observation.startedAt = now;
    observation.action = action;
    observation.lastEventAt = now;
  }

  private commit(next: CurrentActivity, now: number): CurrentActivity {
    const key = JSON.stringify([next.owner, next.action.kind, next.action.kind === "tool_execution" ? next.action.callId : "", next.phase]);
    if (next.startedAt === undefined && next.action.kind !== "idle") next = { ...next, startedAt: key === this.actionKey ? this.previous.startedAt : now };
    this.actionKey = key;
    this.previous = next;
    return next;
  }
}

function recentActivity(history: HistorySnapshot, turnId: string | undefined): CurrentActivity["recent"] {
  const runs = new Set(history.records.filter((record) => record.kind === "run" && record.parentId === turnId).map((record) => record.id));
  const completed = history.records.flatMap((record) => record.kind === "tool" && runs.has(record.parentId) && record.outcome.kind !== "running"
    ? [{ id: record.id, timestamp: record.outcome.endedAt ?? record.timestamp, sequence: record.sequence ?? 0, text: safeDisplayText(`${record.role}: ${record.title} / ${record.outcome.kind.replaceAll("_", " ")}`) }] : []);
  const milestones = (history.milestones ?? []).filter((item) => item.turnId === turnId).map((item) => ({ ...item, text: item.label }));
  return [...completed, ...milestones].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp) || b.sequence - a.sequence).slice(0, 3).map(({ id, text }) => ({ id, text }));
}

export function currentActionText(action: CurrentAction): string {
  switch (action.kind) {
    case "idle": return "Ready for your next request";
    case "preparing": return `Preparing Agent ${action.role}`;
    case "waiting": return action.reason === "provider" ? "Waiting for model response" : "Waiting for the next model event";
    case "thinking": return "Thinking";
    case "writing": return "Writing a response";
    case "tool_preparation": return "Preparing a tool call";
    case "tool_execution": return `${action.label[0]?.toUpperCase() ?? ""}${action.label.slice(1)}${action.additionalCalls ? ` (+${action.additionalCalls} running)` : ""}`;
    case "compaction": return action.outcome === "running" ? `Agent A is compacting Agent ${action.role}'s history`
      : action.outcome === "completed" ? `Agent ${action.role} history compacted by A`
      : action.outcome === "cancelled" ? "History compaction cancelled; execution stopped" : "History compaction failed; execution stopped";
    case "approval_waiting": return "Waiting for your approval";
    case "model_loading": return action.label;
    case "cancelling": return "Cancelling; waiting for runtime cleanup";
    case "terminal": return { completed: "Request completed", failed: "Request failed", cancelled: "Request cancelled", timed_out: "Request timed out", interrupted: "Interrupted; no work resumed" }[action.outcome];
    default: { const exhaustive: never = action; return exhaustive; }
  }
}

function activityProgress(context: Context): string | undefined {
  const turn = context.history.records.find((record) => record.id === context.history.currentTurnId);
  if (turn?.kind !== "turn") return undefined;
  const response = turn.responseProgress;
  if (response && response.attempt > 1) return safeDisplayText(response.label);
  const progress = turn.execution;
  if (!progress) return undefined;
  const check = progress.checkIn;
  const label = turn.outcome.kind !== "running" && (check.kind === "checking" || check.kind === "scheduled") ? "checks stopped"
    : check.kind === "scheduled" ? `A check at ${check.afterTurn}`
    : check.kind === "checking" ? `A checking turn ${check.afterTurn}`
    : check.kind === "final_review" ? "final review" : "check stopped";
  return `B turns: ${progress.completedTurns} successful / ${label}`;
}
