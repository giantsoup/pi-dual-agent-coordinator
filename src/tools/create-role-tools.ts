import {
  createCodingTools,
  createReadOnlyTools
} from "@mariozechner/pi-coding-agent";
import type { AgentTool } from "@mariozechner/pi-agent-core";

import type { Role } from "../types/role.js";
import { roleAllowsMutations } from "./role-capability-policy.js";
import { withSafeMutation, type SafeMutationOptions } from "./with-safe-mutation.js";

export interface CreateRoleToolsOptions extends SafeMutationOptions {
  role: Role;
}

export function createRoleTools(options: CreateRoleToolsOptions): AgentTool<any>[] {
  if (options.role === "A") {
    return createReadOnlyTools(options.cwd);
  }

  return createCodingTools(options.cwd).map((tool) =>
    roleAllowsMutations(options.role) && (tool.name === "edit" || tool.name === "write")
      ? withSafeMutation(tool, options)
      : tool
  );
}
