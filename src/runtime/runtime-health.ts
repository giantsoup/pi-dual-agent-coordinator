import type { Role } from "../types/role.js";
import type { RoleRuntimeBinding } from "./create-role-runtime.js";

export interface RuntimeHealth {
  role: Role;
  healthy: boolean;
  sessionId: string;
  sessionFile?: string | undefined;
  cwd: string;
}

export function getRuntimeHealth(binding: RoleRuntimeBinding): RuntimeHealth {
  return {
    role: binding.role,
    healthy: Boolean(binding.sessionId),
    sessionId: binding.sessionId,
    sessionFile: binding.sessionFile,
    cwd: binding.cwd
  };
}
