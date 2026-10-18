import { realpathSync } from "node:fs";
import { resolve } from "node:path";

import type { AgentTool } from "@earendil-works/pi-agent-core";

export interface SafeMutationRecord {
  toolName: string;
  canonicalPath: string;
}

export interface SafeMutationOptions {
  cwd: string;
  onMutation?: ((record: SafeMutationRecord) => void) | undefined;
}

type ToolWithPath = AgentTool<any> & {
  execute: (
    toolCallId: string,
    params: any,
    signal?: AbortSignal,
    onUpdate?: (partialResult: unknown) => void
  ) => Promise<unknown>;
};

export function withSafeMutation(
  tool: ToolWithPath,
  options: SafeMutationOptions
): ToolWithPath {
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
  if (!params || typeof params !== "object") {
    return undefined;
  }
  const maybePath = (params as Record<string, unknown>).path;
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
