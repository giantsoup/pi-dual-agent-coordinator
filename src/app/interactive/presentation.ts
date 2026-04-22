import type { CoordinatorStatusSnapshot } from "../../types/status.js";
import type { UiConversationEntry } from "../../types/ui.js";
import type { PendingExecutionPlanSnapshot } from "../../types/workflow.js";

export function renderPendingPlan(
  pendingPlan: PendingExecutionPlanSnapshot,
  nextActionHint?: string
): string {
  const lines = [
    "Plan Ready · Agent A",
    `Objective: ${pendingPlan.objective}`,
    `Summary: ${pendingPlan.summary}`,
    "Acceptance Criteria:",
    ...pendingPlan.acceptanceCriteria.map((item) => `- ${item}`),
    "Relevant Paths:",
    ...pendingPlan.relevantPaths.map((item) => `- ${item}`),
    "Execution Steps:",
    ...pendingPlan.executionPlan.map((item) => `- ${item}`)
  ];

  if (pendingPlan.constraints?.length) {
    lines.push("Constraints:");
    lines.push(...pendingPlan.constraints.map((item) => `- ${item}`));
  }

  lines.push(
    `Next: ${nextActionHint ?? "Run /approve to start coordinated execution with Agent B."}`
  );
  return lines.join("\n");
}

export function renderConversationEntry(entry: UiConversationEntry): string {
  switch (entry.kind) {
    case "plan_ready":
      return renderPendingPlan(entry.plan, entry.nextActionHint);
    default:
      return entry.text;
  }
}

export function renderSessionsSummary(
  status: CoordinatorStatusSnapshot,
  sessions: unknown
): string {
  const lines = [
    "Sessions",
    `Project: ${status.cwd}`,
    `Phase: ${status.phaseLabel}`,
    ""
  ];

  for (const runtime of status.runtimes) {
    lines.push(`Agent ${runtime.role}`);
    lines.push(`  session: ${runtime.sessionId}`);
    lines.push(`  file: ${runtime.sessionFile ?? "(memory)"}`);
    lines.push(`  model: ${runtime.modelDisplay}`);
    lines.push(`  healthy: ${runtime.healthy ? "yes" : "no"}`);
    if (runtime.currentActivity) {
      lines.push(`  activity: ${runtime.currentActivity}`);
    }
    if (runtime.currentReason) {
      lines.push(`  reason: ${runtime.currentReason}`);
    }
    lines.push("");
  }

  lines.push("Raw payload:");
  lines.push(JSON.stringify(sessions, null, 2));
  return lines.join("\n");
}

export function renderHandoffSummary(payload: unknown): string {
  const record = asRecord(payload);
  if (!record) {
    return ["Latest Handoff", JSON.stringify(payload, null, 2)].join("\n\n");
  }

  const lines = ["Latest Handoff"];
  const workflow = asRecord(record.workflow);
  if (workflow) {
    lines.push(`Workflow: ${readString(workflow.workflowId) ?? "unknown"}`);
    lines.push(`Status: ${readString(workflow.status) ?? "unknown"}`);
    const iteration = readNumber(workflow.currentIteration);
    if (iteration !== undefined) {
      lines.push(`Current iteration: ${iteration}`);
    }
    const handoffId = readString(workflow.latestHandoffId);
    if (handoffId) {
      lines.push(`Latest handoff: ${handoffId}`);
    }
    const completion = readString(workflow.latestCompletionSummary);
    if (completion) {
      lines.push(`Latest completion: ${completion}`);
    }
    const finalDecision = readString(workflow.finalDecision);
    if (finalDecision) {
      lines.push(`Final decision: ${finalDecision}`);
    }
    lines.push("");
  }

  const ledgerTail = asRecord(record.ledgerTail);
  if (ledgerTail) {
    lines.push("Ledger tail");
    const tailStatus = readString(ledgerTail.status);
    if (tailStatus) {
      lines.push(`Status: ${tailStatus}`);
    }
    const role = readString(ledgerTail.role);
    if (role) {
      lines.push(`Actor: ${role}`);
    }
    const handoffId = readString(ledgerTail.handoffId);
    if (handoffId) {
      lines.push(`Handoff id: ${handoffId}`);
    }
    const sessionId = readString(ledgerTail.sessionId);
    if (sessionId) {
      lines.push(`Session: ${sessionId}`);
    }
    const sessionFile = readString(ledgerTail.sessionFile);
    if (sessionFile) {
      lines.push(`Session file: ${sessionFile}`);
    }
    const timestamp = readString(ledgerTail.timestamp);
    if (timestamp) {
      lines.push(`Updated: ${timestamp}`);
    }

    const envelope = asRecord(ledgerTail.envelope);
    const completion = asRecord(ledgerTail.completion);
    const finalDecision = asRecord(ledgerTail.finalDecision);
    const summary =
      readString(envelope?.summary) ??
      readString(completion?.summary) ??
      readString(finalDecision?.summary);
    if (summary) {
      lines.push("");
      lines.push("Summary:");
      lines.push(summary);
    }
  }

  if (lines.length === 1) {
    lines.push("");
    lines.push(JSON.stringify(payload, null, 2));
  }

  return lines.join("\n");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
