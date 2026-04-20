import type {
  Prompt,
  Resource,
  ResourceTemplate,
  Tool
} from "@modelcontextprotocol/sdk/types.js";

import type { Role } from "../types/role.js";

export type McpTransportType = "stdio" | "streamable-http" | "sse";
export type McpLifecycleMode = "lazy" | "eager";
export type McpProxyAction =
  | "status"
  | "search_tools"
  | "describe_tool"
  | "call_tool"
  | "list_resources"
  | "read_resource"
  | "list_prompts"
  | "get_prompt"
  | "connect";

export interface McpRoleConfig {
  allowTools?: string[] | undefined;
  excludeTools?: string[] | undefined;
}

export interface McpServerPiDualConfig {
  directTools?: boolean | undefined;
  lifecycle?: McpLifecycleMode | undefined;
  idleTimeoutMinutes?: number | undefined;
  required?: boolean | undefined;
  roles?: Partial<Record<Role, McpRoleConfig>> | undefined;
}

export interface McpServerConfig {
  command?: string | undefined;
  args?: string[] | undefined;
  env?: Record<string, string> | undefined;
  cwd?: string | undefined;
  url?: string | undefined;
  headers?: Record<string, string> | undefined;
  transport?: McpTransportType | "http" | undefined;
  "x-pi-dual"?: McpServerPiDualConfig | undefined;
}

export interface McpConfigFile {
  mcpServers: Record<string, McpServerConfig>;
}

export interface ResolvedMcpServerConfig {
  name: string;
  command?: string | undefined;
  args: string[];
  env?: Record<string, string> | undefined;
  cwd?: string | undefined;
  url?: string | undefined;
  headers?: Record<string, string> | undefined;
  transport: McpTransportType;
  directTools: boolean;
  lifecycle: McpLifecycleMode;
  idleTimeoutMinutes: number;
  required: boolean;
  roleOverrides: Partial<Record<Role, McpRoleConfig>>;
  sourcePaths: string[];
  fingerprint: string;
}

export interface ResolvedMcpConfig {
  enabled: boolean;
  projectRoot: string;
  cacheFile: string;
  configSources: string[];
  servers: ResolvedMcpServerConfig[];
}

export interface McpMetadataSnapshot {
  tools: Tool[];
  resources: Resource[];
  resourceTemplates: ResourceTemplate[];
  prompts: Prompt[];
  instructions?: string | undefined;
}

export interface McpMetadataCacheEntry extends McpMetadataSnapshot {
  serverName: string;
  fingerprint: string;
  updatedAt: string;
}

export interface McpRolePolicyServer {
  allowReadOnlyTools: boolean;
  allowTools: string[];
  excludeTools: string[];
}

export interface RoleMcpPolicy {
  role: Role;
  servers: Record<string, McpRolePolicyServer>;
}

export interface McpServerRuntimeState {
  name: string;
  connected: boolean;
  transport: McpTransportType;
  directTools: string[];
  lastError?: string | undefined;
  lastMetadataSync?: string | undefined;
}

export interface RoleMcpStatusSnapshot {
  role: Role;
  enabled: boolean;
  servers: McpServerRuntimeState[];
}

export interface CoordinatorMcpStatusSnapshot {
  enabled: boolean;
  configSources: string[];
  roleA: RoleMcpStatusSnapshot;
  roleB: RoleMcpStatusSnapshot;
}

export interface McpSearchToolResult {
  server: string;
  name: string;
  canonicalName: string;
  description?: string | undefined;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  directToolName?: string | undefined;
  allowed: boolean;
}
