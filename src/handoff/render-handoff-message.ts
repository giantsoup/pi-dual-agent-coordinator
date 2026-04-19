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
    ...renderList("Review notes:", envelope.reviewNotes),
    "",
    ...renderList("Constraints:", envelope.constraints),
    "",
    `End your assistant turn with exactly one \`\`\`pi-completion\`\`\` JSON block for workflow ${envelope.workflowId}, handoff ${envelope.handoffId}, iteration ${envelope.iteration}.`
  ]
    .filter((line, index, lines) => !(line === "" && lines[index - 1] === ""))
    .join("\n");
}
