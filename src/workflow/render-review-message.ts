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
    "If you finalize, make the operator-facing response specific and informative rather than generic.",
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
    "If you emit `pi-final`:",
    "- Keep `summary` short and factual.",
    "- Remember that `pi-final` is a fenced block label in assistant text, not a tool name.",
    "- Make `userResponse` explain what Agent B changed, which files or areas were touched, what verification ran, and any notable caveats or follow-ups when relevant.",
    "- Use the normalized completion data above instead of a generic success statement.",
    "",
    "If you emit `pi-handoff`, provide concrete revision notes that Agent B can act on directly.",
    "",
    `If you emit \`pi-final\`, its iteration must stay ${completion.iteration}.`,
    `If you emit \`pi-handoff\`, its iteration must advance to ${completion.iteration + 1}.`,
    "End your turn with exactly one `pi-final` or `pi-handoff` JSON block. Write it as plain assistant text, not as a tool call. Do not emit any other machine blocks."
  ]
    .filter((line, index, lines) => !(line === "" && lines[index - 1] === ""))
    .join("\n");
}
