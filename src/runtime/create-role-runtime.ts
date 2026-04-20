import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  type AgentSession,
  type AgentSessionEvent,
  type AgentSessionRuntime,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager
} from "@mariozechner/pi-coding-agent";

import { createMcpExtension } from "../mcp/extension.js";
import type { ResolvedMcpConfig, RoleMcpStatusSnapshot } from "../mcp/types.js";
import { buildRolePromptAppendix, LOAD_PROJECT_RESOURCES_BY_DEFAULT } from "../app/trust-policy.js";
import { createRoleTools } from "../tools/create-role-tools.js";
import type { Role } from "../types/role.js";

export type SupportedThinkingLevel = "off" | "low" | "medium" | "high";

export interface SessionLike {
  readonly sessionId: string;
  readonly sessionFile?: string | undefined;
  readonly model?: Model<any> | undefined;
  readonly thinkingLevel?: string | undefined;
  readonly isStreaming?: boolean | undefined;
  readonly messages?: unknown[] | undefined;
  readonly sessionManager?: { getLeafId(): string | null } | undefined;
  bindExtensions?(bindings: Record<string, never>): Promise<void>;
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  prompt(
    text: string,
    options?: {
      streamingBehavior?: "steer" | "followUp";
      preflightResult?: (success: boolean) => void;
    }
  ): Promise<void>;
  dispose(): void;
}

export interface RuntimeLike {
  readonly session: SessionLike;
  readonly cwd: string;
  readonly diagnostics?: readonly unknown[];
  newSession(options?: { parentSession?: string }): Promise<{ cancelled: boolean }>;
  switchSession(sessionPath: string, cwdOverride?: string): Promise<{ cancelled: boolean }>;
  dispose(): Promise<void>;
}

export interface CreateRoleRuntimeOptions {
  role: Role;
  cwd: string;
  agentDir?: string | undefined;
  sessionRoot?: string | undefined;
  modelOverride?: string | undefined;
  thinkingOverride?: SupportedThinkingLevel | undefined;
  sessionMode: "persistent" | "memory";
  loadProjectResources?: boolean | undefined;
  onMutation?: ((record: { toolName: string; canonicalPath: string }) => void) | undefined;
  mcp?: ResolvedMcpConfig | undefined;
}

export interface RoleRuntimeBinding {
  role: Role;
  runtime: RuntimeLike;
  readonly session: SessionLike;
  readonly sessionId: string;
  readonly sessionFile?: string | undefined;
  cwd: string;
  getMcpStatus?(): RoleMcpStatusSnapshot;
  rebind(): Promise<void>;
  dispose(): Promise<void>;
}

class RoleRuntimeBindingImpl implements RoleRuntimeBinding {
  public cwd: string;

  public constructor(
    public readonly role: Role,
    public readonly runtime: RuntimeLike,
    cwd: string,
    private readonly getMcpStatusSnapshot?: (() => RoleMcpStatusSnapshot) | undefined,
    private readonly disposeMcpRuntime?: (() => Promise<void>) | undefined
  ) {
    this.cwd = cwd;
  }

  public get session(): SessionLike {
    return this.runtime.session;
  }

  public get sessionId(): string {
    return this.runtime.session.sessionId;
  }

  public get sessionFile(): string | undefined {
    return this.runtime.session.sessionFile;
  }

  public async rebind(): Promise<void> {
    this.cwd = this.runtime.cwd;
    if (this.runtime.session.bindExtensions) {
      await this.runtime.session.bindExtensions({});
    }
  }

  public async dispose(): Promise<void> {
    this.runtime.session.dispose();
    await this.runtime.dispose();
    await this.disposeMcpRuntime?.();
  }

  public getMcpStatus(): RoleMcpStatusSnapshot {
    return (
      this.getMcpStatusSnapshot?.() ?? {
        role: this.role,
        enabled: false,
        servers: []
      }
    );
  }
}

