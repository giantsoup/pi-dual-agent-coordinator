import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { mcpParameters, assertMcpArguments } from "./schema.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

import { getAllowedToolNames } from "../tools/role-capability-policy.js";
import type { Role } from "../types/role.js";
import { isMcpToolCallAllowed } from "./policy.js";
import type { McpClientPool } from "./client-pool.js";
import type { RoleMcpPolicy } from "./types.js";

export interface DirectToolMetadataSet {
  serverName: string;
  tools: Tool[];
}

export function createDirectToolNamePlan(options: {
  role: Role;
  toolSets: DirectToolMetadataSet[];
}): Map<string, Map<string, string>> {
  const plan = new Map<string, Map<string, string>>();
  const reserved = new Set([...getAllowedToolNames(options.role), "mcp", "codemode", "tool_search"]);
  const occurrences = new Map<string, number>();

  for (const set of options.toolSets) {
    for (const tool of set.tools) {
      occurrences.set(tool.name, (occurrences.get(tool.name) ?? 0) + 1);
    }
  }

  for (const set of options.toolSets) {
    const toolPlan = new Map<string, string>();
    for (const tool of set.tools) {
      const collides = tool.name.startsWith("mcp__") || reserved.has(tool.name) || (occurrences.get(tool.name) ?? 0) > 1;
      toolPlan.set(tool.name, collides ? `${set.serverName}__${tool.name}` : tool.name);
    }
    plan.set(set.serverName, toolPlan);
  }

  const names = new Set(reserved);
  for (const tools of plan.values()) for (const name of tools.values()) {
    if (names.has(name) || name.startsWith("mcp__") || name.includes("*")) throw new Error(`Unsafe or colliding MCP tool name: ${name}`);
    names.add(name);
  }
  return plan;
}

export function buildDirectToolDefinitions(options: {
  role: Role;
  serverName: string;
  tools: Tool[];
  policy: RoleMcpPolicy;
  clientPool: McpClientPool;
  namePlan: Map<string, string>;
}): ToolDefinition[] {
  return options.tools
    .filter((tool) => isMcpToolCallAllowed(options.policy, options.serverName, tool).allowed)
    .map((tool) => {
      const directName = options.namePlan.get(tool.name) ?? tool.name;
      return defineTool({
        name: directName,
        label: tool.annotations?.title ?? tool.title ?? tool.name,
        description:
          tool.description ??
          `Call the ${options.serverName}/${tool.name} MCP tool.`,
        promptSnippet: `Call MCP tool ${options.serverName}/${tool.name}`,
        parameters: mcpParameters(tool.inputSchema),
        async execute(_toolCallId, params, signal) {
          const gate = isMcpToolCallAllowed(options.policy, options.serverName, tool);
          if (!gate.allowed) {
            throw new Error(gate.reason ?? `Tool ${options.serverName}/${tool.name} is blocked.`);
          }

          assertMcpArguments(tool, params);
          const result = await options.clientPool.callTool(
            options.serverName,
            tool.name,
            params,
            signal
          );
          return toPiToolResult(result, {
            server: options.serverName,
            tool: tool.name,
            directToolName: directName
          });
        }
      });
    });
}

export function toPiToolResult(
  result: Record<string, unknown>,
  details: Record<string, unknown>
): AgentToolResult<Record<string, unknown>> {
  const normalized = normalizeToolResult(result);
  return {
    content: [
      {
        type: "text",
        text: renderMcpContent(normalized)
      }
    ],
    details: {
      ...details,
      structuredContent: normalized.structuredContent,
      isError: normalized.isError ?? false
    }
  };
}

export function renderMcpContent(result: {
  content?: Array<Record<string, unknown>>;
  structuredContent?: Record<string, unknown> | undefined;
  isError?: boolean | undefined;
}): string {
  const textSegments = (result.content ?? [])
    .map((item) => {
      if (item.type === "text" && typeof item.text === "string") {
        return item.text;
      }
      return JSON.stringify(item, null, 2);
    })
    .filter((segment) => segment.length > 0);

  const sections = [...textSegments];
  if (result.structuredContent && Object.keys(result.structuredContent).length > 0) {
    sections.push(JSON.stringify(result.structuredContent, null, 2));
  }
  if (sections.length === 0) {
    sections.push("(no content)");
  }
  return sections.join("\n\n");
}

function normalizeToolResult(result: Record<string, unknown>): {
  content?: Array<Record<string, unknown>>;
  structuredContent?: Record<string, unknown> | undefined;
  isError?: boolean | undefined;
} {
  if ("toolResult" in result) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result.toolResult, null, 2)
        }
      ]
    };
  }

  const normalized: {
    content?: Array<Record<string, unknown>>;
    structuredContent?: Record<string, unknown> | undefined;
    isError?: boolean | undefined;
  } = {};

  if (Array.isArray(result.content)) {
    normalized.content = result.content as Array<Record<string, unknown>>;
  }
  if (
    result.structuredContent &&
    typeof result.structuredContent === "object" &&
    !Array.isArray(result.structuredContent)
  ) {
    normalized.structuredContent = result.structuredContent as Record<string, unknown>;
  }
  if (typeof result.isError === "boolean") {
    normalized.isError = result.isError;
  }

  return normalized;
}
