import { createCodingTools, createReadOnlyTools } from "@earendil-works/pi-coding-agent";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Role } from "../types/role.js";
import { ToolIsolation, runIsolatedTool } from "../security/isolation.js";
import { redactValue } from "../security/redact.js";
import { withSafeMutation, type SafeMutationOptions } from "./with-safe-mutation.js";

export interface CreateRoleToolsOptions extends SafeMutationOptions {
  role: Role;
  isolation?: ToolIsolation;
}

export function createRoleTools(options: CreateRoleToolsOptions): AgentTool<any>[] {
  const tools = options.role === "A" ? createReadOnlyTools(options.cwd) : createCodingTools(options.cwd);
  return tools.map((definition) => {
    const isolated: AgentTool<any> = {
      ...definition,
      execute: async (_id, args, signal, onUpdate) => {
        const isolation = options.isolation ?? new ToolIsolation(options.cwd, options.role);
        try {
          isolation.verify();
          const result = await runIsolatedTool({ isolation, role: options.role, name: definition.name, args: redactValue(args),
            signal, onUpdate: (update) => onUpdate?.(redactValue(update as AgentToolResult<unknown>)) });
          return redactValue(result as AgentToolResult<unknown>);
        } finally { if (!options.isolation) isolation.dispose(); }
      }
    };
    return options.role === "B" && (definition.name === "edit" || definition.name === "write")
      ? withSafeMutation(isolated, options) : isolated;
  });
}
