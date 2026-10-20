import { responseProgressSchema } from "../../coordinator/response-progress.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import type { HistoryRecord, HistorySnapshot, RecordOutcome, TranscriptMilestone } from "../../types/history.js";
import type { NormalizedTelemetryEvent } from "../../types/telemetry.js";
import { safeDisplayText } from "../../security/display-text.js";
import { executionProgressSchema } from "../../workflow/execution-progress.js";

const eventSchema = z.object({ eventType: z.string(), role: z.enum(["A", "B"]), sessionId: z.string(), timestamp: z.iso.datetime({ offset: true }),
  sessionFile: z.string().optional(), requestId: z.string().optional(), operatorTurnId: z.string().optional(), runId: z.string().optional(),
  leafId: z.string().optional(), turnIndex: z.number().optional(), handoffId: z.string().optional(), details: z.record(z.string(), z.unknown()) });
export function loadHistoryEvents(path: string): { events: NormalizedTelemetryEvent[]; warnings: string[] } {
  let content: string;
  try { content = readFileSync(path, "utf8"); } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { events: [], warnings: [] };
    throw error;
  }
  const events: NormalizedTelemetryEvent[] = [];
  const warnings: string[] = [];
  for (const [index, line] of content.split("\n").entries()) {
    if (!line.trim()) continue;
    try { events.push(eventSchema.parse(JSON.parse(line))); }
    catch { warnings.push(`History event line ${index + 1} unavailable: invalid or incomplete record.`); }
  }
  return { events, warnings };
}
const string = (value: unknown) => typeof value === "string" ? safeDisplayText(value) : undefined;
function outcome(value: unknown, timestamp: string): RecordOutcome {
  switch (value) {
    case "completed": case "failed": case "cancelled": case "timed_out": case "waiting_approval": case "interrupted":
      return { kind: value, endedAt: timestamp };
    default: return { kind: "interrupted", endedAt: timestamp };
  }
}

