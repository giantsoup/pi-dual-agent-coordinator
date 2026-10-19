import type { RuntimeUiBridgeEvent } from "../../coordinator/bind-runtime-events.js";
import type { ArchiveEntry } from "../../runtime/session-history.js";
import { safeDisplayText } from "../../security/display-text.js";
import type { HistoryRecord, TranscriptBlock } from "../../types/history.js";
import type { NormalizedTelemetryEvent } from "../../types/telemetry.js";
import { readableAssistantOutput } from "./history-detail.js";

type Run = Extract<HistoryRecord, { kind: "run" }>;
type Message = { id: string; timestamp: string; sequence: number; text: string; calls: string[] };

/** Display-only live overlay. Committed bodies reload from the read-only Pi archive. */
export class RequestTranscript {
  private readonly live = new Map<string, Message[]>();
  private readonly archived = new Map<string, TranscriptBlock[]>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly unavailable = new Map<string, string>();
  private generation = 0;
  private lastRunId: string | undefined;
  private batchSequence = 0;
  private hydratedTurnId: string | undefined;

  public constructor(private readonly readArchive: (run: Run) => Promise<ArchiveEntry[]>, private readonly messageSequences: (runId: string) => number[]) {}

  public reset(): void {
    this.generation++;
    this.live.clear(); this.archived.clear(); this.pending.clear(); this.unavailable.clear();
    this.lastRunId = undefined; this.hydratedTurnId = undefined;
  }

  private message(runId: string, id: string | undefined, timestamp: string, sequence: number): Message {
    const messages = this.live.get(runId) ?? [];
    this.live.set(runId, messages);
    const key = id ?? messages.at(-1)?.id ?? `${runId}:first`;
    let message = messages.find((item) => item.id === key);
    if (!message) { message = { id: key, timestamp, sequence, text: "", calls: [] }; messages.push(message); }
    return message;
  }

  public observeOutput(event: RuntimeUiBridgeEvent, run: Run, sequence: number): void {
    this.lastRunId = run.id;
    const message = this.message(run.id, event.messageId, event.timestamp, sequence);
    if (event.type === "assistant_text_delta") message.text += safeDisplayText(event.delta);
    else message.text = safeDisplayText(event.text);
  }

  public observeTool(event: NormalizedTelemetryEvent, sequence: number): void {
    if (event.eventType === "runtime.run_started") { this.lastRunId = event.runId; return; }
    if (event.eventType !== "pi.tool_execution_start" || !event.runId || typeof event.details.toolCallId !== "string") return;
    const id = typeof event.details.messageId === "string" ? event.details.messageId : this.lastRunId !== event.runId ? `${event.runId}:batch:${++this.batchSequence}` : undefined;
    this.lastRunId = event.runId;
    const message = this.message(event.runId, id, event.timestamp, sequence);
    if (!message.calls.includes(event.details.toolCallId)) message.calls.push(event.details.toolCallId);
  }

  public blocks(records: HistoryRecord[], turnId: string): TranscriptBlock[] {
    const blocks: TranscriptBlock[] = [];
    for (const run of records) {
      if (run.kind !== "run" || run.parentId !== turnId) continue;
      const calls = records.filter((record): record is Extract<HistoryRecord, { kind: "tool" }> => record.kind === "tool" && record.parentId === run.id);
      const source = this.archived.get(run.id) ?? projectMessages(run, this.live.get(run.id) ?? [], calls);
      blocks.push(...source);
      const included = new Set(source.flatMap((block) => block.kind === "tools" ? block.callIds : []));
      const missing = calls.filter((call) => !included.has(call.id));
      if (missing.length) blocks.push({ kind: "tools", id: `${run.id}:unmatched-tools`, runId: run.id, timestamp: missing[0]?.timestamp ?? run.timestamp, sequence: missing[0]?.sequence ?? run.sequence ?? 0, callIds: missing.map((call) => call.id) });
      const reason = this.unavailable.get(run.id);
      if (reason && !source.some((block) => block.kind === "response")) blocks.push({ kind: "response", id: `${run.id}:unavailable`, runId: run.id, timestamp: run.timestamp, sequence: run.sequence ?? 0, text: reason });
    }
    const grouped: TranscriptBlock[] = [];
    for (const block of blocks.sort(compareTranscriptTime)) {
      const previous = grouped.at(-1);
      const boundary = previous && records.some((record) => record.kind === "run" && record.id !== block.runId && record.sequence !== undefined && record.sequence > previous.sequence && record.sequence < block.sequence);
      if (block.kind === "tools" && previous?.kind === "tools" && previous.runId === block.runId && !boundary) previous.callIds = [...new Set([...previous.callIds, ...block.callIds])];
      else grouped.push(block.kind === "tools" ? { ...block, callIds: [...block.callIds] } : block);
    }
    return grouped;
  }

