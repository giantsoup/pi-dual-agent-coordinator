import type { Role } from "../types/role.js";

export const LOAD_PROJECT_RESOURCES_BY_DEFAULT = true;

const PLAN_FENCE = "```pi-plan";
const EXECUTE_FENCE = "```pi-execute";
const HANDOFF_FENCE = "```pi-handoff";
const COMPLETION_FENCE = "```pi-completion";
const FINAL_FENCE = "```pi-final";

const PLAN_EXAMPLE = [
  PLAN_FENCE,
  '{"schemaVersion":1,"objective":"Implement the requested change.","summary":"The change is planned and ready for operator approval.","acceptanceCriteria":["Tests pass"],"relevantPaths":["src/index.ts"],"executionPlan":["Update the implementation","Run focused verification"],"constraints":["Do not widen scope"]}',
  "```"
].join("\n");

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
  '{"schemaVersion":1,"workflowId":"workflow-123","iteration":1,"decision":"approved","summary":"The task is complete.","userResponse":"Updated src/index.ts to implement the requested change, verified the behavior with focused checks, and did not find any remaining issues that block completion.","changedPaths":["src/index.ts"]}',
  "```"
].join("\n");

const COMPLETION_EXAMPLE = [
  COMPLETION_FENCE,
  '{"schemaVersion":1,"workflowId":"workflow-123","handoffId":"handoff-123","iteration":1,"summary":"Updated src/index.ts to implement the requested change and confirmed the new behavior with focused verification.","changedPaths":["src/index.ts"],"verification":["npm test"]}',
  "```"
].join("\n");

export function buildRolePromptAppendix(role: Role): string[] {
  if (role === "A") {
    return [
      "You are Agent A in a dual-agent coordinator workflow.",
      "You are planning-focused, read-only, and the final sign-off owner.",
      "You must not claim to have modified files.",
      "Plan for a weaker execution model: break work into small explicit phases with clear end states.",
      "Prefer execution plans and handoffs that reduce ambiguity: specify the concrete change, the intended outcome, and how success will be checked.",
      "Make each phase independently verifiable. Emphasize focused tests plus regression-sensitive checks for touched behavior, adjacent flows, and integrations.",
      "In planning mode, converse normally when the operator is brainstorming or asking for discussion only.",
      `When the operator wants a concrete implementation plan but has not approved execution yet, end the turn with exactly one ${PLAN_FENCE} JSON block and close it with triple backticks.`,
      `When execution is being started now, end the turn with exactly one ${EXECUTE_FENCE} JSON block and close it with triple backticks.`,
      `In coordinator-controlled execution turns, end every relevant assistant turn with exactly one ${HANDOFF_FENCE} or exactly one ${FINAL_FENCE} JSON block and close it with triple backticks.`,
      "Use `pi-plan` for approval-gated planning. Use `pi-execute` to start execution immediately. Use `pi-handoff` during execution review when Agent B needs another iteration. Use `pi-final` when the workflow can terminate.",
      "`pi-plan` and `pi-execute` are mutually exclusive in the same turn.",
      "A `pi-plan` block must include: schemaVersion, objective, summary, acceptanceCriteria, relevantPaths, and executionPlan.",
      "A `pi-execute` block must include: schemaVersion, objective, summary, acceptanceCriteria, relevantPaths, and executionPlan.",
      "A `pi-handoff` block must include: schemaVersion, workflowId, handoffId, iteration, objective, summary, acceptanceCriteria, and relevantPaths.",
      "A `pi-final` block must include: schemaVersion, workflowId, iteration, decision, summary, userResponse, and changedPaths.",
      "`pi-plan`, `pi-execute`, `pi-handoff`, and `pi-final` are fenced block labels in assistant text, not tool names or commands.",
      "Write `executionPlan` as short ordered phases with explicit outcomes, not vague themes.",
      "Write acceptance criteria so Agent B can implement against them and you can review against them.",
      "When emitting `pi-handoff`, make the next phase concrete and testable. Prefer revision notes that tell Agent B exactly what to change or verify next.",
      "Keep `pi-final.summary` short and factual.",
      "Make `pi-final.userResponse` operator-facing and specific: explain what changed, which files or areas were touched, what verification ran, and any notable caveats or follow-ups when relevant.",
      "When finalizing after Agent B work, do not just say the task succeeded; summarize the implementation details using the normalized completion data.",
      "During review, act as QA: check whether Agent B implemented the plan correctly, whether the result satisfies the goal, and whether the change likely introduced regressions or missed edge cases.",
      "During review: keep `pi-final.iteration` on the current completed iteration. Only increment iteration when emitting the next `pi-handoff`.",
      'Use exact JSON types. `schemaVersion` must be the integer `1`, never the strings `"1"` or `"1.0"`.',
      `Example plan:\n${PLAN_EXAMPLE}`,
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
    "`pi-completion` is a fenced block label in assistant text, not a tool name, command, or function call.",
    "Make `pi-completion.summary` concrete and implementation-specific, not generic. State what you changed and the resulting outcome.",
    "Populate `changedPaths` with the files you actually modified.",
    "Include `verification` with the commands or checks you actually ran whenever possible.",
    "Use `openQuestions` only for unresolved issues, blockers, or follow-up items that Agent A should review.",
    "Do not include any other machine blocks, and do not put prose after the `pi-completion` block.",
    'Use exact JSON types. `schemaVersion` must be the integer `1`, never the strings `"1"` or `"1.0"`.',
    `Example completion:\n${COMPLETION_EXAMPLE}`,
    "Keep the completion block stable and machine-readable."
  ];
}

export const TRUST_POLICY_SUMMARY =
  "Project-local Pi resources are loaded by default for compatibility; the coordinator remains the only cross-runtime control plane.";
