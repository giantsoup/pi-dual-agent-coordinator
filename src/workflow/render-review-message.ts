import { readNativeEvidence } from "../coordinator/native-verification.js";
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
  const completed = workflow.iterations.find((item) => item.iteration === completion.iteration && item.handoffId === completion.handoffId)?.completed;
  const evidence = readNativeEvidence(completed?.details);
  return [
    "Coordinator review prompt for Agent A.",
    "You are the final sign-off owner for this workflow.",
    "Do not rely on any raw Agent B assistant text beyond this normalized completion summary.",
    "The completion summary contains B's claims. Inspect the actual artifacts and check results before approving; native tool evidence admission alone does not prove every claim.",
    "If you finalize, make the operator-facing response specific and informative rather than generic.",
    "",
    `Original user objective: ${workflow.userTask ?? "(missing)"}`,
    `Workflow ID: ${workflow.workflowId}`,
    `Current iteration: ${completion.iteration}`,
    "",
    ...renderList("Current handoff acceptance criteria:", workflow.latestHandoff?.acceptanceCriteria),
    ...renderList("Current handoff constraints:", workflow.latestHandoff?.constraints),
    "Native observations from this handoff, separate from B's claims:",
    evidence ? JSON.stringify({ ...evidence, archive: { sessionId: completed?.sessionId, sessionFile: completed?.sessionFile } }) : "Unknown: native observation metadata was not retained for this historical record.",
    "Native status is the tool outcome. A structured exit code is the shell command's exit, and a pipeline can mask a failed child process. Missing totals, unsupported formats, omitted output, and unverified causes remain unknown. Use toolCallId to inspect the archived result read-only; never rerun actions solely to correct wording.",
    "Compare commands, exit codes, totals, and assertion identities against the native output. Correct misleading explanations through read-only review. Schema validity and accurate totals do not prove a causal explanation.",
    "Approve only the requested end state. Accurate verification-only reporting can finish with failed checks, which userResponse must disclose. Failed checks do not satisfy an implementation requirement that they pass and do not authorize repair. An unknown or contradictory claim cannot support approval.",
    "Latest Agent B summary, a model claim:",
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
