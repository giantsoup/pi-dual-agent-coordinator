import { extractMachineBlock } from "../../handoff/handoff-envelope.js";
import { completionRecordSchema, finalDecisionSchema, planProposalEnvelopeSchema } from "../../handoff/handoff-envelope-schema.js";
import type { ArchiveEntry } from "../../runtime/session-history.js";
import type { HistoryDetail, HistoryRecord } from "../../types/history.js";
import { roleLabel } from "../../types/history.js";
import { safeDisplayText, visibleProse } from "../../security/display-text.js";
import { sanitizeToolArgs } from "../activity-summary.js";
import { readCheckInForDisplay, renderCheckInSummary } from "../presentation/check-in.js";

export function projectHistoryDetail(record: HistoryRecord, records: HistoryRecord[], entries: ArchiveEntry[], section: HistoryDetail["section"], offset: number, limit: number, unavailable?: string): HistoryDetail {
  let text = "";
  let reason = unavailable;
  const run = record.kind === "tool" ? records.find((item) => item.id === record.parentId) : record;
  const calls = records.filter((item) => item.kind === "tool" && item.parentId === record.id);
  if (section === "metadata") {
    const checkIn = record.kind === "run" ? entries.filter((entry) => entry.message?.role === "assistant")
      .map((entry) => Array.isArray(entry.message?.content) ? entry.message.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n") : "")
      .map(readCheckInForDisplay).find((value) => value !== undefined) : undefined;
    text = JSON.stringify({ ...record, ...(checkIn ? { checkIn } : {}) }, null, 2);
  }
  else if (section === "summary") text = [record.kind === "turn" ? "Operator turn" : roleLabel(record.role), record.title,
    `State: ${record.outcome.kind}`, `Started: ${record.timestamp}`, record.outcome.kind === "running" ? "No final result yet." : `Ended: ${record.outcome.endedAt ?? "Unknown: completion was not retained before restart"}`,
    ...calls.map((call) => `${call.outcome.kind}: ${call.title}`),
    record.kind === "run" ? "Verification: only evidence in the retained transcript and tool results below. No inferred test outcome." : ""].join("\n");
  else if (record.kind === "turn") text = section === "request" ? record.title : records.filter((item) => item.kind === "run" && item.parentId === record.id).map((item) => `${item.title}: ${item.outcome.kind} [${item.id}]`).join("\n");
  else if (section === "request") {
    if (record.kind === "tool") {
      const call = entries.flatMap((entry) => Array.isArray(entry.message?.content) ? entry.message.content : []).find((part) => part.type === "toolCall" && part.id === record.callId);
      const safeArgs = call ? sanitizeToolArgs(record.toolName, call.arguments) : undefined;
      if (safeArgs && call?.arguments && typeof call.arguments === "object" && "path" in call.arguments && typeof call.arguments.path === "string") safeArgs.path = safeDisplayText(call.arguments.path);
      text = safeArgs ? JSON.stringify(safeArgs, null, 2) : record.request;
      reason ??= "Safe request fields only; content bodies and environment values are deliberately excluded. Commands and patterns may be limited by the existing sanitizer.";
    } else {
      const turn = run?.kind === "run" ? records.find((item) => item.id === run.parentId) : undefined;
      text = turn?.title ?? record.title;
    }
  } else if (record.kind === "tool") {
    const result = entries.find((entry) => entry.message?.role === "toolResult" && entry.message.toolCallId === record.callId)?.message;
    if (result && Array.isArray(result.content)) {
      text = result.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
      // Pi tools disclose their own truncation in text and details. Do not follow arbitrary paths.
      if (text === "Isolated tool failed or access was denied.") reason ??= "Error detail was limited by the isolation boundary; only this safe result was retained.";
      const details = result.details;
      if (details && typeof details === "object" && ("truncation" in details || "fullOutputPath" in details)) reason ??= "Retained Pi result may be truncated upstream. External full-output files are not opened by this inspector.";
      if (result.content.some((part) => part.type !== "text")) reason ??= "Non-text result content is not rendered.";
    } else { text = record.preview; reason ??= record.outcome.kind === "running" ? "Output unavailable: call is still running; preview only." : "Output unavailable: no retained tool result. Telemetry preview is limited to 120 characters."; }
  } else {
    text = entries.filter((entry) => entry.message?.role === "assistant").map((entry) => {
      const message = entry.message;
      const prose = Array.isArray(message?.content) ? message.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n") : "";
      return [visibleProse(prose), reportedResult(prose), message?.errorMessage ? `Result: ${message.errorMessage}` : ""].filter(Boolean).join("\n\n");
    }).filter(Boolean).join("\n\n");
    if (!text) reason ??= "Visible assistant prose unavailable: none retained for this run. Hidden reasoning and workflow blocks are excluded.";
    text += `\n\nCalls:\n${calls.map((call) => `${call.outcome.kind}: ${call.title} [${call.id}]`).join("\n")}`;
  }
  if (record.kind === "turn" && record.responseProgress && section !== "metadata" && section !== "request") text += `\n\n${record.responseProgress.label}\n${record.responseProgress.reason ?? ""}`;
  const lines = safeDisplayText(text).split("\n");
  const start = Math.max(0, Math.min(Math.floor(offset), Math.max(0, lines.length - 1)));
  return { recordId: record.id, section, offset: start, lines: lines.slice(start, start + Math.max(1, Math.min(200, limit))), totalLines: lines.length, reason: reason ? safeDisplayText(reason) : undefined };
}

function reportedResult(text: string): string {
  const checkIn = renderCheckInSummary(text);
  if (checkIn) return checkIn;
  const parse = (name: string): unknown => {
    const block = extractMachineBlock(text, name);
    try { return block ? JSON.parse(block) : undefined; } catch { return undefined; }
  };
  const completion = completionRecordSchema.safeParse(parse("pi-completion"));
  if (completion.success) return [`Reported result: ${completion.data.summary}`, `Changed paths: ${completion.data.changedPaths.join(", ") || "none reported"}`,
    `Reported verification:\n${completion.data.verification?.join("\n") ?? "Not supplied"}`].join("\n");
  const final = finalDecisionSchema.safeParse(parse("pi-final"));
  if (final.success) return `Review decision: ${final.data.decision}\n${final.data.summary}\n${final.data.userResponse}`;
  const plan = planProposalEnvelopeSchema.safeParse(parse("pi-plan"));
  if (plan.success) return `Proposed plan: ${plan.data.summary}\n${plan.data.executionPlan.join("\n")}\nAcceptance criteria:\n${plan.data.acceptanceCriteria.join("\n")}`;
  return "";
}
