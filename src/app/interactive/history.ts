import { z } from "zod";
import { readFileSync } from "node:fs";
import type { HistoryRecord, HistorySnapshot, RecordOutcome } from "../../types/history.js";
import type { NormalizedTelemetryEvent } from "../../types/telemetry.js";
import { safeDisplayText } from "../../security/display-text.js";

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
  private currentTurnId: string | undefined;
  private revision = 0;
  private warnings: string[] = [];
  public restore(input: ReturnType<typeof loadHistoryEvents>): void {
    this.warnings = input.warnings;
    if (input.events.some((event) => event.eventType.startsWith("pi.tool_execution") && !event.runId)) this.warnings.push("Earlier calls have no durable run association. Full task history was not retained by the previous UI.");
    for (const event of input.events) this.observe(event);
    for (const [id, record] of this.records) {
      if (record.outcome.kind === "running") this.records.set(id, { ...record, outcome: { kind: "interrupted", endedAt: null } });
    }
    this.currentTurnId = [...this.records.values()].filter((record) => record.kind === "turn").at(-1)?.id;
  }
  public snapshot(): HistorySnapshot { return { records: [...this.records.values()], currentTurnId: this.currentTurnId, revision: this.revision, warnings: this.warnings }; }
  public get(id: string): HistoryRecord | undefined { return this.records.get(id); }
  public observe(event: NormalizedTelemetryEvent): boolean {
    const d = event.details;
    const turnId = event.operatorTurnId ?? [...this.records.values()].find((record) => record.kind === "turn" && event.requestId && record.requestIds.includes(event.requestId))?.id;
    const runId = event.runId;
    let changed = false;
    const put = (record: HistoryRecord) => {
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
    }
    if (event.eventType === "runtime.run_started" && runId && turnId && !this.records.has(runId)) {
      const provenance = string(d.provenance) ?? "planning_user";
      const phase = provenance.includes("repair") ? "Repair" : provenance.includes("review") || provenance.includes("control") ? "Review" : provenance.includes("handoff") ? "Execution" : "Planning";
      put({ kind: "run", id: runId, parentId: turnId, role: event.role, sessionId: event.sessionId, sessionFile: event.sessionFile,
        branchId: string(d.branchId), requestId: event.requestId, workflowId: string(d.workflowId), handoffId: string(d.handoffId),
        phase, title: phase, timestamp: event.timestamp, outcome: { kind: "running", startedAt: event.timestamp } });
    }
    const run = runId ? this.records.get(runId) : undefined;
    if (event.eventType === "runtime.run_finished" && run?.kind === "run" && run.outcome.kind === "running") put({ ...run, outcome: outcome(d.outcome, event.timestamp) });
    if (event.eventType.startsWith("pi.tool_execution_") && run?.kind === "run") {
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
    if (changed) this.revision++;
    return changed;
  }
}
