import { realpathSync } from "node:fs";
import { resolve } from "node:path";

import type { TSchema } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";

export interface SafeMutationRecord {
  toolName: string;
  canonicalPath: string;
}

export interface SafeMutationOptions {
  cwd: string;
  onMutation?: ((record: SafeMutationRecord) => void) | undefined;
}

export function withSafeMutation<TParameters extends TSchema, TDetails>(
  tool: AgentTool<TParameters, TDetails>,
  options: SafeMutationOptions
): AgentTool<TParameters, TDetails> {
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const pathValue = getPathLikeValue(params);
      if (pathValue) {
        options.onMutation?.({
          toolName: tool.name,
          canonicalPath: canonicalizePath(options.cwd, pathValue)
        });
      }

      return tool.execute(toolCallId, params, signal, onUpdate);
    }
  };
}

function getPathLikeValue(params: unknown): string | undefined {
  if (!params || typeof params !== "object" || !("path" in params)) {
    return undefined;
  }
  const maybePath = params.path;
  return typeof maybePath === "string" ? maybePath : undefined;
}

function canonicalizePath(cwd: string, candidate: string): string {
  const absolute = resolve(cwd, candidate);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}
