import type { Tool } from "@modelcontextprotocol/sdk/types.js";

import type { Role } from "../types/role.js";
import type {
  ResolvedMcpServerConfig,
  RoleMcpPolicy,
  McpRolePolicyServer
} from "./types.js";

const DEFAULT_AGENT_A_ALLOWLIST = {
  "laravel-boost": [
    "search-docs",
    "database-schema",
    "browser-logs",
    "get-absolute-url"
  ]
} as const;

export function createRoleMcpPolicy(
  role: Role,
  servers: readonly ResolvedMcpServerConfig[]
): RoleMcpPolicy {
  const policyServers: Record<string, McpRolePolicyServer> = {};

  for (const server of servers) {
    const override = server.roleOverrides[role];
    const defaultAllowTools =
      role === "A" ? [...(DEFAULT_AGENT_A_ALLOWLIST[server.name as keyof typeof DEFAULT_AGENT_A_ALLOWLIST] ?? [])] : [];
    policyServers[server.name] = {
      allowReadOnlyTools: role === "A",
      allowTools: uniqueStrings([...defaultAllowTools, ...(override?.allowTools ?? [])]),
      excludeTools: uniqueStrings(override?.excludeTools ?? [])
    };
  }

  return {
    role,
    servers: policyServers
  };
}

export function isMcpToolCallAllowed(
  policy: RoleMcpPolicy,
  serverName: string,
  tool: Tool
): { allowed: boolean; reason?: string | undefined } {
  const serverPolicy = policy.servers[serverName];
  if (!serverPolicy) {
    return { allowed: false, reason: `No MCP policy configured for server ${serverName}.` };
  }

  if (matchesTool(serverPolicy.excludeTools, serverName, tool.name)) {
    return {
      allowed: false,
      reason: `Tool ${serverName}/${tool.name} is excluded for role ${policy.role}.`
    };
  }

  if (policy.role === "B") {
    return { allowed: true };
  }

  if (tool.annotations?.destructiveHint === true) {
    return {
      allowed: false,
      reason: `Tool ${serverName}/${tool.name} is marked destructive and is blocked for role A.`
    };
  }

  if (tool.annotations?.readOnlyHint === true) {
    return { allowed: true };
  }

  if (matchesTool(serverPolicy.allowTools, serverName, tool.name)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `Tool ${serverName}/${tool.name} is not allowlisted for role A and is not marked read-only.`
  };
}

function matchesTool(allowlist: readonly string[], serverName: string, toolName: string): boolean {
  return allowlist.includes(toolName) || allowlist.includes(`${serverName}/${toolName}`);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
