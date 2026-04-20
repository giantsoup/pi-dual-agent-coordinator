import { Type } from "@sinclair/typebox";
import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

import type { Role } from "../types/role.js";
import type { McpClientPool } from "./client-pool.js";
import { renderMcpContent, toPiToolResult } from "./direct-tools.js";
import { isMcpToolCallAllowed } from "./policy.js";
import type {
  McpProxyAction,
  McpSearchToolResult,
  RoleMcpPolicy
} from "./types.js";

interface CreateMcpProxyToolOptions {
  role: Role;
  clientPool: McpClientPool;
  policy: RoleMcpPolicy;
  getDirectToolName(serverName: string, toolName: string): string | undefined;
}

export function createMcpProxyTool(
  options: CreateMcpProxyToolOptions
): ToolDefinition {
  return defineTool({
    name: "mcp",
    label: "MCP",
    description: "Search, inspect, connect to, and invoke MCP tools, resources, and prompts by server.",
    promptSnippet: "Search, inspect, connect to, and invoke MCP tools/resources/prompts by server.",
    promptGuidelines: [
      "Use direct MCP tools when they are available by name.",
      "Otherwise use `mcp` with `search_tools`, then `describe_tool` or `call_tool`.",
      "Use canonical proxy identifiers in the form `server/tool`."
    ],
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("status"),
        Type.Literal("search_tools"),
        Type.Literal("describe_tool"),
        Type.Literal("call_tool"),
        Type.Literal("list_resources"),
        Type.Literal("read_resource"),
        Type.Literal("list_prompts"),
        Type.Literal("get_prompt"),
        Type.Literal("connect")
      ]),
      server: Type.Optional(Type.String()),
      tool: Type.Optional(Type.String()),
      query: Type.Optional(Type.String()),
      uri: Type.Optional(Type.String()),
      prompt: Type.Optional(Type.String()),
      arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      cursor: Type.Optional(Type.String())
    }),
    async execute(_toolCallId, params) {
      switch (params.action as McpProxyAction) {
        case "status":
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  params.server
                    ? options.clientPool.getStatusSnapshot().servers.find((server) => server.name === params.server) ?? null
                    : options.clientPool.getStatusSnapshot(),
                  null,
                  2
                )
              }
            ],
            details: {
              action: "status"
            }
          };
        case "search_tools": {
          const query = params.query?.trim() ?? "";
          let candidates = options.clientPool.getKnownTools(params.server);
          if (candidates.length === 0) {
            if (params.server) {
              await options.clientPool.ensureMetadata(params.server);
            } else {
              await Promise.all(
                Object.keys(options.policy.servers).map((serverName) =>
                  options.clientPool.ensureMetadata(serverName).catch(() => undefined)
                )
              );
            }
            candidates = options.clientPool.getKnownTools(params.server);
          }
          const results = searchTools(query, candidates, options.policy, options.getDirectToolName);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(results, null, 2)
              }
            ],
            details: {
              action: "search_tools",
              results
            }
          };
        }
        case "describe_tool": {
          const target = resolveToolTarget(params.tool, params.server);
          let tool = findKnownTool(options.clientPool.getKnownTools(target.serverName), target.toolName);
          if (!tool) {
            const metadata = await options.clientPool.ensureMetadata(target.serverName);
            tool = metadata.tools.find((candidate) => candidate.name === target.toolName);
          }
          if (!tool) {
            throw new Error(`Unknown MCP tool: ${target.serverName}/${target.toolName}`);
          }
          const gate = isMcpToolCallAllowed(options.policy, target.serverName, tool);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    server: target.serverName,
                    name: tool.name,
                    canonicalName: `${target.serverName}/${tool.name}`,
                    description: tool.description,
                    annotations: tool.annotations,
                    inputSchema: tool.inputSchema,
                    directToolName: options.getDirectToolName(target.serverName, tool.name),
                    allowed: gate.allowed,
                    blockedReason: gate.reason
                  },
                  null,
                  2
                )
              }
            ],
            details: {
              action: "describe_tool",
              server: target.serverName,
              tool: tool.name,
              allowed: gate.allowed
            }
          };
        }
        case "call_tool": {
          const target = resolveToolTarget(params.tool, params.server);
          let tool = findKnownTool(options.clientPool.getKnownTools(target.serverName), target.toolName);
          if (!tool) {
            const metadata = await options.clientPool.ensureMetadata(target.serverName);
            tool = metadata.tools.find((candidate) => candidate.name === target.toolName);
          }
          if (!tool) {
            throw new Error(`Unknown MCP tool: ${target.serverName}/${target.toolName}`);
          }
          const gate = isMcpToolCallAllowed(options.policy, target.serverName, tool);
          if (!gate.allowed) {
            throw new Error(gate.reason ?? `Tool ${target.serverName}/${target.toolName} is blocked.`);
          }
          const result = await options.clientPool.callTool(
            target.serverName,
            target.toolName,
            params.arguments
          );
          return toPiToolResult(result, {
            action: "call_tool",
            server: target.serverName,
            tool: target.toolName
          });
        }
        case "list_resources": {
          const serverName = requireServer(params.server);
          const result = await options.clientPool.listResources(serverName, params.cursor);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2)
              }
            ],
            details: {
              action: "list_resources",
              server: serverName,
              ...result
            }
          };
        }
        case "read_resource": {
          const serverName = requireServer(params.server);
          if (!params.uri) {
            throw new Error("`uri` is required for mcp read_resource.");
          }
          const result = await options.clientPool.readResource(serverName, params.uri);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2)
              }
            ],
            details: {
              action: "read_resource",
              server: serverName,
              uri: params.uri,
              contents: result.contents
            }
          };
        }
        case "list_prompts": {
          const serverName = requireServer(params.server);
          const result = await options.clientPool.listPrompts(serverName, params.cursor);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2)
              }
            ],
            details: {
              action: "list_prompts",
              server: serverName,
              prompts: result.prompts
            }
          };
        }
        case "get_prompt": {
          const target = resolvePromptTarget(params.prompt, params.server);
          const args = convertPromptArguments(params.arguments);
          const result = await options.clientPool.getPrompt(target.serverName, target.promptName, args);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2)
              }
            ],
            details: {
              action: "get_prompt",
              server: target.serverName,
              prompt: target.promptName
            }
          };
        }
        case "connect": {
          const serverName = requireServer(params.server);
          const metadata = await options.clientPool.syncMetadata(serverName);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    server: serverName,
                    connected: true,
                    tools: metadata.tools.map((tool) => tool.name),
                    prompts: metadata.prompts.map((prompt) => prompt.name),
                    resources: metadata.resources.map((resource) => resource.uri)
                  },
                  null,
                  2
                )
              }
            ],
            details: {
              action: "connect",
              server: serverName
            }
          };
        }
      }
    }
  });
}

