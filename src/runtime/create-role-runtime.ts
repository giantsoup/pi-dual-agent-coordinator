import { createBrokerModelRuntime, failedModelStream } from "../security/model-runtime.js";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";

import { Agent, type AgentMessage, type ThinkingLevel } from "@earendil-works/pi-agent-core";
import { type Api, type Model } from "@earendil-works/pi-ai";
import {
  DefaultResourceLoader,
  AgentSession,
  convertToLlm,
  type AgentSessionEvent,
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,

  createAgentSessionRuntime,

  getAgentDir,
  SessionManager,
  SettingsManager
} from "@earendil-works/pi-coding-agent";

import { ManagedSession } from "./managed-session.js";
import { readSessionHistory } from "./session-history.js";
import { cleanupAll } from "./cleanup.js";

import { createSecureModelCatalog, isRoleModel, SMART_MODEL, EXECUTION_MODEL, SMOKE_MAX_TOKENS } from "../security/models.js";
import { ToolIsolation, assertStateOutsideWorkspace } from "../security/isolation.js";
import { createProviderBroker } from "../security/provider-broker.js";
import { assertLmStudioModelReady } from "../security/lm-studio.js";
import { redactText, redactValue } from "../security/redact.js";
import { createMcpExtension } from "../mcp/extension.js";
import type { ResolvedMcpConfig, RoleMcpStatusSnapshot } from "../mcp/types.js";
import { buildRolePromptAppendix, LOAD_PROJECT_RESOURCES_BY_DEFAULT } from "../app/trust-policy.js";
import { createRoleTools } from "../tools/create-role-tools.js";
import type { Role } from "../types/role.js";

export type SupportedThinkingLevel = ThinkingLevel;

export type ModelTurnEnd = Extract<AgentSessionEvent, { type: "turn_end" }>;
export interface SessionPromptOptions {
  formatOnly?: boolean;
  responseId?: string | undefined;
  responseAttempt?: number;
  streamingBehavior?: "steer" | "followUp";
  preflightResult?: (success: boolean) => void;
  /** Awaited after tool results, before the next model request. Returned text steers that request. */
  onTurnEnd?: (event: ModelTurnEnd, signal: AbortSignal) => Promise<string | void>;
}

export interface SessionLike {
  readonly sessionId: string;
  readonly sessionFile?: string | undefined;
  readonly model?: Model<Api> | undefined;
  readonly thinkingLevel?: string | undefined;
  readonly isStreaming?: boolean | undefined;
  readonly messages?: AgentMessage[] | undefined;
  readonly sessionManager?: { getLeafId(): string | null; appendCustomEntry?(type: string, data: unknown): string; getEntries?(): import("@earendil-works/pi-coding-agent").SessionEntry[] } | undefined;
  bindExtensions?(bindings: Record<string, never>): Promise<void>;
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  prompt(
    text: string,
    options?: SessionPromptOptions
  ): Promise<void>;
  abort(): Promise<void>;
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
  localModel?: Model<"openai-completions"> | undefined;
  thinkingOverride?: SupportedThinkingLevel | undefined;
  sessionMode: "persistent" | "memory";
  loadProjectResources?: boolean | undefined;
  onMutation?: ((record: { toolName: string; canonicalPath: string }) => void) | undefined;
  mcp?: ResolvedMcpConfig | undefined;
  /** Trusted test seam, never accepted from CLI, config, extensions, or model input. */
  providerTestBackend?: Parameters<typeof createProviderBroker>[0] | undefined;
  noTools?: boolean | undefined;
  /** Adopt live state on model changes; Pi may not have flushed a session file yet. */
  initialSessionManager?: SessionManager | undefined;
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
    await this.runtime.session.abort();
    await cleanupAll([() => this.runtime.session.dispose(), () => this.runtime.dispose(), async () => this.disposeMcpRuntime?.()]);
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
    const discovered = options.localModel ? [options.localModel] : [];
    const modelRegistry = createSecureModelCatalog(discovered);
    const selected = resolveModelOverride(options.modelOverride ?? (options.role === "A" ? SMART_MODEL : EXECUTION_MODEL), modelRegistry);
    if (!selected || !isRoleModel(options.role, selected, discovered)) {
      throw new Error(`Agent ${options.role} requires ${options.role === "A" ? "an approved OpenAI Responses model" : "an approved local LM Studio model"}. Endpoint and provider overrides are rejected.`);
    }
    const resolveLocalInstanceId = options.role === "B" && !options.providerTestBackend ? () => assertLmStudioModelReady(selected) : undefined;
    await resolveLocalInstanceId?.();
    broker = await createProviderBroker({ ...options.providerTestBackend, resolveLocalInstanceId,
      provider: options.role === "A" ? "openai" : "lm-studio", cwd, modelIds: [selected.id],
      ...(options.noTools ? { maxRequests: 1, maxOutputTokens: SMOKE_MAX_TOKENS, timeoutMs: 40_000 } : {}) });
    const model = { ...selected, baseUrl: broker.baseUrl };
    const ownedToken = broker.token;
    const modelRuntime = await createBrokerModelRuntime(model, ownedToken);
    let sessionManager: SessionManager;
    if (options.initialSessionManager) {
      sessionManager = options.initialSessionManager;
      if (realpathSync(sessionManager.getCwd()) !== isolation.cwd) throw new Error("Session cwd changes require a new isolated runtime.");
      if (sessionManager.isPersisted() !== (options.sessionMode === "persistent")) throw new Error("Session persistence mode must match the runtime.");
      if (sessionManager.isPersisted()) {
        const directory = realpathSync(getRoleSessionDirectory(cwd, options.role, options.sessionRoot));
        if (realpathSync(sessionManager.getSessionDir()) !== directory) throw new Error("Session must stay inside this role's private session directory.");
        const candidate = relative(resolve(sessionManager.getSessionDir()), resolve(sessionManager.getSessionFile() ?? ""));
        if (candidate.startsWith("..") || isAbsolute(candidate) || !candidate.endsWith(".jsonl")) throw new Error("Session must stay inside this role's private session directory.");
      }
    } else sessionManager = createSessionManager({ cwd, role: options.role, agentDir,
      sessionRoot: options.sessionRoot, sessionMode: options.sessionMode });
    mcpRuntime = !options.noTools && options.mcp ? createMcpExtension({ role: options.role, config: options.mcp }) : undefined;

