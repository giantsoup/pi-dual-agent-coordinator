import type { WorkflowSnapshot } from "../types/workflow.js";

export function renderCapExceededMessage(workflow: WorkflowSnapshot): string {
  return [
    "Coordinator control prompt.",
    `Workflow ${workflow.workflowId} has reached the review cap at iteration ${workflow.currentIteration}.`,
    "Reply with exactly one `pi-final` JSON block.",
    'Set `decision` to `"blocked"` and summarize the remaining gaps for the operator.'
  ].join("\n");
}

export function renderRepairMessage(
  role: "A" | "B",
  expectedBlockType: "pi-handoff" | "pi-completion" | "pi-final" | "pi-handoff-or-pi-final",
  reason: string,
  hint?: string | undefined
): string {
  const expected =
    expectedBlockType === "pi-handoff-or-pi-final"
      ? "exactly one valid `pi-handoff` or `pi-final` block"
      : `exactly one valid \`${expectedBlockType}\` block`;

  return [
    `Coordinator repair prompt for Agent ${role}.`,
    `Your previous response could not be accepted: ${reason}`,
    `Reply with ${expected}.`,
    ...(hint ? [hint] : []),
    "Do not include any additional machine blocks."
  ].join("\n");
}