function searchTools(
  query: string,
  candidates: Array<{ serverName: string; tool: Tool }>,
  policy: RoleMcpPolicy,
  getDirectToolName: (serverName: string, toolName: string) => string | undefined
): McpSearchToolResult[] {
  const lowered = query.toLowerCase();
  return candidates
    .map(({ serverName, tool }) => {
      const haystack = `${tool.name} ${tool.description ?? ""}`.toLowerCase();
      const score =
        lowered.length === 0
          ? 1
          : tool.name === query
            ? 100
            : tool.name.toLowerCase().includes(lowered)
              ? 50
              : haystack.includes(lowered)
                ? 10
                : 0;
      return {
        score,
        item: {
          server: serverName,
          name: tool.name,
          canonicalName: `${serverName}/${tool.name}`,
          description: tool.description,
          readOnlyHint: tool.annotations?.readOnlyHint === true,
          destructiveHint: tool.annotations?.destructiveHint === true,
          directToolName: getDirectToolName(serverName, tool.name),
          allowed: isMcpToolCallAllowed(policy, serverName, tool).allowed
        }
      };
    })
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || left.item.canonicalName.localeCompare(right.item.canonicalName))
    .map((result) => result.item);
}

function findKnownTool(
  candidates: Array<{ serverName: string; tool: Tool }>,
  toolName: string
): Tool | undefined {
  return candidates.find((candidate) => candidate.tool.name === toolName)?.tool;
}

function resolveToolTarget(
  tool: string | undefined,
  server: string | undefined
): { serverName: string; toolName: string } {
  if (!tool) {
    throw new Error("`tool` is required for MCP tool operations.");
  }
  const [canonicalServer, canonicalTool] = tool.split("/", 2);
  if (canonicalServer && canonicalTool) {
    return {
      serverName: canonicalServer,
      toolName: canonicalTool
    };
  }
  if (!server) {
    throw new Error("`server` is required when `tool` is not in `server/tool` form.");
  }
  return {
    serverName: server,
    toolName: tool
  };
}

function resolvePromptTarget(
  prompt: string | undefined,
  server: string | undefined
): { serverName: string; promptName: string } {
  if (!prompt) {
    throw new Error("`prompt` is required for mcp get_prompt.");
  }
  const [canonicalServer, canonicalPrompt] = prompt.split("/", 2);
  if (canonicalServer && canonicalPrompt) {
    return {
      serverName: canonicalServer,
      promptName: canonicalPrompt
    };
  }
  if (!server) {
    throw new Error("`server` is required when `prompt` is not in `server/prompt` form.");
  }
  return {
    serverName: server,
    promptName: prompt
  };
}

function requireServer(server: string | undefined): string {
  if (!server) {
    throw new Error("`server` is required for this MCP action.");
  }
  return server;
}

function convertPromptArguments(
  args: Record<string, unknown> | undefined
): Record<string, string> | undefined {
  if (!args) {
    return undefined;
  }
  const converted: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    converted[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return converted;
}
