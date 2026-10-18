import type { WorkflowSnapshot } from "../types/workflow.js";

export function renderCapExceededMessage(workflow: WorkflowSnapshot): string {
  return [
    "Coordinator control prompt.",
    `Workflow ${workflow.workflowId} has reached the review cap at iteration ${workflow.currentIteration}.`,
    "Reply with exactly one `pi-final` JSON block.",
    'Set `decision` to `"blocked"` and summarize the remaining gaps for the operator.',
    "Keep `summary` short and factual.",
    "Make `userResponse` clearly explain what remains unresolved, what was attempted, and what the operator should know next."
  ].join("\n");
}
