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
    "Keep your completion record concrete about actual changes or observed verification results.",
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
    "For `pi-completion.summary`, describe actual changes or observed verification results in 1-3 short sentences. Use changedPaths: [] when no files changed.",
    "List every modified file in `changedPaths`.",
    "Include `verification` with the checks or commands you actually ran whenever possible.",
    "Changed paths require successful native tool results in this handoff. Verification requires observed native results; report failed checks as failures. Earlier handoffs and printed tool markup are not execution evidence. If unable to execute, leave those arrays empty and explain the blocker in openQuestions.",
    "Follow this handoff's stop condition. For verification-only work, report the observed command, exit code, available totals, and assertion differences, then stop even when the check fails. Failure does not authorize diagnosis, repair, or a rerun. Leave unverified causes unresolved for Agent A.",
    "Implementation tasks must still meet their own acceptance criteria; there is no universal tool-call limit.",
    "Include `openQuestions` only when something remains unresolved.",
    `End your assistant turn with exactly one \`\`\`pi-completion\`\`\` JSON block for workflow ${envelope.workflowId}, handoff ${envelope.handoffId}, iteration ${envelope.iteration}. Write that block as plain assistant text, not as a tool call. Do not emit any other machine blocks, and do not place prose after the completion block.`
  ]
    .filter((line, index, lines) => !(line === "" && lines[index - 1] === ""))
    .join("\n");
}
