import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { mcpConfigFileSchema } from "./config-schema.js";
import type {
  McpConfigFile,
  McpRoleConfig,
  McpServerConfig,
  ResolvedMcpConfig,
  ResolvedMcpServerConfig
} from "./types.js";

export interface LoadResolvedMcpConfigOptions {
  cwd: string;
  agentDir: string;
  enabled: boolean;
  explicitConfigPaths?: string[] | undefined;
}

interface LoadedConfigSource {
  path: string;
  config: McpConfigFile;
}

export async function loadResolvedMcpConfig(
  options: LoadResolvedMcpConfigOptions
): Promise<ResolvedMcpConfig> {
  if (!options.enabled) {
    return {
      enabled: false,
      projectRoot: resolve(options.cwd),
      cacheFile: join(options.agentDir, "mcp-cache.json"),
      configSources: [],
      servers: []
    };
  }

  const discoveredPaths = await discoverConfigPaths(options);
  const loadedSources = await Promise.all(discoveredPaths.map(async (path) => {
    const source = await loadConfigSource(path);
    if (path === resolve(options.agentDir, "mcp.json")) {
      for (const config of Object.values(source.config.mcpServers)) {
        config.cwd ??= resolve(options.cwd);
        config["x-pi-dual"] = {
          directTools: true,
          required: false,
          ...config["x-pi-dual"],
          roles: { ...config["x-pi-dual"]?.roles, A: { allowAllTools: true, ...config["x-pi-dual"]?.roles?.A } }
        };
      }
    }
    return source;
  }));
  const mergedServers = new Map<
    string,
    { config: McpServerConfig; sourcePaths: string[] }
  >();

  for (const source of loadedSources) {
    for (const [serverName, serverConfig] of Object.entries(source.config.mcpServers)) {
      const previous = mergedServers.get(serverName);
      mergedServers.set(serverName, {
        config: previous ? mergeServerConfigs(previous.config, serverConfig) : serverConfig,
        sourcePaths: previous ? [...previous.sourcePaths, source.path] : [source.path]
      });
    }
  }

  return {
    enabled: true,
    projectRoot: resolve(options.cwd),
    cacheFile: join(options.agentDir, "mcp-cache.json"),
    configSources: discoveredPaths,
    servers: [...mergedServers.entries()]
      .map(([name, entry]) => resolveServerConfig(name, entry.config, entry.sourcePaths))
      .sort((left, right) => left.name.localeCompare(right.name))
  };
}

async function discoverConfigPaths(
  options: LoadResolvedMcpConfigOptions
): Promise<string[]> {
  const projectPath = resolve(options.cwd, ".mcp.json");
  const globalPath = resolve(options.agentDir, "mcp.json");
  const paths: string[] = [];

  if (await fileExists(globalPath)) {
    paths.push(globalPath);
  }
  if (await fileExists(projectPath)) {
    paths.push(projectPath);
  }

  for (const explicitPath of options.explicitConfigPaths ?? []) {
    const resolvedPath = resolve(options.cwd, explicitPath);
    if (!(await fileExists(resolvedPath))) {
      throw new Error(`MCP config file not found: ${resolvedPath}`);
    }
    paths.push(resolvedPath);
  }

  return paths;
}

