import type { Role } from "../types/role.js";

export const READ_ONLY_TOOL_NAMES = ["read", "bash", "grep", "find", "ls"] as const;
export const MUTATION_TOOL_NAMES = ["edit", "write"] as const;

export function getAllowedToolNames(role: Role): string[] {
  return role === "A"
    ? [...READ_ONLY_TOOL_NAMES]
    : [...READ_ONLY_TOOL_NAMES, ...MUTATION_TOOL_NAMES];
}

export function roleAllowsMutations(role: Role): boolean {
  return role === "B";
}
