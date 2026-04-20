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
  return [
    "Latest Handoff",
    JSON.stringify(payload, null, 2)
  ].join("\n\n");
}
