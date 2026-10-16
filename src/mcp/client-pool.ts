import { ToolIsolation } from "../security/isolation.js";
import { redactText, redactValue } from "../security/redact.js";
import { realpathSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  type StdioServerParameters
} from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  ListRootsRequestSchema,
  McpError,
  type Tool
} from "@modelcontextprotocol/sdk/types.js";

import { McpCacheStore } from "./cache-store.js";
import type {
  McpMetadataCacheEntry,
  McpMetadataSnapshot,
  McpServerRuntimeState,
  McpTransportType,
  ResolvedMcpConfig,
  ResolvedMcpServerConfig,
  RoleMcpStatusSnapshot
} from "./types.js";
import type { Role } from "../types/role.js";

interface PoolEntry {
  config: ResolvedMcpServerConfig;
  state: McpServerRuntimeState;
  client?: Client | undefined;
  transport?:
    | StdioClientTransport
    | StreamableHTTPClientTransport
    | SSEClientTransport
    | undefined;
  connectionPromise?: Promise<Client> | undefined;
  idleTimer?: NodeJS.Timeout | undefined;
  stderrChunks: string[];
  metadata?: McpMetadataSnapshot | undefined;
}

const CLIENT_INFO = {
  name: "pi-dual-agent-coordinator",
  version: "0.1.0"
} as const;

export class McpClientPool {
  private readonly cacheStore: McpCacheStore;
  private isolation: ToolIsolation | undefined;
  private readonly entries = new Map<string, PoolEntry>();

  public constructor(
    private readonly role: Role,
    private readonly resolvedConfig: ResolvedMcpConfig
  ) {
    this.cacheStore = new McpCacheStore(resolvedConfig.cacheFile);

    for (const server of resolvedConfig.servers) {
      this.entries.set(server.name, {
        config: server,
        state: {
          name: server.name,
          connected: false,
          transport: server.transport,
          directTools: []
        },
        stderrChunks: []
      });
    }
  }

  public async hydrateFromCache(): Promise<void> {
    await Promise.all([...this.entries.values()].map((entry) => this.loadCachedMetadata(entry)));
  }

  public getServerConfig(serverName: string): ResolvedMcpServerConfig {
    const entry = this.entries.get(serverName);
    if (!entry) {
      throw new Error(`Unknown MCP server: ${serverName}`);
    }
    return entry.config;
  }

  public getKnownTools(serverName?: string): Array<{ serverName: string; tool: Tool }> {
    const candidates = serverName ? [this.requireEntry(serverName)] : [...this.entries.values()];
    const tools: Array<{ serverName: string; tool: Tool }> = [];

    for (const entry of candidates) {
      for (const tool of entry.metadata?.tools ?? []) {
        tools.push({ serverName: entry.config.name, tool });
      }
    }

    return tools;
  }

  public getKnownMetadata(serverName: string): McpMetadataSnapshot | undefined {
    return this.entries.get(serverName)?.metadata;
  }

  public async ensureMetadata(serverName: string): Promise<McpMetadataSnapshot> {
    const known = this.getKnownMetadata(serverName);
    if (known) {
      return known;
    }
    return this.syncMetadata(serverName);
  }

  public setDirectToolNames(serverName: string, toolNames: string[]): void {
    this.requireEntry(serverName).state.directTools = [...toolNames];
  }

  public getInstructions(serverName: string): string | undefined {
    return this.entries.get(serverName)?.metadata?.instructions;
  }

  public async connect(serverName: string): Promise<Client> {
    const entry = this.requireEntry(serverName);
    return this.ensureConnected(entry);
  }

  public async syncMetadata(serverName: string): Promise<McpMetadataSnapshot> {
    const entry = this.requireEntry(serverName);
    const client = await this.ensureConnected(entry);
    try {
      const capabilities = client.getServerCapabilities();
      const [toolsResult, resourcesResult, resourceTemplatesResult, promptsResult] =
        await Promise.all([
          client.listTools(),
          capabilities?.resources ? client.listResources() : Promise.resolve({ resources: [] }),
          capabilities?.resources
            ? this.tryListResourceTemplates(client)
            : Promise.resolve({ resourceTemplates: [] }),
          capabilities?.prompts ? client.listPrompts() : Promise.resolve({ prompts: [] })
        ]);

      const snapshot: McpMetadataSnapshot = {
        tools: toolsResult.tools,
        resources: resourcesResult.resources,
        resourceTemplates: resourceTemplatesResult.resourceTemplates,
        prompts: promptsResult.prompts,
        instructions: client.getInstructions()
      };

      entry.metadata = redactValue(snapshot);
      entry.state.lastMetadataSync = new Date().toISOString();
      entry.state.lastError = undefined;

      const cacheEntry: McpMetadataCacheEntry = {
        serverName: entry.config.name,
        fingerprint: entry.config.fingerprint,
        updatedAt: entry.state.lastMetadataSync,
        ...redactValue(snapshot)
      };
      await this.cacheStore.set(cacheEntry);
      this.scheduleIdleDisconnect(entry);
      return snapshot;
    } catch (error) {
      this.recordError(entry, error);
      throw error;
    }
  }