export async function createRoleRuntime(
  options: CreateRoleRuntimeOptions
): Promise<RoleRuntimeBinding> {
  const cwd = resolve(options.cwd);
  const agentDir = options.agentDir ?? getAgentDir();
  const loadProjectResources =
    options.loadProjectResources ?? LOAD_PROJECT_RESOURCES_BY_DEFAULT;

  const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
  const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));
  const sessionManager = createSessionManager({
    cwd,
    role: options.role,
    agentDir,
    sessionRoot: options.sessionRoot,
    sessionMode: options.sessionMode
  });
  const mcpRuntime = options.mcp ? createMcpExtension({ role: options.role, config: options.mcp }) : undefined;

  const runtime = await createAgentSessionRuntime(
    async ({ cwd: runtimeCwd, agentDir: runtimeAgentDir, sessionManager, sessionStartEvent }) => {
      const settingsManager = SettingsManager.create(runtimeCwd, runtimeAgentDir);
      const services = await createAgentSessionServices({
        cwd: runtimeCwd,
        agentDir: runtimeAgentDir,
        authStorage,
        modelRegistry,
        settingsManager,
        resourceLoaderOptions: {
          noContextFiles: !loadProjectResources,
          extensionFactories: mcpRuntime ? [mcpRuntime.extensionFactory] : [],
          appendSystemPromptOverride: (base) => [
            ...base,
            ...buildRolePromptAppendix(options.role)
          ]
        }
      });

      const model = resolveModelOverride(options.modelOverride, modelRegistry);
      const thinkingLevel = resolveThinkingLevel(options.role, options.thinkingOverride);

      return {
        ...(await createAgentSessionFromServices({
          services,
          sessionManager,
          ...(sessionStartEvent ? { sessionStartEvent } : {}),
          ...(model ? { model } : {}),
          thinkingLevel,
          tools: createRoleTools({
            role: options.role,
            cwd: runtimeCwd,
            onMutation: options.onMutation
          })
        })),
        services,
        diagnostics: services.diagnostics
      };
    },
    {
      cwd,
      agentDir,
      sessionManager
    }
  );

  const binding = new RoleRuntimeBindingImpl(
    options.role,
    runtime as unknown as AgentSessionRuntime,
    cwd,
    mcpRuntime?.getStatus,
    mcpRuntime?.dispose
  );
  await binding.rebind();
  return binding;
}

export function getDefaultSessionRoot(cwd: string): string {
  const hash = createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 16);
  return join(homedir(), ".pi", "dual-agent-coordinator", "projects", hash);
}

export function getRoleSessionDirectory(
  cwd: string,
  role: Role,
  sessionRoot?: string
): string {
  return join(sessionRoot ?? getDefaultSessionRoot(cwd), role);
}

function createSessionManager(options: {
  cwd: string;
  role: Role;
  agentDir: string;
  sessionRoot?: string | undefined;
  sessionMode: "persistent" | "memory";
}): SessionManager {
  if (options.sessionMode === "memory") {
    return SessionManager.inMemory(options.cwd);
  }
  return SessionManager.create(
    options.cwd,
    getRoleSessionDirectory(options.cwd, options.role, options.sessionRoot)
  );
}

function resolveThinkingLevel(
  role: Role,
  override?: SupportedThinkingLevel
): ThinkingLevel {
  if (override) {
    return override;
  }
  return role === "A" ? "high" : "medium";
}

function resolveModelOverride(
  modelOverride: string | undefined,
  modelRegistry: ModelRegistry
): Model<any> | undefined {
  if (!modelOverride) {
    return undefined;
  }
  const canonicalMatch = modelOverride.includes("/")
    ? parseCanonicalModelReference(modelOverride, modelRegistry)
    : undefined;

  if (canonicalMatch) {
    return canonicalMatch;
  }

  const all = modelRegistry.getAll();
  const exact = all.filter((model) => model.id === modelOverride);
  if (exact.length === 1) {
    return exact[0];
  }
  if (exact.length > 1) {
    throw new Error(`Ambiguous model override: ${modelOverride}`);
  }
  throw new Error(`Unknown model override: ${modelOverride}`);
}

function parseCanonicalModelReference(
  modelOverride: string,
  modelRegistry: ModelRegistry
): Model<any> | undefined {
  const [provider, ...rest] = modelOverride.split("/");
  const modelId = rest.join("/");
  if (!provider || !modelId) {
    return undefined;
  }
  return modelRegistry.find(provider, modelId);
}

export type { AgentSession, AgentSessionEvent, AgentSessionRuntime };
