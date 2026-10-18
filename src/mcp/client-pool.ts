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
  CallToolResultSchema,
  ErrorCode,
  ListRootsRequestSchema,
  ListToolsResultSchema,
  McpError,
  type Tool
} from "@modelcontextprotocol/sdk/types.js";

import { mcpParameters, assertMcpArguments, assertMcpResult } from "./schema.js";
import { McpCacheStore } from "./cache-store.js";
import type {
  McpMetadataCacheEntry,
  McpMetadataSnapshot,
  McpServerRuntimeState,
  ResolvedMcpConfig,
  ResolvedMcpServerConfig,
  RoleMcpStatusSnapshot
} from "./types.js";
import type { Role } from "../types/role.js";

interface PoolEntry {
  config: ResolvedMcpServerConfig;
  state: McpServerRuntimeState;
  client?: Client | undefined;
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
  private closing: Promise<void> | undefined;
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

  public async ensureMetadata(serverName: string, signal?: AbortSignal): Promise<McpMetadataSnapshot> {
    signal?.throwIfAborted();
    const known = this.getKnownMetadata(serverName);
    if (known) {
      return known;
    }
    return this.syncMetadata(serverName, signal);
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

  public async syncMetadata(serverName: string, signal?: AbortSignal): Promise<McpMetadataSnapshot> {
    signal?.throwIfAborted();
    const entry = this.requireEntry(serverName);
    const client = await this.ensureConnected(entry);
    signal?.throwIfAborted();
    try {
      const capabilities = client.getServerCapabilities();
      const requestOptions = signal ? { signal } : undefined;
      const [tools, resources, resourceTemplates, prompts] = await Promise.all([
        capabilities?.tools ? collectPages(async cursor => {
          const page = await client.listTools(cursor === undefined ? undefined : { cursor }, requestOptions);
          return { items: page.tools, nextCursor: page.nextCursor };
        }) : [],
        capabilities?.resources ? collectPages(async cursor => {
          const page = await client.listResources(cursor === undefined ? undefined : { cursor }, requestOptions);
          return { items: page.resources, nextCursor: page.nextCursor };
        }) : [],
        capabilities?.resources ? collectPages(async cursor => {
          const page = await this.tryListResourceTemplates(client, cursor, signal);
          return { items: page.resourceTemplates, nextCursor: page.nextCursor };
        }) : [],
        capabilities?.prompts ? collectPages(async cursor => {
          const page = await client.listPrompts(cursor === undefined ? undefined : { cursor }, requestOptions);
          return { items: page.prompts, nextCursor: page.nextCursor };
        }) : []
      ]);
      for (const tool of tools) {
        mcpParameters(tool.inputSchema);
        if (tool.outputSchema) mcpParameters(tool.outputSchema);
      }
      const snapshot: McpMetadataSnapshot = { tools, resources, resourceTemplates, prompts, instructions: client.getInstructions() };

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
    const metadata = await this.ensureMetadata(serverName, signal);
    const tool = metadata.tools.find((candidate) => candidate.name === toolName);
    if (!tool) throw new Error(`Unknown MCP tool ${serverName}/${toolName}`);
    if (tool.execution?.taskSupport === "required") throw new Error("Task-only MCP tools are not enabled.");
    assertMcpArguments(tool, args);
    signal?.throwIfAborted();
    const client = await this.ensureConnected(this.requireEntry(serverName));
    signal?.throwIfAborted();
    const result = await client.callTool({
      name: toolName,
      arguments: redactValue(args)
    }, CallToolResultSchema, { ...(signal ? { signal } : {}) });
    const parsed = CallToolResultSchema.parse(redactValue(result));
    assertMcpResult(tool, parsed);
    this.scheduleIdleDisconnect(this.requireEntry(serverName));
    return parsed;
  }

  public async listResources(serverName: string, cursor?: string | undefined, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const client = await this.ensureConnected(this.requireEntry(serverName));
    signal?.throwIfAborted();
    const result = await client.listResources(cursor === undefined ? undefined : { cursor }, signal ? { signal } : undefined);
    const templates =
      cursor !== undefined
        ? undefined
        : await this.tryListResourceTemplates(client, undefined, signal);
    this.scheduleIdleDisconnect(this.requireEntry(serverName));
    return {
      resources: result.resources,
      resourceTemplates: templates?.resourceTemplates ?? [],
      nextCursor: result.nextCursor
    };
  }

  public async readResource(serverName: string, uri: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const client = await this.ensureConnected(this.requireEntry(serverName));
    signal?.throwIfAborted();
    const result = await client.readResource({ uri }, signal ? { signal } : undefined);
    this.scheduleIdleDisconnect(this.requireEntry(serverName));
    return result;
  }

  public async listPrompts(serverName: string, cursor?: string | undefined, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const client = await this.ensureConnected(this.requireEntry(serverName));
    signal?.throwIfAborted();
    const result = await client.listPrompts(cursor === undefined ? undefined : { cursor }, signal ? { signal } : undefined);
    this.scheduleIdleDisconnect(this.requireEntry(serverName));
    return result;
  }

  public async getPrompt(
    serverName: string,
    name: string,
    args: Record<string, string> | undefined,
    signal?: AbortSignal
  ) {
    signal?.throwIfAborted();
    const client = await this.ensureConnected(this.requireEntry(serverName));
    signal?.throwIfAborted();
    const result = await client.getPrompt({
      name,
      arguments: redactValue(args)
    }, signal ? { signal } : undefined);
    this.scheduleIdleDisconnect(this.requireEntry(serverName));
    return result;
  }

  public closeAll(): Promise<void> {
    if (this.closing) return this.closing;
    const closing = (async () => {
      const results = await Promise.allSettled([...this.entries.values()].map(entry => this.closeEntry(entry)));
      const failures = results.filter(result => result.status === "rejected");
      if (failures.length) throw new AggregateError(failures.map(result => result.reason), "MCP shutdown failed.");
      this.isolation?.dispose();
      this.isolation = undefined;
    })();
    this.closing = closing;
    return closing.finally(() => { if (this.closing === closing) this.closing = undefined; });
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
    if (this.closing) throw new Error("MCP connections are closing.");
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

    if (entry.config.transport !== "stdio") {
      throw new Error("Secure MCP currently supports sandboxed stdio servers only. HTTP/SSE peers cannot be verified as isolated; no unsandboxed fallback is available.");
    }
    const transport = new StdioClientTransport(this.buildStdioParams(entry.config));
    this.attachStdioStderr(entry, transport);
    client.onclose = () => {
      if (entry.client && entry.client !== client) return;
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      entry.idleTimer = undefined;
      entry.state.connected = false;
      entry.client = undefined;
    };
    client.onerror = error => this.recordError(entry, error);
    try {
      await client.connect(transport);
      return client;
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
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

  private async tryListResourceTemplates(client: Client, cursor?: string, signal?: AbortSignal): ReturnType<Client["listResourceTemplates"]> {
    try {
      return await client.listResourceTemplates(cursor === undefined ? undefined : { cursor }, signal ? { signal } : undefined);
    } catch (error) {
      if (
        error instanceof McpError &&
        error.code === ErrorCode.MethodNotFound
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

    const tools = ListToolsResultSchema.parse({ tools: cached.tools }).tools;
    for (const tool of tools) {
      mcpParameters(tool.inputSchema);
      if (tool.outputSchema) mcpParameters(tool.outputSchema);
    }
    entry.metadata = {
      tools,
      resources: cached.resources,
      resourceTemplates: cached.resourceTemplates,
      prompts: cached.prompts,
      instructions: cached.instructions
    };
    entry.state.lastMetadataSync = cached.updatedAt;
  }

  private async closeEntry(entry: PoolEntry): Promise<void> {
    await entry.connectionPromise?.catch(() => undefined);
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = undefined;
    }
    if (entry.client) {
      await entry.client.close();
    }
    entry.client = undefined;
    entry.state.connected = false;
  }

  private scheduleIdleDisconnect(entry: PoolEntry): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = undefined;
    }
    if (this.closing || entry.config.lifecycle !== "lazy") {
      return;
    }
    entry.idleTimer = setTimeout(() => {
      void this.closeEntry(entry).catch(error => this.recordError(entry, error));
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

async function collectPages<T>(read: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string | undefined }>): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const result = await read(cursor);
    items.push(...result.items);
    cursor = result.nextCursor;
    if (cursor === undefined) return items;
    if (seen.has(cursor)) throw new Error("MCP metadata pagination repeated a cursor.");
    seen.add(cursor);
  }
  throw new Error("MCP metadata exceeded 100 pages.");
}