    const sessions = new WeakMap<AgentSession, ManagedSession>();
    const factory: CreateAgentSessionRuntimeFactory = async ({ cwd: runtimeCwd, sessionManager, sessionStartEvent }) => {
      if (realpathSync(runtimeCwd) !== isolation.cwd) throw new Error("Session cwd changes require a new isolated runtime.");
      const tools = options.noTools ? [] : createRoleTools({ role: options.role, cwd: runtimeCwd,
        isolation, onMutation: options.onMutation });
      const settings = {
        defaultProvider: selected.provider, defaultModel: selected.id,
        compaction: { enabled: !options.noTools }, retry: { enabled: false },
        enableSkillCommands: false, shellPath: "/bin/bash",
        cacheWarming: "off", enableInstallTelemetry: false, enableAnalytics: false
      } satisfies Parameters<typeof SettingsManager.inMemory>[0];
      const settingsManager = SettingsManager.inMemory(settings);
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
      const extensionErrors = resourceLoader.getExtensions().errors;
      if (extensionErrors.length) throw new Error(extensionErrors.map((error) => error.error).join("; "));
      const services = { cwd: runtimeCwd, agentDir: resourceRoot, modelRuntime, settingsManager, resourceLoader, diagnostics: [] };
      if (!selected.reasoning && options.thinkingOverride && options.thinkingOverride !== "off") throw new Error("This model supports thinking off only.");
      const thinkingLevel = !selected.reasoning ? "off" : options.thinkingOverride ?? (options.noTools && selected.id !== "gpt-6.1-sol" ? "off" : resolveThinkingLevel(options.role));
      if (selected.id === "gpt-6.1-sol" && (thinkingLevel === "off" || thinkingLevel === "minimal")) throw new Error("GPT-6.1 Sol requires Low, Medium or High reasoning.");
      let assertPromptActive: () => void = () => { throw new Error("Session is not ready."); };
      const agent = new Agent({
        initialState: { model, thinkingLevel, tools: [] }, convertToLlm: (messages) => convertToLlm(redactValue(messages)),
        sessionId: sessionManager.getSessionId(),
        streamFn: async (requestModel, context, streamOptions) => {
          try {
            assertPromptActive();
            if (requestModel.provider !== model.provider || requestModel.id !== model.id || requestModel.baseUrl !== model.baseUrl || requestModel.api !== model.api) {
              throw new Error("Untrusted provider model or endpoint rejected.");
            }
            return await modelRuntime.streamSimple(model, redactValue(context), { ...streamOptions, apiKey: ownedToken, maxRetries: 0,
              ...(["gpt-6-luna", "gpt-6.1-sol", "gpt-5.6-terra"].includes(model.id) ? { cacheRetention: "none" } : {}),
              ...(options.noTools ? { maxTokens: SMOKE_MAX_TOKENS } : {}) });
          } catch (error) {
            return failedModelStream(model, error, streamOptions?.signal?.aborted ?? false);
          }
        }
      });
      const restored = sessionManager.buildSessionContext();
      if (restored.messages.length === 0) {
        sessionManager.appendModelChange(model.provider, model.id);
        sessionManager.appendThinkingLevelChange(thinkingLevel);
      }
      const session = new AgentSession({ agent, sessionManager, settingsManager, cwd: runtimeCwd,
        resourceLoader, modelRuntime, usesDefaultTools: false,
        allowedToolNames: [...tools.map((tool) => tool.name), ...(mcpRuntime?.getToolNames() ?? [])],
        excludedToolNames: ["codemode", "tool_search", "mcp__*"], baseToolsOverride: Object.fromEntries(tools.map((tool) => [tool.name, tool])),
        initialActiveToolNames: tools.map((tool) => tool.name),
        ...(sessionStartEvent ? { sessionStartEvent } : {}) });
      session.refreshContext();
      const managed = new ManagedSession(session);
      assertPromptActive = () => managed.assertActive();
      sessions.set(session, managed);
      return { session, extensionsResult: resourceLoader.getExtensions(), services, diagnostics: [] };

    };
    runtime = await createAgentSessionRuntime(factory, { cwd, agentDir: resourceRoot, sessionManager });
    const ownedBroker = broker;
    let ownedRuntime = runtime;
    const managedSession = () => {
      const managed = sessions.get(ownedRuntime.session);
      if (!managed) throw new Error("Missing managed session.");
      return managed;
    };
    const replaceSession = async (manager: SessionManager) => {
      const next = await createAgentSessionRuntime(factory, { cwd, agentDir: resourceRoot, sessionManager: manager });
      try { await next.session.bindExtensions({}); }
      catch (error) { await next.session.abort(); next.session.dispose(); await next.dispose(); throw error; }
      const previous = ownedRuntime;
      try { await managedSession().abort(); }
      catch (error) { await next.session.abort(); next.session.dispose(); await next.dispose(); throw error; }
      managedSession().dispose();
      ownedRuntime = next;
      await previous.dispose();
      return { cancelled: false };
    };
    const guardedRuntime: RuntimeLike = {
      get session() { return managedSession(); },
      get cwd() { return ownedRuntime.cwd; },
      newSession: (input) => {
        const manager = createSessionManager({ cwd, role: options.role, agentDir, sessionRoot: options.sessionRoot, sessionMode: options.sessionMode });
        if (input?.parentSession) manager.newSession({ parentSession: input.parentSession });
        return replaceSession(manager);
      },
      switchSession: async (path) => {
        if (options.sessionMode === "memory") throw new Error("Session switching is unavailable in memory mode.");
        const directory = realpathSync(getRoleSessionDirectory(cwd, options.role, options.sessionRoot));
        const canonical = realpathSync(path);
        const candidate = relative(directory, canonical);
        if (candidate.startsWith("..") || isAbsolute(candidate) || !candidate.endsWith(".jsonl")) throw new Error("Session switch must stay inside this role's private session directory.");
        const history = readSessionHistory(canonical);
        if (realpathSync(history.cwd) !== isolation.cwd) throw new Error("Session cwd changes require a new isolated runtime.");
        return replaceSession(SessionManager.open(canonical));
      },
      dispose: () => ownedRuntime.dispose()
    };
    const binding = new RoleRuntimeBindingImpl(options.role, guardedRuntime, cwd, mcpRuntime?.getStatus, async () => {
      await cleanupAll([async () => mcpRuntime?.dispose(), () => ownedBroker.close(),
        () => isolation.dispose(), () => rmSync(resourceRoot, { recursive: true, force: true })]);
    });
    await binding.rebind();
    return binding;
  } catch (error) {
    await cleanupAll([async () => runtime?.session.abort(), () => runtime?.session.dispose(), async () => runtime?.dispose(), async () => mcpRuntime?.dispose(),
      async () => broker?.close(), () => isolation.dispose(), () => rmSync(resourceRoot, { recursive: true, force: true })]).catch(() => undefined);
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
  modelRegistry: ReturnType<typeof createSecureModelCatalog>
): Model<Api> | undefined {
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
  modelRegistry: ReturnType<typeof createSecureModelCatalog>
): Model<Api> | undefined {
  const [provider, ...rest] = modelOverride.split("/");
  const modelId = rest.join("/");
  if (!provider || !modelId) {
    return undefined;
  }
  return modelRegistry.find(provider, modelId);
}

export type { AgentSession, AgentSessionEvent, AgentSessionRuntime };
