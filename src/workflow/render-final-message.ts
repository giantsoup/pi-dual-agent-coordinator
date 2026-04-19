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
    role === "A"
      ? "If you reply with `pi-final`, keep `summary` concise, make `userResponse` specific to the actual implementation and verification, and write the fenced block as assistant text rather than a tool call."
      : "If you reply with `pi-completion`, make `summary` concrete, keep `changedPaths` accurate, include `verification` when you ran checks, and write the fenced block as assistant text rather than a tool call.",
    "Do not include any additional machine blocks.",
    "Ensure the final fenced JSON block is the only machine block in your reply."
  ].join("\n");
}
