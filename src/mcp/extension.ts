import type { ExtensionAPI, ExtensionFactory } from "@mariozechner/pi-coding-agent";

import { McpClientPool } from "./client-pool.js";
import {
  buildDirectToolDefinitions,
  createDirectToolNamePlan,
  type DirectToolMetadataSet
} from "./direct-tools.js";
import { createRoleMcpPolicy } from "./policy.js";
import { createMcpProxyTool } from "./proxy-tool.js";
import type {
  ResolvedMcpConfig,
  RoleMcpPolicy,
  RoleMcpStatusSnapshot
} from "./types.js";
import type { Role } from "../types/role.js";

export interface McpExtensionRuntime {
  extensionFactory: ExtensionFactory;
  getStatus(): RoleMcpStatusSnapshot;
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
    dispose: () => controller.dispose()
  };
}

class McpExtensionController {
  private readonly clientPool: McpClientPool;
  private readonly policy: RoleMcpPolicy;
  private readonly directToolNames = new Map<string, Map<string, string>>();

  public constructor(
    private readonly role: Role,
    private readonly config: ResolvedMcpConfig
  ) {
    this.clientPool = new McpClientPool(role, config);
    this.policy = createRoleMcpPolicy(role, config.servers);
  }

  public bind(pi: ExtensionAPI): void {
    pi.registerTool(
      createMcpProxyTool({
        role: this.role,
        clientPool: this.clientPool,
        policy: this.policy,
        getDirectToolName: (serverName, toolName) =>
          this.directToolNames.get(serverName)?.get(toolName)
      })
    );

    pi.on("session_start", async () => {
      await this.clientPool.hydrateFromCache();
      await this.initializeServers(pi);
    });

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

  public getStatus(): RoleMcpStatusSnapshot {
    return this.clientPool.getStatusSnapshot();
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
      this.directToolNames.set(set.serverName, toolNames);
      this.clientPool.setDirectToolNames(set.serverName, [...toolNames.values()]);
      const definitions = buildDirectToolDefinitions({
        role: this.role,
        serverName: set.serverName,
        tools: set.tools,
        policy: this.policy,
        clientPool: this.clientPool,
        namePlan: toolNames
      });
      for (const definition of definitions) {
        pi.registerTool(definition);
      }
    }
  }

  private buildPromptContext(): string | undefined {
    if (this.config.servers.length === 0) {
      return "MCP: enabled, but no servers are configured for this project.";
    }

    const lines = ["MCP Servers:"];
    for (const server of this.config.servers) {
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
