import type { CompletionRecord } from "../types/handoff.js";
import type { WorkflowSnapshot } from "../types/workflow.js";

function renderList(title: string, values: string[] | undefined): string[] {
  if (!values || values.length === 0) {
    return [];
  }

  return [title, ...values.map((value) => `- ${value}`)];
}

export function renderReviewMessage(
  workflow: WorkflowSnapshot,
  completion: CompletionRecord
): string {
  return [
    "Coordinator review prompt for Agent A.",
    "You are the final sign-off owner for this workflow.",
    "Do not rely on any raw Agent B assistant text beyond this normalized completion summary.",
    "",
    `Original user objective: ${workflow.userTask ?? "(missing)"}`,
    `Workflow ID: ${workflow.workflowId}`,
    `Current iteration: ${completion.iteration}`,
    "",
    "Latest Agent B summary:",
    completion.summary,
    "",
    ...renderList("Changed paths:", completion.changedPaths),
    "",
    ...renderList("Verification:", completion.verification),
    "",
    ...renderList("Open questions:", completion.openQuestions),
    "",
    `If you emit \`pi-final\`, its iteration must stay ${completion.iteration}.`,
    `If you emit \`pi-handoff\`, its iteration must advance to ${completion.iteration + 1}.`,
    "Either emit `pi-final` if the workflow is complete, or emit the next `pi-handoff` with concrete revision notes."
  ]
    .filter((line, index, lines) => !(line === "" && lines[index - 1] === ""))
    .join("\n");
}