/** Metadata only. Full bodies remain in Pi's archive and are resolved on inspection. */
export class HistoryIndex {
  private readonly records = new Map<string, HistoryRecord>();
  private readonly milestones = new Map<string, TranscriptMilestone>();
  private currentTurnId: string | undefined;
  private resetId: string | undefined;
  private revision = 0;
  private warnings: string[] = [];
  private sequence = 0;
  private readonly messageSequences = new Map<string, number[]>();
  private readonly indexedMessages = new Set<string>();
  public get eventSequence(): number { return this.sequence; }
  public getMessageSequences(runId: string): number[] { return this.messageSequences.get(runId) ?? []; }
  public restore(input: ReturnType<typeof loadHistoryEvents>): void {
    this.warnings = input.warnings;
    if (input.events.some((event) => event.eventType.startsWith("pi.tool_execution") && !event.runId)) this.warnings.push("Earlier calls have no durable run association. Full task history was not retained by the previous UI.");
    for (const event of input.events) this.observe(event);
    for (const [id, record] of this.records) {
      if (record.outcome.kind === "running" || record.outcome.kind === "waiting_approval") this.records.set(id, { ...record, outcome: { kind: "interrupted", endedAt: null } });
    }
  }
  public snapshot(): HistorySnapshot { return { records: [...this.records.values()], currentTurnId: this.currentTurnId, resetId: this.resetId, revision: this.revision, warnings: this.warnings, milestones: [...this.milestones.values()] }; }
  public get(id: string): HistoryRecord | undefined { return this.records.get(id); }
  public observe(event: NormalizedTelemetryEvent): boolean {
    if (event.eventType.startsWith("pi.") || event.eventType === "runtime.run_finished") {
      const owner = event.runId ? this.records.get(event.runId) : undefined;
      if (!owner || owner.kind !== "run" || owner.role !== event.role || owner.sessionId !== event.sessionId
        || owner.requestId !== event.requestId || event.operatorTurnId && owner.parentId !== event.operatorTurnId
        || owner.outcome.kind !== "running") return false;
    }
    this.sequence++;
    const d = event.details;
    const turnId = event.operatorTurnId ?? [...this.records.values()].find((record) => record.kind === "turn" && event.requestId && record.requestIds.includes(event.requestId))?.id;
    const runId = event.runId;
    if (runId && event.eventType === "pi.message_end" && d.messageRole === "assistant") {
      const key = JSON.stringify([runId, d.messageId ?? event.leafId ?? event.timestamp]);
      if (!this.indexedMessages.has(key)) {
        this.indexedMessages.add(key);
        const sequences = this.messageSequences.get(runId) ?? [];
        sequences.push(this.sequence); this.messageSequences.set(runId, sequences);
      }
    }
    let changed = false;
    if (event.eventType === "ui.conversation_reset" && this.resetId !== event.sessionId) {
      this.currentTurnId = undefined;
      this.resetId = event.sessionId;
      changed = true;
    }
    const put = (record: HistoryRecord) => {
      record = { ...record, sequence: this.records.get(record.id)?.sequence ?? this.sequence };
      if (JSON.stringify(this.records.get(record.id)) === JSON.stringify(record)) return;
      this.records.set(record.id, record); changed = true;
    };
    const turn = turnId ? this.records.get(turnId) : undefined;
    if (event.eventType === "ui.turn_started" && turnId) {
      this.currentTurnId = turnId;
      if (!turn) put({ kind: "turn", id: turnId, title: string(d.objective) ?? "Operator request", requestIds: [],
        timestamp: event.timestamp, outcome: { kind: "running", startedAt: event.timestamp } });
      else if (turn.outcome.kind === "running" || turn.outcome.endedAt !== null && Date.parse(event.timestamp) > Date.parse(turn.outcome.endedAt)) put({ ...turn, outcome: { kind: "running", startedAt: event.timestamp } });
    }
    if (turn?.kind === "turn") {
      if (event.requestId && !turn.requestIds.includes(event.requestId)) put({ ...turn, requestIds: [...turn.requestIds, event.requestId] });
      if (event.eventType === "planning.plan_ready") put({ ...turn, planId: event.requestId, requestIds: event.requestId ? [...new Set([...turn.requestIds, event.requestId])] : turn.requestIds });
      if (event.eventType === "workflow.started") put({ ...turn, workflowId: string(d.workflowId) });
      if (event.eventType === "ui.turn_finished") {
        put({ ...turn, outcome: outcome(d.outcome, event.timestamp) });
        for (const record of this.records.values()) {
          const parent = record.kind === "tool" ? this.records.get(record.parentId) : record;
          if (parent?.kind === "run" && parent.parentId === turnId && (record.outcome.kind === "running" || record.outcome.kind === "interrupted")) {
            const terminal = outcome(d.outcome, event.timestamp);
            put({ ...record, outcome: terminal.kind === "completed" || terminal.kind === "waiting_approval" ? { kind: "interrupted", endedAt: event.timestamp } : terminal });
          }
        }
      }
      if (event.eventType.startsWith("response.")) {
        const progress = responseProgressSchema.safeParse(d);
        const latest = this.records.get(turn.id);
        if (progress.success && latest?.kind === "turn") put({ ...latest, responseProgress: progress.data });
      }
      if (event.eventType === "workflow.execution_progress") {
        const progress = executionProgressSchema.safeParse(d);
        const latest = this.records.get(turn.id);
        if (progress.success && latest?.kind === "turn") put({ ...latest, execution: progress.data });
      }
    }
    if (event.eventType === "runtime.run_started" && runId && turnId && !this.records.has(runId)) {
      const provenance = string(d.provenance) ?? "planning_user";
      const initialPhase = provenance.includes("repair") ? "Repair" : provenance.includes("check_in") ? "Check-in" : provenance.includes("review") || provenance.includes("control") ? "Review" : provenance.includes("handoff") ? "Execution" : "Planning";
      const revision = event.role === "B" && [...this.milestones.values()].some((item) => item.turnId === turnId && item.eventType === "workflow.iteration_prepared" && item.workflowId === d.workflowId);
      const phase = revision && initialPhase === "Execution" ? "Revision" : initialPhase;
      put({ kind: "run", id: runId, parentId: turnId, role: event.role, sessionId: event.sessionId, sessionFile: event.sessionFile,
        branchId: string(d.branchId), requestId: event.requestId, workflowId: string(d.workflowId), handoffId: string(d.handoffId),
        phase, title: phase, timestamp: event.timestamp, outcome: { kind: "running", startedAt: event.timestamp } });
    }
    const run = runId ? this.records.get(runId) : undefined;
    const matchesRun = run?.kind === "run" && run.role === event.role && run.sessionId === event.sessionId && run.requestId === event.requestId;
    if (event.eventType === "runtime.run_finished" && matchesRun && run.outcome.kind === "running") {
      const terminal = outcome(d.outcome, event.timestamp);
      put({ ...run, outcome: terminal.kind === "failed" ? { ...terminal, reason: string(d.reason)?.slice(0, 1600) } : terminal });
    }
    if (event.eventType.startsWith("pi.tool_execution_") && matchesRun && run.outcome.kind === "running") {
      const callId = string(d.toolCallId);
      const toolName = string(d.toolName);
      if (callId && toolName && !toolName.startsWith("pi-")) {
        const id = JSON.stringify([event.role, event.sessionId, run.id, callId]);
        const previous = this.records.get(id);
        const isEnd = event.eventType === "pi.tool_execution_end";
        // A duplicate/replayed start or update cannot reopen a terminal call.
        if (!previous || previous.kind === "tool" && previous.outcome.kind === "running") {
          put({ kind: "tool", id, parentId: run.id, role: event.role, sessionId: event.sessionId, callId, toolName,
            title: previous?.kind === "tool" ? previous.title : `${toolName} ${d.toolArgs && typeof d.toolArgs === "object" ? "path" in d.toolArgs ? string(d.toolArgs.path) ?? "" : "command" in d.toolArgs ? string(d.toolArgs.command) ?? "" : "" : string(d.activityPreview) ?? ""}`.trim(),
            request: previous?.kind === "tool" ? previous.request : safeDisplayText(JSON.stringify(d.toolArgs ?? {})),
            preview: string(d.resultPreview ?? d.partialResultPreview) ?? (previous?.kind === "tool" ? previous.preview : ""),
            timestamp: previous?.timestamp ?? event.timestamp,
            outcome: isEnd ? { kind: d.isError === true ? "failed" : "completed", endedAt: event.timestamp } : previous?.outcome ?? { kind: "running", startedAt: event.timestamp } });
        }
      }
    }
    const label = milestoneLabel(event);
    if (label && turnId) {
      const id = JSON.stringify([turnId, event.eventType, event.requestId, d.workflowId, d.handoffId, d.iteration, d.turnCount, d.jobId]);
      if (!this.milestones.has(id)) {
        this.milestones.set(id, { kind: "milestone", id, turnId, timestamp: event.timestamp, sequence: this.sequence, label, eventType: event.eventType, workflowId: string(d.workflowId) });
        changed = true;
        const disposition = event.eventType === "workflow.iteration_prepared" && typeof d.iteration === "number" && d.iteration > 1 ? "revision_requested"
          : event.eventType === "workflow.finalized" && (d.decision === "approved" || d.decision === "blocked") ? d.decision : undefined;
        if (disposition) {
          const review = [...this.records.values()].reverse().find((record) => record.kind === "run" && record.role === "A" && record.parentId === turnId && record.phase === "Review" && (!record.workflowId || record.workflowId === d.workflowId));
          if (review?.kind === "run") put({ ...review, reviewDisposition: disposition });
        }
      }
    }
    if (changed) this.revision++;
    return changed;
  }
}