  public async hydrate(records: HistoryRecord[], turnId: string): Promise<void> {
    if (turnId !== this.hydratedTurnId) {
      this.generation++;
      this.hydratedTurnId = turnId;
      this.archived.clear(); this.pending.clear(); this.unavailable.clear();
    }
    const requestedGeneration = this.generation;
    // One archive read at a time, shared by repeated renders. No session is opened or repaired.
    for (const run of records) {
      if (requestedGeneration !== this.generation) return;
      if (run.kind !== "run" || run.parentId !== turnId || run.outcome.kind === "running" || this.archived.has(run.id) || this.unavailable.has(run.id)) continue;
      let pending = this.pending.get(run.id);
      if (!pending) {
        const generation = this.generation;
        pending = this.readArchive(run).then((entries) => {
          if (generation !== this.generation) return;
          const sequences = this.messageSequences(run.id);
          const messages = entries.filter((entry) => entry.message?.role === "assistant").map((entry, index): Message => ({
            id: entry.id, timestamp: entry.timestamp, sequence: sequences[index] ?? sequenceAtTime(records, entry.timestamp, run),
            text: Array.isArray(entry.message?.content) ? entry.message.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n") : "",
            calls: Array.isArray(entry.message?.content) ? entry.message.content.filter((part) => part.type === "toolCall" && part.id).flatMap((part) => part.id ? [part.id] : []) : []
          }));
          const calls = records.filter((record): record is Extract<HistoryRecord, { kind: "tool" }> => record.kind === "tool" && record.parentId === run.id);
          const live = this.live.get(run.id) ?? [];
          if (run.outcome.kind !== "completed") {
            for (let index = 0; index < live.length; index++) {
              const partial = live[index];
              if (!partial) continue;
              const retained = messages[index];
              if (!retained) messages.push(partial);
              else if (!retained.text && partial.text) retained.text = partial.text;
            }
          }
          this.archived.set(run.id, projectMessages(run, messages, calls));
          this.live.delete(run.id);
        }).catch((error: unknown) => {
          if (generation === this.generation) this.unavailable.set(run.id, safeDisplayText(`Retained output unavailable: ${error instanceof Error ? error.message : "archive could not be read"}`));
        }).finally(() => { if (generation === this.generation) this.pending.delete(run.id); });
        this.pending.set(run.id, pending);
      }
      await pending;
    }
  }
}

export function compareTranscriptTime(a: { timestamp: string; sequence?: number | undefined }, b: { timestamp: string; sequence?: number | undefined }): number {
  if (a.sequence !== undefined && b.sequence !== undefined) return a.sequence - b.sequence;
  const left = Date.parse(a.timestamp), right = Date.parse(b.timestamp);
  return (Number.isFinite(left) ? left : Number.MAX_SAFE_INTEGER) - (Number.isFinite(right) ? right : Number.MAX_SAFE_INTEGER);
}

function sequenceAtTime(records: HistoryRecord[], timestamp: string, run: Run): number {
  const next = records.find((record) => Date.parse(record.timestamp) > Date.parse(timestamp));
  const previous = [...records].reverse().find((record) => Date.parse(record.timestamp) <= Date.parse(timestamp));
  return next?.sequence !== undefined ? next.sequence - 0.5 : (previous?.sequence ?? run.sequence ?? 0) + 0.5;
}

function projectMessages(run: Run, messages: Message[], calls: Extract<HistoryRecord, { kind: "tool" }>[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  const included = new Set<string>();
  for (const message of messages) {
    const text = readableAssistantOutput(message.text);
    if (text) blocks.push({ kind: "response", id: `${run.id}:${message.id}:text`, runId: run.id, timestamp: message.timestamp, sequence: message.sequence, text });
    const members = calls.filter((call) => message.calls.includes(call.callId) && !included.has(call.id));
    if (members.length) {
      members.forEach((call) => included.add(call.id));
      blocks.push({ kind: "tools", id: `${run.id}:${message.id}:tools`, runId: run.id, timestamp: members[0]?.timestamp ?? message.timestamp, sequence: members[0]?.sequence ?? message.sequence, callIds: members.map((call) => call.id) });
    }
  }
  return blocks;
}
