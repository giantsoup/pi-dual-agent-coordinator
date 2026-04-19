import type { Role } from "../types/role.js";

export const LOAD_PROJECT_RESOURCES_BY_DEFAULT = true;

const EXECUTE_FENCE = "```pi-execute";
const HANDOFF_FENCE = "```pi-handoff";
const COMPLETION_FENCE = "```pi-completion";
const FINAL_FENCE = "```pi-final";

const EXECUTE_EXAMPLE = [
  EXECUTE_FENCE,
  '{"schemaVersion":1,"objective":"Implement the requested change.","summary":"The change is ready for execution.","acceptanceCriteria":["Tests pass"],"relevantPaths":["src/index.ts"],"executionPlan":["Update the implementation","Run focused verification"],"constraints":["Do not widen scope"]}',
  "```"
].join("\n");

const HANDOFF_EXAMPLE = [
  HANDOFF_FENCE,
  '{"schemaVersion":1,"workflowId":"workflow-123","handoffId":"handoff-123","iteration":1,"objective":"Implement the requested change.","summary":"Agent B must edit the files and verify the result.","acceptanceCriteria":["Tests pass"],"relevantPaths":["src/index.ts"],"reviewNotes":["Fix the failing edge case."]}',
  "```"
].join("\n");

const FINAL_EXAMPLE = [
  FINAL_FENCE,
  '{"schemaVersion":1,"workflowId":"workflow-123","iteration":1,"decision":"approved","summary":"The task is complete.","userResponse":"Implemented the requested change and verified it.","changedPaths":["src/index.ts"]}',
  "```"
].join("\n");

const COMPLETION_EXAMPLE = [
  COMPLETION_FENCE,
  '{"schemaVersion":1,"workflowId":"workflow-123","handoffId":"handoff-123","iteration":1,"summary":"Implemented the requested change and verified the result.","changedPaths":["src/index.ts"],"verification":["npm test"]}',
  "```"
].join("\n");

export function buildRolePromptAppendix(role: Role): string[] {
  if (role === "A") {
    return [
      "You are Agent A in a dual-agent coordinator workflow.",
      "You are planning-focused, read-only, and the final sign-off owner.",
      "You must not claim to have modified files.",
      "In planning mode, converse normally and emit no machine block unless execution is being started now.",
      `When execution is being started now, end the turn with exactly one ${EXECUTE_FENCE} JSON block and close it with triple backticks.`,
      `In coordinator-controlled execution turns, end every relevant assistant turn with exactly one ${HANDOFF_FENCE} or exactly one ${FINAL_FENCE} JSON block and close it with triple backticks.`,
      "Use `pi-execute` to start execution. Use `pi-handoff` during execution review when Agent B needs another iteration. Use `pi-final` when the workflow can terminate.",
      "A `pi-execute` block must include: schemaVersion, objective, summary, acceptanceCriteria, relevantPaths, and executionPlan.",
      "A `pi-handoff` block must include: schemaVersion, workflowId, handoffId, iteration, objective, summary, acceptanceCriteria, and relevantPaths.",
      "A `pi-final` block must include: schemaVersion, workflowId, iteration, decision, summary, userResponse, and changedPaths.",
      "During review: keep `pi-final.iteration` on the current completed iteration. Only increment iteration when emitting the next `pi-handoff`.",
      'Use exact JSON types. `schemaVersion` must be the integer `1`, never the strings `"1"` or `"1.0"`.',
      `Example execute:\n${EXECUTE_EXAMPLE}`,
      `Example handoff:\n${HANDOFF_EXAMPLE}`,
      `Example final:\n${FINAL_EXAMPLE}`,
      "Do not emit multiple machine blocks in one turn."
    ];
  }

  return [
    "You are Agent B in a dual-agent coordinator workflow.",
    "You are the write-authoritative execution agent.",
    "You will receive coordinator-authored handoff prompts, not raw Agent A messages.",
    `End every coordinator handoff turn with exactly one ${COMPLETION_FENCE} JSON block and close it with triple backticks.`,
    "A `pi-completion` block must include: schemaVersion, workflowId, handoffId, iteration, summary, and changedPaths.",
    'Use exact JSON types. `schemaVersion` must be the integer `1`, never the strings `"1"` or `"1.0"`.',
    `Example completion:\n${COMPLETION_EXAMPLE}`,
    "Keep the completion block stable and machine-readable."
  ];
}

export const TRUST_POLICY_SUMMARY =
  "Project-local Pi resources are loaded by default for compatibility; the coordinator remains the only cross-runtime control plane.";
