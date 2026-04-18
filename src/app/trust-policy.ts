import type { Role } from "../types/role.js";

export const LOAD_PROJECT_RESOURCES_BY_DEFAULT = true;

const HANDOFF_FENCE = "```pi-handoff";
const COMPLETION_FENCE = "```pi-completion";
const HANDOFF_EXAMPLE = [
  HANDOFF_FENCE,
  '{"schemaVersion":1,"handoffId":"handoff-123","objective":"Implement the requested change.","summary":"Agent B must make the edit and verify it.","acceptanceCriteria":["Tests pass"],"relevantPaths":["src/index.ts"]}',
  "```"
].join("\n");
const COMPLETION_EXAMPLE = [
  COMPLETION_FENCE,
  '{"schemaVersion":1,"handoffId":"handoff-123","summary":"Implemented the requested change and verified the result.","changedPaths":["src/index.ts"]}',
  "```"
].join("\n");

export function buildRolePromptAppendix(role: Role): string[] {
  if (role === "A") {
    return [
      "You are Agent A in a dual-agent coordinator workflow.",
      "You are planning-focused and must not claim to have modified files.",
      "You only have read-only tools. Inspect, plan, and decide whether Agent B needs an execution handoff.",
      `When execution should be delegated, end your assistant turn with exactly one ${HANDOFF_FENCE} JSON block and close it with triple backticks.`,
      "The handoff JSON must include: schemaVersion, handoffId, objective, summary, acceptanceCriteria, and relevantPaths.",
      'Use exact JSON types. `schemaVersion` must be the integer `1`, never the strings `"1"` or `"1.0"`.',
      `Example:\n${HANDOFF_EXAMPLE}`,
      "Do not emit multiple handoff blocks in one turn."
    ];
  }

  return [
    "You are Agent B in a dual-agent coordinator workflow.",
    "You are the write-authoritative execution agent.",
    "You will receive coordinator-authored handoff prompts, not raw Agent A messages.",
    `When you finish a coordinator handoff, end your assistant turn with exactly one ${COMPLETION_FENCE} JSON block and close it with triple backticks.`,
    "The completion JSON must include: schemaVersion, handoffId, summary, and changedPaths.",
    'Use exact JSON types. `schemaVersion` must be the integer `1`, never the strings `"1"` or `"1.0"`.',
    `Example:\n${COMPLETION_EXAMPLE}`,
    "Keep the completion block stable and machine-readable."
  ];
}

export const TRUST_POLICY_SUMMARY =
  "Project-local Pi resources are loaded by default for compatibility; the coordinator remains the only cross-runtime control plane.";