function milestoneLabel(event: NormalizedTelemetryEvent): string | undefined {
  switch (event.eventType) {
    case "compaction.started": return `Agent A is compacting Agent ${event.role}'s history`;
    case "compaction.completed": return `Agent ${event.role} history compacted by A`;
    case "compaction.failed": return "History compaction failed; execution stopped";
    case "compaction.cancelled": return "History compaction cancelled; execution stopped";
    case "planning.plan_ready": return "Plan ready / waiting for operator approval";
    case "planning.plan_approved": return "Operator approved the plan / execution authorized";
    case "planning.plan_discarded": return "Operator discarded the plan";
    case "workflow.check_in_started": return "Coordinator requested an A check-in";
    case "workflow.check_in_completed": return event.details.decision === "continue" ? "A check-in / continue execution" : event.details.decision === "redirect" ? "A check-in / redirect execution" : event.details.decision === "blocked" ? "A check-in / execution blocked" : undefined;
    case "workflow.iteration_prepared": return typeof event.details.iteration === "number" && event.details.iteration > 1 ? "A requested a revision / next handoff prepared" : undefined;
    case "workflow.finalized": return event.details.decision === "approved" ? "A approved the result" : event.details.decision === "blocked" ? "A blocked the result" : undefined;
    default: return undefined;
  }
}