async function loadConfigSource(path: string): Promise<LoadedConfigSource> {
  const raw = await readFile(path, "utf8");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error(`Invalid MCP JSON config in ${path}.`); }
  const result = mcpConfigFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid MCP config in ${path}: ${result.error.issues[0]?.message ?? "unknown error"}`);
  }
  return {
    path,
    config: result.data
  };
}

function mergeServerConfigs(base: McpServerConfig, override: McpServerConfig): McpServerConfig {
  return {
    ...base,
    ...override,
    command: override.url ? undefined : override.command ?? base.command,
    url: override.command ? undefined : override.url ?? base.url,
    args: override.args ?? base.args,
    env: {
      ...(base.env ?? {}),
      ...(override.env ?? {})
    },
    headers: {
      ...(base.headers ?? {}),
      ...(override.headers ?? {})
    },
    "x-pi-dual": {
      ...(base["x-pi-dual"] ?? {}),
      ...(override["x-pi-dual"] ?? {}),
      roles: mergeRoleOverrides(base["x-pi-dual"]?.roles, override["x-pi-dual"]?.roles)
    }
  };
}

function mergeRoleConfig(
  base?: McpRoleConfig | undefined,
  override?: McpRoleConfig | undefined
): McpRoleConfig | undefined {
  if (!base && !override) {
    return undefined;
  }
  return {
    allowAllTools: override?.allowAllTools ?? base?.allowAllTools,
    onlyTools: override?.onlyTools ?? base?.onlyTools,
    allowTools: override?.allowTools ?? base?.allowTools,
    excludeTools: override?.excludeTools ?? base?.excludeTools
  };
}

function mergeRoleOverrides(
  base?: ResolvedMcpServerConfig["roleOverrides"] | undefined,
  override?: ResolvedMcpServerConfig["roleOverrides"] | undefined
): Partial<Record<"A" | "B", McpRoleConfig>> | undefined {
  const merged: Partial<Record<"A" | "B", McpRoleConfig>> = {};
  const roleA = mergeRoleConfig(base?.A, override?.A);
  const roleB = mergeRoleConfig(base?.B, override?.B);
  if (roleA) {
    merged.A = roleA;
  }
  if (roleB) {
    merged.B = roleB;
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function resolveServerConfig(
  name: string,
  config: McpServerConfig,
  sourcePaths: string[]
): ResolvedMcpServerConfig {
  const baseDir = dirname(sourcePaths[sourcePaths.length - 1] ?? process.cwd());
  const transport = resolveTransport(config);
  const directTools = config["x-pi-dual"]?.directTools ?? name === "laravel-boost";
  const lifecycle = config["x-pi-dual"]?.lifecycle ?? "lazy";
  const idleTimeoutMinutes = config["x-pi-dual"]?.idleTimeoutMinutes ?? 10;
  const required = config["x-pi-dual"]?.required ?? directTools;

  const resolved: ResolvedMcpServerConfig = {
    name,
    command: config.command,
    args: config.args ?? [],
    env: config.env && Object.keys(config.env).length > 0 ? config.env : undefined,
    cwd: config.cwd ? resolve(baseDir, config.cwd) : transport === "stdio" ? baseDir : undefined,
    url: config.url,
    headers: config.headers && Object.keys(config.headers).length > 0 ? config.headers : undefined,
    transport,
    directTools,
    lifecycle,
    idleTimeoutMinutes,
    required,
    roleOverrides: config["x-pi-dual"]?.roles
      ? {
          ...(config["x-pi-dual"]?.roles.A ? { A: config["x-pi-dual"]?.roles.A } : {}),
          ...(config["x-pi-dual"]?.roles.B ? { B: config["x-pi-dual"]?.roles.B } : {})
        }
      : {},
    sourcePaths,
    fingerprint: ""
  };

  resolved.fingerprint = createFingerprint(resolved);
  return resolved;
}

function resolveTransport(config: McpServerConfig): ResolvedMcpServerConfig["transport"] {
  if (config.command) {
    return "stdio";
  }
  if (config.transport === "sse") {
    return "sse";
  }
  return "streamable-http";
}

function createFingerprint(config: Omit<ResolvedMcpServerConfig, "fingerprint">): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        name: config.name,
        command: config.command,
        args: config.args,
        env: config.env,
        cwd: config.cwd,
        url: config.url,
        headers: config.headers,
        transport: config.transport,
        directTools: config.directTools,
        lifecycle: config.lifecycle,
        idleTimeoutMinutes: config.idleTimeoutMinutes,
        required: config.required,
        roleOverrides: config.roleOverrides
      })
    )
    .digest("hex");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
