import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";

import { Agent, type ThinkingLevel } from "@mariozechner/pi-agent-core";
import { streamSimple, type Model } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  DefaultResourceLoader,
  AgentSession,
  convertToLlm,
  type AgentSessionEvent,
  type AgentSessionRuntime,

  createAgentSessionRuntime,

  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager
} from "@mariozechner/pi-coding-agent";

import { createSecureModelRegistry, SMART_MODEL, EXECUTION_MODEL, SMOKE_MAX_TOKENS } from "../security/models.js";
import { ToolIsolation, assertStateOutsideWorkspace } from "../security/isolation.js";
import { createProviderBroker } from "../security/provider-broker.js";
import { redactText, redactValue } from "../security/redact.js";
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
  /** Trusted test seam, never accepted from CLI, config, extensions, or model input. */
  providerTestBackend?: Parameters<typeof createProviderBroker>[0] | undefined;
  noTools?: boolean | undefined;
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
    try { await this.runtime.dispose(); }
    finally { await this.disposeMcpRuntime?.(); }
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

  const isolation = new ToolIsolation(cwd, options.role);
  const resourceRoot = mkdtempSync(join(tmpdir(), "pi-dual-resources-"));
  let broker: Awaited<ReturnType<typeof createProviderBroker>> | undefined;
  let runtime: AgentSessionRuntime | undefined;
  let mcpRuntime: ReturnType<typeof createMcpExtension>;
  try {
    isolation.verify();
    assertStateOutsideWorkspace(cwd, options.sessionRoot ?? getDefaultSessionRoot(cwd));
    const authStorage = AuthStorage.inMemory();
    const modelRegistry = createSecureModelRegistry(authStorage);
    const selected = resolveModelOverride(options.modelOverride ?? (options.role === "A" ? SMART_MODEL : EXECUTION_MODEL), modelRegistry);
    if (!selected || selected.provider !== "openai" || selected.api !== "openai-responses" || selected.baseUrl !== "https://api.openai.com/v1") {
      throw new Error("Secure mode requires an approved openai Responses API model for each role. Endpoint and provider overrides are rejected.");
    }
    broker = await createProviderBroker({ ...options.providerTestBackend, cwd, modelIds: [selected.id],
      ...(options.noTools ? { maxRequests: 1, maxOutputTokens: SMOKE_MAX_TOKENS, timeoutMs: 40_000 } : {}) });
    authStorage.setRuntimeApiKey("openai", broker.token);
    const model = { ...selected, baseUrl: broker.baseUrl };
    const ownedToken = broker.token;
    modelRegistry.registerProvider("openai", { baseUrl: broker.baseUrl, apiKey: broker.token });
    const sessionManager = createSessionManager({ cwd, role: options.role, agentDir,
      sessionRoot: options.sessionRoot, sessionMode: options.sessionMode });
    mcpRuntime = !options.noTools && options.mcp ? createMcpExtension({ role: options.role, config: options.mcp }) : undefined;

    runtime = await createAgentSessionRuntime(
      async ({ cwd: runtimeCwd, sessionManager, sessionStartEvent }) => {
        if (realpathSync(runtimeCwd) !== isolation.cwd) throw new Error("Session cwd changes require a new isolated runtime.");
        const tools = options.noTools ? [] : createRoleTools({ role: options.role, cwd: runtimeCwd,
          isolation, onMutation: options.onMutation });
        const settingsManager = SettingsManager.inMemory({
          defaultProvider: "openai", defaultModel: selected.id,
          compaction: { enabled: !options.noTools }, retry: { enabled: false },
          enableSkillCommands: false, shellPath: "/bin/bash"
        });
        const agentsFiles: Array<{ path: string; content: string }> = [];
        if (loadProjectResources && !options.noTools) {
          const read = tools.find((tool) => tool.name === "read");
          if (read) {
            try {
              const result = await read.execute("project-instructions", { path: "AGENTS.md" });
              const text = result.content.filter((item) => item.type === "text").map((item) => item.type === "text" ? item.text : "").join("\n");
              agentsFiles.push({ path: join(runtimeCwd, "AGENTS.md"), content: redactText(text) });
            } catch { /* Missing or sandbox-denied instructions are never loaded by the trusted process. */ }
          }
        }
        // Discovery runs in an empty trusted directory, never in the writable project.
        const resourceLoader = new DefaultResourceLoader({
          cwd: resourceRoot, agentDir: resourceRoot, settingsManager,
          noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
          noContextFiles: true, systemPrompt: "You are a coding assistant in a coordinator-controlled workspace.",
          appendSystemPrompt: buildRolePromptAppendix(options.role),
          agentsFilesOverride: () => ({ agentsFiles }),
          extensionFactories: mcpRuntime ? [mcpRuntime.extensionFactory] : []
        });
        await resourceLoader.reload();
        const services = { cwd: runtimeCwd, agentDir: resourceRoot, authStorage,
          modelRegistry, settingsManager, resourceLoader, diagnostics: [] };
        const thinkingLevel = options.thinkingOverride ?? (options.noTools ? "off" : resolveThinkingLevel(options.role));
        const agent = new Agent({
          initialState: { model, thinkingLevel, tools: [] }, convertToLlm: (messages) => convertToLlm(redactValue(messages)),
          sessionId: sessionManager.getSessionId(),
          streamFn: async (requestModel, context, streamOptions) => {
            if (requestModel.provider !== "openai" || requestModel.id !== model.id || requestModel.baseUrl !== model.baseUrl || requestModel.api !== "openai-responses") {
              throw new Error("Untrusted provider model or endpoint rejected.");
            }
            return streamSimple(model, redactValue(context), { ...streamOptions, apiKey: ownedToken,
              ...(model.id === "gpt-6-luna" ? { cacheRetention: "none" } : {}),
              ...(options.noTools ? { maxTokens: SMOKE_MAX_TOKENS } : {}) });
          }
        });
        const restored = sessionManager.buildSessionContext();
        agent.state.messages = restored.messages;
        if (restored.messages.length === 0) {
          sessionManager.appendModelChange(model.provider, model.id);
          sessionManager.appendThinkingLevelChange(thinkingLevel);
        }
        const session = new AgentSession({ agent, sessionManager, settingsManager, cwd: runtimeCwd,
          resourceLoader, modelRegistry, baseToolsOverride: Object.fromEntries(tools.map((tool) => [tool.name, tool])),
          initialActiveToolNames: tools.map((tool) => tool.name),
          ...(sessionStartEvent ? { sessionStartEvent } : {}) });
        return { session, extensionsResult: resourceLoader.getExtensions(), services, diagnostics: [] };

      },
      { cwd, agentDir: resourceRoot, sessionManager }
    );
    const ownedBroker = broker;
    const ownedRuntime = runtime;
    const guardedRuntime: RuntimeLike = {
      get session() { return ownedRuntime.session; },
      get cwd() { return ownedRuntime.cwd; },
      newSession: (input) => ownedRuntime.newSession(input),
      switchSession: async (path) => {
        const directory = realpathSync(getRoleSessionDirectory(cwd, options.role, options.sessionRoot));
        const candidate = relative(directory, realpathSync(path));
        if (candidate.startsWith("..") || isAbsolute(candidate) || !candidate.endsWith(".jsonl")) throw new Error("Session switch must stay inside this role's private session directory.");
        return ownedRuntime.switchSession(path);
      },
      dispose: () => ownedRuntime.dispose()
    };
    const binding = new RoleRuntimeBindingImpl(options.role, guardedRuntime, cwd, mcpRuntime?.getStatus, async () => {
      await mcpRuntime?.dispose();
      await ownedBroker.close();
      isolation.dispose();
      rmSync(resourceRoot, { recursive: true, force: true });
    });
    await binding.rebind();
    return binding;
  } catch (error) {
    await runtime?.dispose().catch(() => undefined);
    await mcpRuntime?.dispose().catch(() => undefined);
    await broker?.close();
    isolation.dispose();
    rmSync(resourceRoot, { recursive: true, force: true });
    throw new Error(redactText(error instanceof Error ? error.message : "Secure runtime initialization failed."));
  }
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
