import type { HandoffEnvelope } from "../types/handoff.js";

export function renderHandoffMessage(envelope: HandoffEnvelope): string {
  const acceptanceCriteria = envelope.acceptanceCriteria
    .map((criterion, index) => `${index + 1}. ${criterion}`)
    .join("\n");
  const relevantPaths = envelope.relevantPaths.map((item) => `- ${item}`).join("\n");
  const constraints =
    envelope.constraints && envelope.constraints.length > 0
      ? `\nConstraints:\n${envelope.constraints.map((item) => `- ${item}`).join("\n")}`
      : "";

  return [
    "Coordinator handoff for Agent B.",
    `Handoff ID: ${envelope.handoffId}`,
    `Objective: ${envelope.objective}`,
    `Summary: ${envelope.summary}`,
    "Acceptance criteria:",
    acceptanceCriteria,
    "Relevant paths:",
    relevantPaths,
    constraints,
    "Execute the work and finish your stable turn with one ```pi-completion JSON block."
  ]
    .filter(Boolean)
    .join("\n");
}
