import { createCodingTools, createReadOnlyTools } from "@earendil-works/pi-coding-agent";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "typebox";
import { parseToolResult, retainShellMetadata } from "./tool-result.js";
import type { Role } from "../types/role.js";
import { ToolIsolation, runIsolatedTool } from "../security/isolation.js";
import { redactValue } from "../security/redact.js";
import { withSafeMutation, type SafeMutationOptions } from "./with-safe-mutation.js";
import { createSkillsTool } from "./skills.js";

export interface CreateRoleToolsOptions extends SafeMutationOptions {
  role: Role;
  isolation?: ToolIsolation;
  skillsDir?: string;
}

export function createRoleTools(options: CreateRoleToolsOptions): AgentTool<TSchema, unknown>[] {
  const tools = options.role === "A" ? createReadOnlyTools(options.cwd) : createCodingTools(options.cwd);
  const definitions: AgentTool<TSchema, unknown>[] = [...tools, ...(options.skillsDir ? [createSkillsTool(options.skillsDir)] : [])];
  return definitions.map((definition) => {
    const isolated: AgentTool<TSchema, unknown> = {
      ...definition,
      execute: async (_id, args, signal, onUpdate) => {
        const isolation = options.isolation ?? new ToolIsolation(options.cwd, options.role, options.skillsDir, "project");
        try {
          isolation.verify();
          const result = await runIsolatedTool({ isolation, role: options.role, name: definition.name, args: redactValue(args), skillsDir: options.skillsDir,
            signal, onUpdate: (update) => onUpdate?.(redactValue(parseToolResult(update))) });
          const parsed = parseToolResult(result);
          return redactValue(definition.name === "bash" ? retainShellMetadata(parsed) : parsed);
        } finally { if (!options.isolation) isolation.dispose(); }
      }
    };
    return options.role === "B" && (definition.name === "edit" || definition.name === "write")
      ? withSafeMutation(isolated, options) : isolated;
  });
}
