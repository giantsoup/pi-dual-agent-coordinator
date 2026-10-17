import type { HandoffEnvelope } from "../types/handoff.js";

function renderList(title: string, values: string[] | undefined): string[] {
  if (!values || values.length === 0) {
    return [];
  }

  return [title, ...values.map((value) => `- ${value}`)];
}

export function renderHandoffMessage(envelope: HandoffEnvelope): string {
  return [
    "Coordinator handoff for Agent B.",
    "Use your write-authoritative tools to execute the request.",
    "Do not assume access to any raw Agent A text beyond this rendered handoff.",
    "Keep your completion record concrete and implementation-specific.",
    "The coordinator pauses ongoing execution for an Agent A process check-in every 10 completed model turns. Apply its guidance within this handoff's scope and keep the same completion identifiers.",
    "`pi-completion` is the fence label for your final JSON block. It is not a tool name, command, or function call.",
    "",
    `Workflow ID: ${envelope.workflowId}`,
    `Handoff ID: ${envelope.handoffId}`,
    `Iteration: ${envelope.iteration}`,
    `Objective: ${envelope.objective}`,
    "",
    "Execution summary:",
    envelope.summary,
    "",
    ...renderList("Acceptance criteria:", envelope.acceptanceCriteria),
    "",
    ...renderList("Relevant paths:", envelope.relevantPaths),
    "",
    ...renderList("Execution plan:", envelope.executionPlan),
    "",
    ...renderList("Review notes:", envelope.reviewNotes),
    "",
    ...renderList("Constraints:", envelope.constraints),
    "",
    "For `pi-completion.summary`, describe the concrete code changes and the resulting outcome in 1-3 short sentences.",
    "List every modified file in `changedPaths`.",
    "Include `verification` with the checks or commands you actually ran whenever possible.",
    "Include `openQuestions` only when something remains unresolved.",
    `End your assistant turn with exactly one \`\`\`pi-completion\`\`\` JSON block for workflow ${envelope.workflowId}, handoff ${envelope.handoffId}, iteration ${envelope.iteration}. Write that block as plain assistant text, not as a tool call. Do not emit any other machine blocks, and do not place prose after the completion block.`
  ]
    .filter((line, index, lines) => !(line === "" && lines[index - 1] === ""))
    .join("\n");
}