  public async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown> | undefined,
    signal?: AbortSignal
  ) {
    const client = await this.ensureConnected(this.requireEntry(serverName));
    signal?.throwIfAborted();
    const result = await client.callTool({
      name: toolName,
      arguments: redactValue(args)
    }, undefined, { ...(signal ? { signal } : {}) });
    this.scheduleIdleDisconnect(this.requireEntry(serverName));
    return redactValue(result);
  }

  public async listResources(serverName: string, cursor?: string | undefined) {
    const client = await this.ensureConnected(this.requireEntry(serverName));
    const result = await client.listResources(cursor ? { cursor } : undefined);
    const templates =
      cursor
        ? undefined
        : await this.tryListResourceTemplates(client);
    this.scheduleIdleDisconnect(this.requireEntry(serverName));
    return {
      resources: result.resources,
      resourceTemplates: templates?.resourceTemplates ?? [],
      nextCursor: result.nextCursor
    };
  }

  public async readResource(serverName: string, uri: string) {
    const client = await this.ensureConnected(this.requireEntry(serverName));
    const result = await client.readResource({ uri });
    this.scheduleIdleDisconnect(this.requireEntry(serverName));
    return result;
  }

  public async listPrompts(serverName: string, cursor?: string | undefined) {
    const client = await this.ensureConnected(this.requireEntry(serverName));
    const result = await client.listPrompts(cursor ? { cursor } : undefined);
    this.scheduleIdleDisconnect(this.requireEntry(serverName));
    return result;
  }

  public async getPrompt(
    serverName: string,
    name: string,
    args: Record<string, string> | undefined
  ) {
    const client = await this.ensureConnected(this.requireEntry(serverName));
    const result = await client.getPrompt({
      name,
      arguments: redactValue(args)
    });
    this.scheduleIdleDisconnect(this.requireEntry(serverName));
    return result;
  }

  public async closeAll(): Promise<void> {
    await Promise.all([...this.entries.values()].map((entry) => this.closeEntry(entry)));
    this.isolation?.dispose();
    this.isolation = undefined;
  }

  public getStatusSnapshot(): RoleMcpStatusSnapshot {
    return {
      role: this.role,
      enabled: this.resolvedConfig.enabled,
      servers: [...this.entries.values()]
        .map((entry) => ({ ...entry.state, directTools: [...entry.state.directTools] }))
        .sort((left, right) => left.name.localeCompare(right.name))
    };
  }

  private async ensureConnected(entry: PoolEntry): Promise<Client> {
    if (entry.client) {
      this.scheduleIdleDisconnect(entry);
      return entry.client;
    }
    if (entry.connectionPromise) {
      return entry.connectionPromise;
    }

    entry.connectionPromise = this.openClient(entry)
      .then((client) => {
        entry.client = client;
        entry.state.connected = true;
        entry.state.lastError = undefined;
        this.scheduleIdleDisconnect(entry);
        return client;
      })
      .catch((error) => {
        this.recordError(entry, error);
        throw error;
      })
      .finally(() => {
        entry.connectionPromise = undefined;
      });

    return entry.connectionPromise;
  }

  private async openClient(entry: PoolEntry): Promise<Client> {
    const client = new Client(CLIENT_INFO, {
      capabilities: {
        roots: {
          listChanged: false
        }
      }
    });

    client.setRequestHandler(ListRootsRequestSchema, async () => ({
      roots: [
        {
          uri: pathToFileURL(this.resolvedConfig.projectRoot).toString(),
          name: basename(this.resolvedConfig.projectRoot)
        }
      ]
    }));

    const connection = await this.openTransport(entry, client);
    entry.transport = connection.transport;
    entry.state.transport = connection.transportType;
    connection.transport.onclose = () => {
      entry.state.connected = false;
      entry.client = undefined;
      entry.transport = undefined;
    };
    return client;
  }

  private async openTransport(
    entry: PoolEntry,
    client: Client
  ): Promise<{
    transport:
      | StdioClientTransport
      | StreamableHTTPClientTransport
      | SSEClientTransport;
    transportType: McpTransportType;
  }> {
    if (entry.config.transport === "stdio") {
      const transport = new StdioClientTransport(this.buildStdioParams(entry.config));
      this.attachStdioStderr(entry, transport);
      await client.connect(transport);
      return {
        transport,
        transportType: "stdio"
      };
    }

    throw new Error("Secure MCP currently supports sandboxed stdio servers only. HTTP/SSE peers cannot be verified as isolated; no unsandboxed fallback is available.");

  }

  private buildStdioParams(config: ResolvedMcpServerConfig): StdioServerParameters {
    this.isolation ??= new ToolIsolation(this.resolvedConfig.projectRoot, this.role);
    this.isolation.verify();
    const allowed = new Set(["PATH", "LANG", "LC_ALL", "TZ"]);
    for (const name of Object.keys(config.env ?? {})) {
      if (!allowed.has(name)) throw new Error("MCP environment contains a non-allowlisted variable. Secure mode accepts PATH, LANG, LC_ALL, and TZ only.");
    }
    if (config.cwd && realpathSync(config.cwd) !== this.isolation.cwd) {
      throw new Error("Secure MCP launch must use the project workspace as cwd.");
    }
    const launch = this.isolation.command(config.command ?? "", config.args);
    const env = { ...launch.env, ...config.env };
    return {
      command: launch.command,
      args: [...launch.args.slice(0, 2), "/usr/bin/env", "-i", ...Object.entries(env).map(([key, value]) => `${key}=${value}`), ...launch.args.slice(2)],
      env: launch.env,
      cwd: launch.cwd,
      stderr: "pipe"
    };
  }

  private attachStdioStderr(entry: PoolEntry, transport: StdioClientTransport): void {
    const stderr = transport.stderr;
    if (!stderr) {
      return;
    }
    stderr.on("data", (chunk) => {
      entry.stderrChunks.push(redactText(String(chunk)));
      if (entry.stderrChunks.length > 20) {
        entry.stderrChunks.shift();
      }
    });
  }

  private async tryListResourceTemplates(client: Client): Promise<{ resourceTemplates: [] | Array<{ uriTemplate: string; name: string }> }> {
    try {
      return await client.listResourceTemplates();
    } catch (error) {
      if (
        error instanceof McpError &&
        error.code === -32601
      ) {
        return { resourceTemplates: [] };
      }
      throw error;
    }
  }

  private async loadCachedMetadata(entry: PoolEntry): Promise<void> {
    const cached = await this.cacheStore.get(entry.config.name, entry.config.fingerprint);
    if (!cached) {
      return;
    }

    entry.metadata = {
      tools: cached.tools,
      resources: cached.resources,
      resourceTemplates: cached.resourceTemplates,
      prompts: cached.prompts,
      instructions: cached.instructions
    };
    entry.state.lastMetadataSync = cached.updatedAt;
  }

  private async closeEntry(entry: PoolEntry): Promise<void> {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = undefined;
    }
    if (entry.client) {
      await entry.client.close().catch(() => undefined);
    } else if (entry.transport) {
      await entry.transport.close().catch(() => undefined);
    }
    entry.client = undefined;
    entry.transport = undefined;
    entry.state.connected = false;
  }

  private scheduleIdleDisconnect(entry: PoolEntry): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = undefined;
    }
    if (entry.config.lifecycle !== "lazy") {
      return;
    }
    entry.idleTimer = setTimeout(() => {
      void this.closeEntry(entry);
    }, entry.config.idleTimeoutMinutes * 60_000);
  }

  private recordError(entry: PoolEntry, error: unknown): void {
    const suffix = entry.stderrChunks.join("").trim();
    const message = error instanceof Error ? error.message : String(error);
    entry.state.lastError = redactText(suffix ? `${message}\n${suffix}` : message);
  }

  private requireEntry(serverName: string): PoolEntry {
    const entry = this.entries.get(serverName);
    if (!entry) {
      throw new Error(`Unknown MCP server: ${serverName}`);
    }
    return entry;
  }
}
