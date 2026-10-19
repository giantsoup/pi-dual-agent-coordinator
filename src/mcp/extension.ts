import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

import { McpClientPool } from "./client-pool.js";
import {
  buildDirectToolDefinitions,
  createDirectToolNamePlan,
  type DirectToolMetadataSet
} from "./direct-tools.js";
import { createRoleMcpPolicy } from "./policy.js";
import { createMcpProxyTool, discoverMcpTools } from "./proxy-tool.js";
import type {
  ResolvedMcpConfig,
  RoleMcpPolicy,
  RoleMcpStatusSnapshot,
  McpSearchToolResult
} from "./types.js";
import type { Role } from "../types/role.js";

export interface McpExtensionRuntime {
  extensionFactory: ExtensionFactory;
  getStatus(): RoleMcpStatusSnapshot;
  getToolNames(): string[];
  getInventory(signal?: AbortSignal): Promise<{ status: RoleMcpStatusSnapshot; tools: McpSearchToolResult[] }>;
  dispose(): Promise<void>;
}

export function createMcpExtension(options: {
  role: Role;
  config: ResolvedMcpConfig;
}): McpExtensionRuntime | undefined {
  if (!options.config.enabled) {
    return undefined;
  }

  const controller = new McpExtensionController(options.role, options.config);
  return {
    extensionFactory: (pi) => controller.bind(pi),
    getStatus: () => controller.getStatus(),
    getToolNames: () => controller.getToolNames(),
    getInventory: signal => controller.getInventory(signal),
    dispose: () => controller.dispose()
  };
}

class McpExtensionController {
  private readonly clientPool: McpClientPool;
  private readonly policy: RoleMcpPolicy;
  private readonly registeredToolNames = new Set<string>(["mcp"]);
  private readonly directToolNames = new Map<string, Map<string, string>>();

  public constructor(
    private readonly role: Role,
    private readonly config: ResolvedMcpConfig
  ) {
    this.clientPool = new McpClientPool(role, config);
    this.policy = createRoleMcpPolicy(role, config.servers);
  }

  public async bind(pi: ExtensionAPI): Promise<void> {
    this.registeredToolNames.clear();
    this.registeredToolNames.add("mcp");
    pi.registerTool(
      createMcpProxyTool({
        role: this.role,
        clientPool: this.clientPool,
        policy: this.policy,
        getDirectToolName: (serverName, toolName) =>
          this.directToolNames.get(serverName)?.get(toolName)
      })
    );

    await this.clientPool.hydrateFromCache();
    await this.initializeServers(pi);

    pi.on("before_agent_start", async (event) => {
      const summary = this.buildPromptContext();
      if (!summary) {
        return undefined;
      }
      return {
        systemPrompt: `${event.systemPrompt}\n\n${summary}`
      };
    });

    pi.on("session_shutdown", async () => {
      await this.clientPool.closeAll();
    });
  }

  public getToolNames(): string[] {
    return [...this.registeredToolNames];
  }

  public getStatus(): RoleMcpStatusSnapshot {
    return this.clientPool.getStatusSnapshot();
  }

  public async getInventory(signal?: AbortSignal): Promise<{ status: RoleMcpStatusSnapshot; tools: McpSearchToolResult[] }> {
    const tools = await discoverMcpTools({
      role: this.role, clientPool: this.clientPool, policy: this.policy,
      getDirectToolName: (server, tool) => this.directToolNames.get(server)?.get(tool)
    }, { query: "", includeSchema: true }, signal);
    return { status: this.getStatus(), tools };
  }

  public async dispose(): Promise<void> {
    await this.clientPool.closeAll();
  }

  private async initializeServers(pi: ExtensionAPI): Promise<void> {
    const toolSets: DirectToolMetadataSet[] = [];
    this.directToolNames.clear();
    for (const server of this.config.servers) {
      this.clientPool.setDirectToolNames(server.name, []);
    }

    for (const server of this.config.servers) {
      const shouldSync = server.directTools || server.lifecycle === "eager";
      if (!shouldSync) {
        continue;
      }

      try {
        const metadata = await this.clientPool.syncMetadata(server.name);
        if (server.directTools) {
          toolSets.push({
            serverName: server.name,
            tools: metadata.tools
          });
        }
      } catch (error) {
        if (server.required) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to initialize required MCP server ${server.name}: ${message}`);
        }
      }
    }

    const namePlan = createDirectToolNamePlan({
      role: this.role,
      toolSets
    });

    for (const set of toolSets) {
      const toolNames = namePlan.get(set.serverName) ?? new Map<string, string>();
      const definitions = buildDirectToolDefinitions({
        role: this.role,
        serverName: set.serverName,
        tools: set.tools,
        policy: this.policy,
        clientPool: this.clientPool,
        namePlan: toolNames
      });
      const activeNames = new Set(definitions.map(definition => definition.name));
      const activePlan = new Map([...toolNames].filter(([, name]) => activeNames.has(name)));
      this.directToolNames.set(set.serverName, activePlan);
      this.clientPool.setDirectToolNames(set.serverName, [...activePlan.values()]);
      for (const definition of definitions) {
        this.registeredToolNames.add(definition.name);
        pi.registerTool(definition);
      }
    }
  }

  private buildPromptContext(): string | undefined {
    if (this.config.servers.length === 0) {
      return "MCP: enabled, but no servers are configured for this project.";
    }

    const lines = ["MCP Servers:"];
    const status = this.clientPool.getStatusSnapshot();
    for (const server of this.config.servers) {
      const issue = status.servers.find(candidate => candidate.name === server.name)?.lastError;
      if (issue) {
        lines.push(`- ${server.name}: initial discovery failed. Retry with mcp({action:'list_tools',server:'${server.name}'}). ${issue}`);
        continue;
      }
      const directToolNames = [...(this.directToolNames.get(server.name)?.values() ?? [])];
      const directSummary =
        directToolNames.length > 0
          ? `direct tools: ${directToolNames.slice(0, 6).join(", ")}${directToolNames.length > 6 ? ", ..." : ""}`
          : "proxy via `mcp`";
      lines.push(`- ${server.name}: ${directSummary}`);

      const instructions = this.clientPool.getInstructions(server.name);
      if (instructions) {
        lines.push(`  Instructions: ${truncate(instructions, 220)}`);
      }
    }

    return lines.join("\n");
  }
}

function truncate(value: string, maxLength: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}
