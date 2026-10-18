import { responseProgressSchema, type ResponseProgress } from "./response-progress.js";
import { repairResponse, ResponseRepairExhaustedError } from "./response-repair.js";
import { responseShape, planProposalEnvelopeSchema, executionPlanEnvelopeSchema } from "../workflow/workflow-schema.js";
import { safeDisplayText } from "../security/display-text.js";
import { loadHistoryEvents } from "../app/interactive/history.js";
import type { HistoryRecord } from "../types/history.js";
import { readSessionArchive, archiveRunEntries } from "../runtime/session-history.js";
import { getSupportedThinkingLevels, type Model } from "@earendil-works/pi-ai";
import { randomUUID } from "node:crypto";
import { join, relative, isAbsolute } from "node:path";
import { realpath } from "node:fs/promises";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

import { loadCoordinatorConfig, writeCoordinatorConfig } from "../app/coordinator-config.js";
import { createSecureModelCatalog, isRoleModel, gptModelChoices, EXECUTION_MODEL } from "../security/models.js";
import { LmStudioModels, LocalModelSwitchError, type LocalModelHost, type PreparedLocalModel } from "../security/lm-studio.js";
import type { ModelPickerCatalog, ModelSwitchProgress } from "../types/model-selection.js";
import { SessionManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  deriveActivityUpdate,
  renderActivityText,
  renderReasonText,
  type ActivitySnapshot
} from "../app/activity-summary.js";
import { withPromptProvenance } from "../app/prompt-provenance.js";
import { PLANNING_GUIDANCE } from "../app/trust-policy.js";
import { createRequestId } from "../telemetry/correlation.js";
import { normalizeLifecycleEvent } from "../telemetry/event-normalizer.js";
import {
  RuntimeEventBridge,
  OperationStoppedError,
  type RuntimeUiBridgeEvent
} from "./bind-runtime-events.js";
import { applyTransition, createEmptyHandoffState } from "./handoff-state-machine.js";
import { WorkflowOrchestrator, createWorkflowHandoffEnvelope } from "./workflow-orchestrator.js";
import {
  createRoleRuntime,
  getDefaultSessionRoot,
  getRoleSessionDirectory,
  type RoleRuntimeBinding,
  type SupportedThinkingLevel
} from "../runtime/create-role-runtime.js";
import { readSessionHistory } from "../runtime/session-history.js";
import { cleanupAll } from "../runtime/cleanup.js";
import { RuntimeRegistry } from "../runtime/runtime-registry.js";
import { applyRuntimeOperation, type RuntimeReplacementAction } from "../runtime/runtime-operations.js";
import { getRuntimeHealth } from "../runtime/runtime-health.js";
import { TelemetryLogger } from "../telemetry/logger.js";
import { Metrics } from "../telemetry/metrics.js";
import { createPersistencePaths } from "../persistence/checkpoints.js";
import { RecoveryLoader } from "../persistence/recovery-loader.js";
import { SessionLedger } from "../persistence/session-ledger.js";
import { createHandoffId } from "../handoff/handoff-id.js";
import {
  COMPLETION_BLOCK_TYPE,
  PLAN_BLOCK_TYPE,
  EXECUTE_BLOCK_TYPE,
  FINAL_BLOCK_TYPE,
  HANDOFF_BLOCK_TYPE,
  extractAssistantText,
  maybeParseExecutionPlanEnvelope,
  maybeParsePlanProposalEnvelope
} from "../handoff/handoff-envelope.js";
import { loadResolvedMcpConfig } from "../mcp/config-loader.js";
import type { ResolvedMcpConfig } from "../mcp/types.js";
import type { HandoffRecord } from "../types/handoff.js";
import type { Role } from "../types/role.js";
import type { NormalizedTelemetryEvent } from "../types/telemetry.js";
import type { CoordinatorStatusSnapshot, CoordinatorUiPhase } from "../types/status.js";
import type {
  CoordinatorTurnResult,
  ConversationMode,
  PendingExecutionPlanSnapshot,
  WorkflowSnapshot,
  WorkflowState
} from "../types/workflow.js";
import { isWorkflowTerminal } from "../types/workflow.js";

export interface CoordinatorOptions {
  cwd: string;
  agentDir?: string;
  sessionRoot?: string;
  sessionMode: "persistent" | "memory";
  jsonLogs: boolean;
  verbose: boolean;
  modelA?: string;
  modelB?: string;
  thinkingA?: SupportedThinkingLevel;
  thinkingB?: SupportedThinkingLevel;
  maxReviewRounds?: number;
  mcpEnabled?: boolean;
  mcpConfigPaths?: string[];
  supersedeRecoveredWorkflowOnStart?: boolean;
  timeoutMs?: number;
  createRoleRuntime?: typeof createRoleRuntime;
  localModels?: LocalModelHost;
  stdout?: NodeJS.WriteStream;
  stderr?: NodeJS.WriteStream;
}

export class Coordinator {
  private readonly registry = new RuntimeRegistry();
  private readonly metrics = new Metrics();
  private readonly sessionRoot: string;
  private readonly ledger: SessionLedger;
  private readonly logger: TelemetryLogger;
  private readonly recoveryLoader: RecoveryLoader;
  private readonly workflowOrchestrator: WorkflowOrchestrator;
  private readonly runtimeFactory: typeof createRoleRuntime;
  private readonly eventBridge: RuntimeEventBridge;
  private resolvedMcpConfig: ResolvedMcpConfig = {
    enabled: false,
    projectRoot: "",
    cacheFile: "",
    configSources: [],
    servers: []
  };
  private workflowState: WorkflowState = createEmptyHandoffState();
  private lastSummary: string | undefined;
  private responseProgress: ResponseProgress | undefined;
  private pendingPlan: PendingExecutionPlanSnapshot | undefined;
  private uiState: { phase: CoordinatorUiPhase; activeRole: Role } = {
    phase: "planning",
    activeRole: "A"
  };
  private activeOperation: { controller: AbortController; id: string; done: Promise<void>; finish(): void; stopping?: Promise<PromiseSettledResult<void>[]>; outcome: "cancelled" | "timed_out" } | undefined;
  private operatorTurnId: string | undefined;
  private readonly requestTurns = new Map<string, string>();
  private operationKind: NonNullable<CoordinatorStatusSnapshot["operation"]>["kind"] = "idle";
  private disposed = false;
  private configuring = false;
  private configurationController: AbortController | undefined;
  private readonly localModels: LocalModelHost | undefined;
  private readonly discoveredModels = new Map<string, Model<"openai-completions">>();
  private localModelUnavailable = false;
  private configurationDone = Promise.resolve();
  private finishConfiguration = () => {};
  private readonly runtimeActivity = new Map<Role, ActivitySnapshot>();
  private readonly lastToolNames = new Map<Role, string>();
  private coordinatorActivity: ActivitySnapshot | undefined;
  private readonly unsubscribeActivityListener: () => void;

  public constructor(private readonly options: CoordinatorOptions) {
    if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 2_147_483_647)) throw new Error("Timeout must be a positive whole number within the supported timer range.");
    this.sessionRoot = options.sessionRoot ?? getDefaultSessionRoot(options.cwd);
    const paths = createPersistencePaths(this.sessionRoot);
    this.ledger = new SessionLedger(paths.ledgerFile);
    this.logger = new TelemetryLogger({
      filePath: paths.telemetryFile,
      jsonLogs: options.jsonLogs,
      verbose: options.verbose,
      stdout: options.stdout,
      stderr: options.stderr
    });
    this.recoveryLoader = new RecoveryLoader(this.ledger);
    this.runtimeFactory = options.createRoleRuntime ?? createRoleRuntime;
    this.localModels = options.localModels ?? (options.createRoleRuntime ? undefined : new LmStudioModels());
    this.eventBridge = new RuntimeEventBridge(this.logger, this.metrics);
    this.workflowOrchestrator = new WorkflowOrchestrator(
      this.ledger,
      this.eventBridge,
      this.logger,
      this.metrics,
      (phase, role) => {
        this.uiState = { phase, activeRole: role };
      },
      (state) => {
        this.workflowState = state;
      }
    );
    this.unsubscribeActivityListener = this.logger.subscribe((event) => {
      this.observeActivityEvent(event);
    });
  }

  public async start(onProgress?: (role: Role, progress: ModelSwitchProgress) => void): Promise<void> {
    const controller = this.beginConfiguration();
    try {
      this.workflowState = await this.recoveryLoader.load();
      const lastResponse = this.getHistoryEvents().events.reverse().find((event) => event.eventType.startsWith("response."));
      const restoredProgress = responseProgressSchema.safeParse(lastResponse?.details);
      if (restoredProgress.success) this.responseProgress = restoredProgress.data;
      this.resolvedMcpConfig = await loadResolvedMcpConfig({
        cwd: this.options.cwd,
        agentDir: this.options.agentDir ?? getAgentDir(),
        enabled: this.options.mcpEnabled ?? false,
        explicitConfigPaths: this.options.mcpConfigPaths
      });
      const bindingA = await this.runtimeFactory({
        role: "A",
        cwd: this.options.cwd,
        agentDir: this.options.agentDir,
        sessionRoot: this.sessionRoot,
        modelOverride: this.options.modelA,
        thinkingOverride: this.options.thinkingA,
        sessionMode: this.options.sessionMode,
        mcp: this.resolvedMcpConfig
      });
      this.registry.set(bindingA);
      let prepared: PreparedLocalModel | undefined;
      try {
        if (this.localModels) {
          prepared = await this.localModels.prepare((this.options.modelB ?? EXECUTION_MODEL).replace(/^lm-studio\//, ""), undefined,
            controller.signal, (progress) => onProgress?.("B", progress));
          this.discoveredModels.set(prepared.model.id, prepared.model);
        }
        controller.signal.throwIfAborted();
        const bindingB = await this.runtimeFactory({
          role: "B",
          cwd: this.options.cwd,
          agentDir: this.options.agentDir,
          sessionRoot: this.sessionRoot,
          modelOverride: this.options.modelB,
          localModel: prepared?.model,
          thinkingOverride: this.options.thinkingB,
          sessionMode: this.options.sessionMode,
          mcp: this.resolvedMcpConfig
        });
        this.registry.set(bindingB);
        controller.signal.throwIfAborted();
        await this.eventBridge.bind(bindingA);
        await this.eventBridge.bind(bindingB);
        controller.signal.throwIfAborted();
        this.setUiState("planning", "A");
        await this.supersedeRecoveredWorkflowOnStartIfNeeded();
        controller.signal.throwIfAborted();
        prepared?.commit();
      } catch (error) {
        await cleanupAll([() => prepared?.rollback(), () => this.registry.disposeAll()]);
        throw error;
      }
    } finally { this.endConfiguration(); }
  }

  public submitUserInput(text: string): Promise<CoordinatorTurnResult> {
    return this.runOperation(() => this.submitUserInputInternal(text), text);
  }

  private async submitUserInputInternal(text: string): Promise<CoordinatorTurnResult> {
    this.clearAllActivity();
    const activeWorkflow = this.getActiveWorkflow();
    if (activeWorkflow && !isWorkflowTerminal(activeWorkflow.status)) {
      throw new Error(
        `Cannot start a new task while workflow ${activeWorkflow.workflowId} is still active. Rebind a runtime to supersede it first, or resolve the existing workflow.`
      );
    }

    const bindingA = this.requireBinding("A");
    const bindingB = this.requireBinding("B");
    const requestId = createRequestId();
    if (this.operatorTurnId) this.requestTurns.set(requestId, this.operatorTurnId);
    this.eventBridge.setRequestId("A", requestId);
    this.eventBridge.setRequestId("B", requestId);
    this.lastSummary = undefined;
    this.pendingPlan = undefined;

    try {
      this.setUiState("planning", "A");
      const planningOutcome = await this.submitPlanningTurn({
        bindingA,
        requestId,
        userInput: text
      });

      if (planningOutcome.kind === "planning") {
        await this.eventBridge.waitForIdle();
        this.setUiState("planning", "A");
        return {
          mode: "planning",
          userResponse: planningOutcome.userResponse
        };
      }

      if (planningOutcome.kind === "plan") {
        this.pendingPlan = createPendingExecutionPlanSnapshot(
          planningOutcome.plan,
          requestId
        );
        this.logPlanningLifecycleEvent("planning.plan_ready", bindingA, requestId, {
          objective: this.pendingPlan.objective,
          summary: this.pendingPlan.summary,
          relevantPaths: this.pendingPlan.relevantPaths,
          acceptanceCriteria: this.pendingPlan.acceptanceCriteria,
          executionPlan: this.pendingPlan.executionPlan,
          constraints: this.pendingPlan.constraints,
          proposedAt: this.pendingPlan.proposedAt
        });
        await this.eventBridge.waitForIdle();
        this.setUiState("planning", "A");
        return {
          mode: "planning",
          userResponse: planningOutcome.userResponse,
          pendingPlan: this.pendingPlan,
          nextActionHint: buildPendingPlanHint()
        };
      }

      try {
        const { result } = await this.executeApprovedPlan({
          bindingA,
          bindingB,
          requestId,
          executionPlan: planningOutcome.executionPlan
        });
        this.workflowState = await this.recoveryLoader.load();
        this.lastSummary = result.finalSummary;
        await this.eventBridge.waitForIdle();
        this.setUiState("planning", "A");
        return {
          mode: "planning",
          userResponse: result.userResponse,
          workflow: {
            workflowId: result.workflowId,
            status: result.status,
            iterations: result.iterations,
            finalSummary: result.finalSummary,
            changedPaths: result.changedPaths,
            requestId: result.requestId
          }
        };
      } finally {
        this.setUiState("planning", "A");
      }
    } finally {
      this.eventBridge.setRequestId("A", undefined);
      this.eventBridge.setRequestId("B", undefined);
    }
  }

  public approvePendingPlan(): Promise<CoordinatorTurnResult> {
    return this.runOperation(() => this.approvePendingPlanInternal(), this.pendingPlan?.objective ?? "Approve plan", this.pendingPlan ? this.requestTurns.get(this.pendingPlan.requestId) : undefined);
  }

  private async approvePendingPlanInternal(): Promise<CoordinatorTurnResult> {
    this.clearAllActivity();
    const activeWorkflow = this.getActiveWorkflow();
    if (activeWorkflow && !isWorkflowTerminal(activeWorkflow.status)) {
      throw new Error(
        `Cannot approve a pending plan while workflow ${activeWorkflow.workflowId} is still active.`
      );
    }
    if (!this.pendingPlan) {
      throw new Error("No pending plan is available. Ask Agent A for a plan first.");
    }

    const bindingA = this.requireBinding("A");
    const bindingB = this.requireBinding("B");
    const pendingPlan = this.pendingPlan;
    this.pendingPlan = undefined;
    this.lastSummary = undefined;
    this.eventBridge.setRequestId("A", pendingPlan.requestId);
    this.eventBridge.setRequestId("B", pendingPlan.requestId);

    try {
      this.logPlanningLifecycleEvent("planning.plan_approved", bindingA, pendingPlan.requestId, {
        objective: pendingPlan.objective,
        summary: pendingPlan.summary,
        proposedAt: pendingPlan.proposedAt
      });
      const { result } = await this.executeApprovedPlan({
        bindingA,
        bindingB,
        requestId: pendingPlan.requestId,
        executionPlan: createExecutionPlanEnvelopeFromPendingPlan(pendingPlan)
      });
      this.workflowState = await this.recoveryLoader.load();
      this.lastSummary = result.finalSummary;
      await this.eventBridge.waitForIdle();
      this.setUiState("planning", "A");
      return {
        mode: "planning",
        userResponse: result.userResponse,
        workflow: {
          workflowId: result.workflowId,
          status: result.status,
          iterations: result.iterations,
          finalSummary: result.finalSummary,
          changedPaths: result.changedPaths,
          requestId: result.requestId
        }
      };
    } finally {
      this.eventBridge.setRequestId("A", undefined);
      this.eventBridge.setRequestId("B", undefined);
      this.setUiState("planning", "A");
    }
  }

  public discardPendingPlan(): void {
    this.assertIdle();
    if (!this.pendingPlan) {
      return;
    }
    const bindingA = this.registry.get("A");
    const requestId = this.pendingPlan.requestId;
    this.pendingPlan = undefined;
    if (bindingA) {
      this.logPlanningLifecycleEvent("planning.plan_discarded", bindingA, requestId);
    } else {
      this.coordinatorActivity = undefined;
    }
  }

  public async replaceRuntime(role: Role, action: RuntimeReplacementAction): Promise<void> {
    this.assertIdle();
    this.beginConfiguration();
    try {
      await this.replaceRuntimeInternal(role, action);
    } finally { this.endConfiguration(); }
  }

  private async replaceRuntimeInternal(role: Role, action: RuntimeReplacementAction): Promise<void> {
    const binding = this.requireBinding(role);
    const updated = await applyRuntimeOperation(binding, action);
    this.registry.set(updated);
    await this.eventBridge.bind(updated);
    this.pendingPlan = undefined;
    this.runtimeActivity.delete(role);
    this.lastToolNames.delete(role);
    this.coordinatorActivity = undefined;
    await this.supersedeActiveWorkflowIfNeeded(role, updated);
    await this.eventBridge.waitForIdle();
    if (action.type === "new") {
      this.lastSummary = undefined;
      this.operationKind = "idle";
      this.setUiState("planning", "A");
      this.clearAllActivity();
      this.logger.log(normalizeLifecycleEvent({
        role, sessionId: updated.sessionId, sessionFile: updated.sessionFile,
        eventType: "ui.conversation_reset"
      }));
    }
  }

  public getStatus(): CoordinatorStatusSnapshot {
    const list = this.registry.list().map((binding) => {
      const health = getRuntimeHealth(binding);
      const snapshot = this.runtimeActivity.get(binding.role);
      return {
        ...health,
        ...(binding.role === "B" && this.localModelUnavailable ? { healthy: false } : {}),
        currentActivity: snapshot ? renderActivityText(snapshot) : undefined,
        currentReason: snapshot ? renderReasonText(snapshot) : undefined,
        currentTarget: snapshot?.target,
        lastToolName: this.lastToolNames.get(binding.role)
      };
    });
    const workflow = this.getActiveWorkflow() ?? this.getLatestWorkflowSnapshot();
    const activeRuntime =
      list.find((runtime) => runtime.role === this.uiState.activeRole) ?? list[0];
    const phaseLabel = labelPhase(this.uiState.phase);
    const activeSnapshot = this.runtimeActivity.get(this.uiState.activeRole);

    return {
      operation: { kind: this.operationKind },
      cwd: this.options.cwd,
      conversationMode: this.getConversationMode(),
      phase: this.uiState.phase,
      phaseLabel,
      activeRole: this.uiState.activeRole,
      activeRoleLabel: labelRole(this.uiState.activeRole),
      activeModelName: activeRuntime?.modelName,
      activeModelProvider: activeRuntime?.modelProvider,
      activeModelId: activeRuntime?.modelId,
      activeModelCanonical: activeRuntime?.modelCanonical,
      activeModelDisplay: activeRuntime?.modelDisplay ?? "(pi-default)",
      sessionRoot: this.options.sessionMode === "memory" ? "(memory)" : this.sessionRoot,
      lastSummary: this.lastSummary,
      pendingPlan: this.pendingPlan,
      pendingPlanReady: Boolean(this.pendingPlan),
      nextActionHint: this.pendingPlan ? buildApproveStatusHint() : undefined,
      activeWorkflowId: this.workflowState.activeWorkflowId,
      currentIteration: workflow?.currentIteration,
      workflowStatus: workflow?.status,
      currentActivity: activeSnapshot ? renderActivityText(activeSnapshot) : undefined,
      currentReason: activeSnapshot ? renderReasonText(activeSnapshot) : undefined,
      currentTarget: activeSnapshot?.target,
      coordinatorActivity: this.coordinatorActivity
        ? renderActivityText(this.coordinatorActivity)
        : undefined,
      coordinatorReason: this.coordinatorActivity
        ? renderReasonText(this.coordinatorActivity)
        : undefined,
      lastCompletionSummary: workflow?.latestCompletion?.summary,
      responseProgress: this.responseProgress,
      repairCount: this.responseProgress?.responseKind === "planning" ? this.responseProgress.repairCount : workflow?.repairCount ?? 0,
      maxReviewRounds: this.options.maxReviewRounds ?? 3,
      timeoutMs: this.options.timeoutMs ?? 600_000,
      runtimes: list,
      mcp: {
        enabled: this.resolvedMcpConfig.enabled,
        configSources: [...this.resolvedMcpConfig.configSources],
        roleA:
          this.registry.get("A")?.getMcpStatus?.() ?? {
            role: "A",
            enabled: this.resolvedMcpConfig.enabled,
            servers: []
          },
        roleB:
          this.registry.get("B")?.getMcpStatus?.() ?? {
            role: "B",
            enabled: this.resolvedMcpConfig.enabled,
            servers: []
          }
      },
      metrics: this.metrics.snapshot()
    };
  }

  public getHistoryEvents() { return loadHistoryEvents(join(this.sessionRoot, "logs", "coordinator.jsonl")); }

  public async getRunArchive(run: Extract<HistoryRecord, { kind: "run" }>) {
    if (!run.sessionFile) {
      const binding = this.registry.get(run.role);
      if (!binding || binding.sessionId !== run.sessionId) throw new Error("Output unavailable: memory session was replaced or restarted.");
      const entries = binding.session.sessionManager?.getEntries?.() ?? [];
      const archive = { header: { type: "session", id: run.sessionId, timestamp: run.timestamp }, entries, byId: new Map(entries.map((entry) => [entry.id, entry])) };
      return archiveRunEntries(archive, run.id);
    }
    const directory = await realpath(getRoleSessionDirectory(this.options.cwd, run.role, this.sessionRoot));
    const canonical = await realpath(run.sessionFile);
    const candidate = relative(directory, canonical);
    if (candidate.startsWith("..") || isAbsolute(candidate) || !candidate.endsWith(".jsonl")) throw new Error("History must stay inside this role's private session directory.");
    const archive = readSessionArchive(canonical);
    if (archive.header.id !== run.sessionId || archive.header.cwd !== this.options.cwd) throw new Error("Session identity mismatch.");
    return archiveRunEntries(archive, run.id);
  }

  public getAvailableModels(role?: Role): Array<{ canonical: string; name: string; reasoning: boolean; thinkingLevels: SupportedThinkingLevel[] }> {
    const discovered = [...this.discoveredModels.values()];
    return createSecureModelCatalog(discovered).getAll()
      .filter((model) => role ? isRoleModel(role, model, discovered) : isRoleModel("A", model) || isRoleModel("B", model, discovered))
      .map((model) => ({ canonical: `${model.provider}/${model.id}`, name: model.name, reasoning: model.reasoning, thinkingLevels: !model.reasoning ? ["off"] : gptModelChoices.some((current) => current.id === model.id) ? ["low", "medium", "high"] : getSupportedThinkingLevels(model).includes("xhigh") ? ["off", "minimal", "low", "medium", "high", "xhigh"] : ["off", "minimal", "low", "medium", "high"] }));
  }

  public async getModelPickerCatalog(role: Role, signal?: AbortSignal): Promise<ModelPickerCatalog> {
    const current = this.registry.get(role);
    const models = role === "A" ? gptModelChoices.map((model) => ({ canonical: `openai/${model.id}`, name: model.name, description: model.description }))
      : this.localModels ? (await this.localModels.listModels(signal)).map((item) => {
        this.discoveredModels.set(item.model.id, item.model);
        return { canonical: `lm-studio/${item.model.id}`, name: item.model.name, description: item.description, loaded: item.loaded, disabledReason: item.disabledReason };
      }) : this.getAvailableModels("B").map((model) => ({ canonical: model.canonical, name: model.name, description: "Local LM Studio model", loaded: true }));
    return { role, models, currentModel: current?.session.model ? `${current.session.model.provider}/${current.session.model.id}` : undefined, currentThinking: current?.session.thinkingLevel };
  }

  public async getSavedSessions(role: Role) {
    if (this.options.sessionMode === "memory") return [];
    return SessionManager.list(this.options.cwd, getRoleSessionDirectory(this.options.cwd, role, this.sessionRoot));
  }

  public async getSessionHistory(role: Role, path: string): Promise<AgentMessage[]> {
    const directory = await realpath(getRoleSessionDirectory(this.options.cwd, role, this.sessionRoot));
    const canonical = await realpath(path);
    const candidate = relative(directory, canonical);
    if (candidate.startsWith("..") || isAbsolute(candidate) || !candidate.endsWith(".jsonl")) throw new Error("History must stay inside this role's private session directory.");
    return readSessionHistory(canonical).messages;
  }

  public async configureRole(role: Role, input: { model?: string; thinking?: SupportedThinkingLevel; save: boolean }, onProgress?: (progress: ModelSwitchProgress) => void): Promise<void> {
    this.assertIdle();
    const controller = this.beginConfiguration();
    let replacement: RoleRuntimeBinding | undefined;
    let prepared: PreparedLocalModel | undefined;
    let committed = false;
    let previous: RoleRuntimeBinding | undefined;
    let bindingAttempted = false;
    const signal = controller.signal;
    try {
      previous = this.requireBinding(role);
      const model = input.model ?? `${previous.session.model?.provider}/${previous.session.model?.id}`;
      if (role === "B" && this.localModels) await this.getModelPickerCatalog("B", signal);
      const selected = this.getAvailableModels(role).find((candidate) => candidate.canonical === model);
      if (!selected) throw new Error(`Choose ${role === "A" ? "an approved OpenAI Responses" : "a local LM Studio"} model from /model ${role}.`);
      const previousThinking = previous.session.thinkingLevel;
      const thinking = input.thinking ?? selected.thinkingLevels.find((level) => level === previousThinking) ?? (selected.reasoning ? "high" : "off");
      if (!selected.thinkingLevels.includes(thinking)) throw new Error(`Supported thinking levels for this model: ${selected.thinkingLevels.join(", ")}`);
      if (role === "B" && this.localModels) {
        prepared = await this.localModels.prepare(model.replace(/^lm-studio\//, ""), previous.session.model?.id, signal, (progress) => onProgress?.(progress));
      }
      signal.throwIfAborted();
      onProgress?.({ phase: "applying", message: `Preparing Agent ${role}'s conversation and ${thinking} reasoning…` });
      replacement = await this.runtimeFactory({ role, cwd: this.options.cwd, agentDir: this.options.agentDir,
        sessionRoot: this.sessionRoot, sessionMode: this.options.sessionMode,
        modelOverride: model, localModel: prepared?.model, thinkingOverride: thinking, mcp: this.resolvedMcpConfig,
        initialSessionManager: previous.session.sessionManager instanceof SessionManager ? previous.session.sessionManager : undefined });
      signal.throwIfAborted();
      bindingAttempted = true;
      await this.eventBridge.bind(replacement);
      signal.throwIfAborted();
      if (input.save) {
        const loaded = await loadCoordinatorConfig();
        if (loaded.warnings.length) throw new Error("Resolve coordinator config warnings before saving defaults.");
        await writeCoordinatorConfig({
          ...loaded.config,
          version: 1,
          defaults: {
            ...loaded.config?.defaults,
            ...(role === "A" ? { modelA: model, thinkingA: thinking } : { modelB: model, thinkingB: thinking })
          }
        });
      }
      this.registry.set(replacement);
      committed = true;
      prepared?.commit();
      if (role === "B") this.localModelUnavailable = false;
      replacement = undefined;
      if (role === "A") { this.options.modelA = model; this.options.thinkingA = thinking; }
      else { this.options.modelB = model; this.options.thinkingB = thinking; }
      this.pendingPlan = undefined;
      this.clearAllActivity();
      await previous.dispose();
    } catch (error) {
      if (error instanceof LocalModelSwitchError && error.recovery === "unavailable") this.localModelUnavailable = true;
      const discarded = replacement; replacement = undefined;
      let recoveryError: LocalModelSwitchError | undefined;
      let cleanupError: unknown;
      try { await cleanupAll([
        async () => {
          if (!committed && prepared) {
            try { await prepared.rollback(); }
            catch {
              this.localModelUnavailable = true;
              recoveryError = new LocalModelSwitchError("The model switch failed and the previous local model could not be restored. Choose Agent B's model again before continuing.", signal.aborted, "unavailable");
            }
          }
        },
        () => !committed && bindingAttempted && previous ? this.eventBridge.bind(previous) : undefined,
        () => discarded?.dispose()
      ]); } catch (failure) { cleanupError = failure; }
      if (recoveryError) throw recoveryError;
      if (cleanupError) throw cleanupError;
      if (signal.aborted && !(error instanceof LocalModelSwitchError)) throw new LocalModelSwitchError("Model switch cancelled. Previous model state restored.", true, "restored");
      throw error;
    } finally {
      try { await replacement?.dispose(); }
      finally { this.endConfiguration(); }
    }
  }

  public async configureDefaults(key: "review-rounds" | "timeout-ms", value: number, save: boolean): Promise<void> {
    this.assertIdle();
    if (!Number.isSafeInteger(value) || value <= 0 || (key === "timeout-ms" && value > 2_147_483_647)) throw new Error("Use a positive whole number within the supported timer range.");
    this.beginConfiguration();
    try {
      if (save) {
        const loaded = await loadCoordinatorConfig();
        if (loaded.warnings.length) throw new Error("Resolve coordinator config warnings before saving defaults.");
        await writeCoordinatorConfig({ ...loaded.config, version: 1, defaults: { ...loaded.config?.defaults,
          ...(key === "review-rounds" ? { maxReviewRounds: value } : { timeoutMs: value }) } });
      }
      if (key === "review-rounds") this.options.maxReviewRounds = value;
      else this.options.timeoutMs = value;
    } finally { this.endConfiguration(); }
  }

  public getSessions(): ReturnType<typeof getRuntimeHealth>[] {
    return this.registry.list().map(getRuntimeHealth);
  }

  public subscribeEvents(listener: (event: NormalizedTelemetryEvent) => void): () => void {
    return this.logger.subscribe(listener);
  }

  public subscribeRuntimeUiEvents(
    listener: (event: RuntimeUiBridgeEvent) => void
  ): () => void {
    return this.eventBridge.subscribeUiEvents(listener);
  }

  public async getWorkflowStatus(): Promise<{
    state: WorkflowState;
    workflow?: ReturnType<Coordinator["selectVisibleWorkflow"]> | undefined;
    ledgerTail?: HandoffRecord | undefined;
  }> {
    const ledgerTail = await this.ledger.latest();
    return {
      state: this.workflowState,
      workflow: this.selectVisibleWorkflow(),
      ledgerTail
    };
  }

  public async getLastHandoff(): Promise<{
    state: WorkflowState;
    workflow?: ReturnType<Coordinator["selectVisibleWorkflow"]> | undefined;
    ledgerTail?: HandoffRecord | undefined;
  }> {
    return this.getWorkflowStatus();
  }

  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await cleanupAll([() => this.cancelActive(), () => this.configurationDone,
      () => this.unsubscribeActivityListener(), () => this.eventBridge.dispose(), () => this.registry.disposeAll()]);
  }

  public async cancelActive(reason: "cancelled" | "timed_out" = "cancelled"): Promise<void> {
    if (this.configurationController) {
      this.configurationController.abort();
      await this.configurationDone;
    }
    const operation = this.activeOperation;
    if (!operation) return;
    if (!operation.stopping) {
      operation.outcome = reason;
      this.operationKind = "cancelling";
      operation.controller.abort();
      operation.stopping = Promise.allSettled(this.registry.list().map(async (binding) => binding.session.abort()));
    }
    await operation.stopping;
    await operation.done;
  }

  private beginConfiguration(): AbortController {
    if (this.disposed) throw new Error("Coordinator disposed.");
    this.configuring = true;
    this.configurationController = new AbortController();
    this.configurationDone = new Promise<void>((resolve) => { this.finishConfiguration = resolve; });
    return this.configurationController;
  }

  private endConfiguration(): void {
    this.configuring = false;
    this.configurationController = undefined;
    this.finishConfiguration();
  }

  private assertIdle(): void {
    if (this.activeOperation || this.configuring) throw new Error("Work is running. Use /cancel before changing workflow or runtime settings.");
  }

  private async runOperation(run: () => Promise<CoordinatorTurnResult>, objective: string, originatingTurnId?: string): Promise<CoordinatorTurnResult> {
    this.assertIdle();
    if (this.localModelUnavailable) throw new Error("Agent B's local model is unavailable. Choose a model with F3 or /model B before continuing.");
    if (this.disposed) throw new Error("Coordinator disposed.");
    const controller = new AbortController();
    let finish = () => {};
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const operation: NonNullable<typeof this.activeOperation> = { controller, id: createRequestId(), done, finish, outcome: "cancelled" };
    this.activeOperation = operation;
    this.operationKind = "running";
    this.responseProgress = undefined;
    this.operatorTurnId = originatingTurnId ?? randomUUID();
    this.eventBridge.setOperatorTurn(this.operatorTurnId);
    const logTurn = (eventType: string, details: Record<string, unknown>) => {
      const binding = this.requireBinding("A");
      this.logger.log({ ...normalizeLifecycleEvent({ role: "A", sessionId: binding.sessionId, sessionFile: binding.sessionFile, eventType, details }), operatorTurnId: this.operatorTurnId });
    };
    logTurn("ui.turn_started", { objective: safeDisplayText(objective) });
    this.eventBridge.beginOperation(controller.signal);
    const timeoutMs = this.options.timeoutMs ?? 600_000;
    const timer = timeoutMs > 0 ? setTimeout(() => { void this.cancelActive("timed_out"); }, timeoutMs) : undefined;
    try {
      const result = await run();
      this.eventBridge.assertActive();
      if (result.workflow?.status === "blocked" || result.workflow?.status === "capped") {
        await Promise.all(this.registry.list().map((binding) => binding.session.abort()));
      }
      this.operationKind = result.workflow?.status === "blocked" || result.workflow?.status === "capped" ? "failed" : "completed";
      return result;
    } catch (error) {
      if (!controller.signal.aborted) {
        controller.abort();
        operation.stopping = Promise.allSettled(this.registry.list().map(async (binding) => binding.session.abort()));
      }
      const stopped = await operation.stopping;
      const cleanupFailed = stopped?.some((result) => result.status === "rejected") ?? false;
      this.pendingPlan = undefined;
      const status = !cleanupFailed && error instanceof OperationStoppedError ? operation.outcome : "failed";
      const workflow = this.getActiveWorkflow();
      const binding = this.requireBinding(this.uiState.activeRole);
      await this.ledger.append({ workflowId: error instanceof ResponseRepairExhaustedError ? error.details.workflowId ?? error.details.requestId : workflow?.workflowId ?? operation.id,
        iteration: workflow?.currentIteration ?? 0, requestId: error instanceof ResponseRepairExhaustedError ? error.details.requestId : workflow?.requestId ?? operation.id,
        status, role: "coordinator", sessionId: binding.sessionId, sessionFile: binding.sessionFile,
        timestamp: new Date().toISOString(), details: { reason: error instanceof Error ? error.message : String(error), preservedChanges: true,
          ...(error instanceof ResponseRepairExhaustedError ? error.details : {}) } });
      this.workflowState = await this.recoveryLoader.load();
      this.operationKind = status;
      this.lastSummary = `${status === "timed_out" ? "Deadline exceeded" : status === "cancelled" ? "Work cancelled" : "Work failed"}. Completed file changes are preserved. Submit explicitly to run again.`;
      if (status === "failed") throw cleanupFailed ? new Error("Runtime cancellation cleanup failed. Inspect status and file changes before retrying.") : error;
      return { mode: "planning", userResponse: this.lastSummary };
    } finally {
      if (timer) clearTimeout(timer);
      this.setUiState("planning", "A");
      this.clearAllActivity();
      logTurn("ui.turn_finished", { outcome: this.pendingPlan ? "waiting_approval" : this.operationKind });
      this.activeOperation = undefined;
      operation.finish();
    }
  }

  private requireBinding(role: Role): RoleRuntimeBinding {
    const binding = this.registry.get(role);
    if (!binding) {
      throw new Error(`No runtime binding for role ${role}`);
    }
    return binding;
  }

  private selectVisibleWorkflow():
    | {
        workflowId: string;
        status: string;
        currentIteration: number;
        latestHandoffId?: string | undefined;
        latestCompletionSummary?: string | undefined;
        finalDecision?: string | undefined;
      }
    | undefined {
    const workflow = this.getActiveWorkflow() ?? this.getLatestWorkflowSnapshot();
    if (!workflow) {
      return undefined;
    }
    return {
      workflowId: workflow.workflowId,
      status: workflow.status,
      currentIteration: workflow.currentIteration,
      latestHandoffId: workflow.latestHandoff?.handoffId,
      latestCompletionSummary: workflow.latestCompletion?.summary,
      finalDecision: workflow.finalDecision?.decision
    };
  }

  private getActiveWorkflow(): WorkflowSnapshot | undefined {
    const id = this.workflowState.activeWorkflowId;
    if (!id) {
      return undefined;
    }
    return this.workflowState.workflows[id];
  }

  private getLatestWorkflowSnapshot(): WorkflowSnapshot | undefined {
    const id = this.workflowState.latestWorkflowId;
    if (!id) {
      return undefined;
    }
    return this.workflowState.workflows[id];
  }

  private async submitPlanningTurn(options: {
    bindingA: RoleRuntimeBinding;
    requestId: string;
    userInput: string;
  }): Promise<
    | { kind: "planning"; userResponse: string }
    | { kind: "plan"; userResponse: string; plan: NonNullable<ReturnType<typeof maybeParsePlanProposalEnvelope>> }
    | { kind: "execute"; executionPlan: NonNullable<ReturnType<typeof maybeParseExecutionPlanEnvelope>> }
  > {
    let originalBlock: "pi-plan" | "pi-execute" | undefined;
    return repairResponse({ bridge: this.eventBridge, binding: options.bindingA, kind: "planning",
      identifiers: { requestId: options.requestId },
      shape: "Nonempty planning prose, or exactly one fenced pi-plan or pi-execute JSON block. pi-plan requires operator approval; never convert it to pi-execute. " + responseShape(planProposalEnvelopeSchema, executionPlanEnvelopeSchema),
      submit: (responseId) => this.eventBridge.promptAndWaitForTurnEnd(options.bindingA,
        withPromptProvenance("planning_user", renderPlanningTurnMessage(options.userInput), { requestId: options.requestId, sessionRole: "A" }), { responseId }),
      onFormatFailure: (error, attempt) => {
        if (attempt === 1 && (error.toolName === "pi-plan" || error.toolName === "pi-execute")) originalBlock = error.toolName;
      },
      validate: (message, attempt) => {
        if (attempt === 1) {
          const text = extractAssistantText(message);
          if (countMachineBlocks(text, PLAN_BLOCK_TYPE) === 1) originalBlock = "pi-plan";
          else if (countMachineBlocks(text, EXECUTE_BLOCK_TYPE) === 1) originalBlock = "pi-execute";
        }
        const response = resolvePlanningTurn(message);
        if (attempt > 1 && response.kind === "execute" && originalBlock !== "pi-execute") {
          return { reason: "Format repair cannot introduce execution approval. Return planning prose or pi-plan for operator approval." };
        }
        return response.kind === "invalid_machine_block" ? { reason: response.reason } : { value: response };
      },
      onProgress: () => this.setUiState("repair", "A"),
      onRepair: async (progress) => {
        const record: HandoffRecord = { workflowId: progress.requestId, iteration: 0, status: "repair_requested", role: "coordinator",
          requestId: progress.requestId, sessionId: options.bindingA.sessionId, sessionFile: options.bindingA.sessionFile,
          timestamp: new Date().toISOString(), details: { ...progress } };
        await this.ledger.append(record);
        this.workflowState = applyTransition(this.workflowState, record);
      }
    });
  }

  private async executeApprovedPlan(options: {
    bindingA: RoleRuntimeBinding;
    bindingB: RoleRuntimeBinding;
    requestId: string;
    executionPlan: NonNullable<ReturnType<typeof maybeParseExecutionPlanEnvelope>>;
  }) {
    try {
      return await this.startExecutionFromPlan(options);
    } finally {
      this.setUiState("planning", "A");
    }
  }

  private async startExecutionFromPlan(options: {
    bindingA: RoleRuntimeBinding;
    bindingB: RoleRuntimeBinding;
    requestId: string;
    executionPlan: NonNullable<ReturnType<typeof maybeParseExecutionPlanEnvelope>>;
  }) {
    const workflowId = randomUUID();
    const handoffId = createHandoffId();
    const initialEnvelope = createWorkflowHandoffEnvelope({
      workflowId,
      handoffId,
      iteration: 1,
      requestId: options.requestId,
      objective: options.executionPlan.objective,
      summary: options.executionPlan.summary,
      acceptanceCriteria: options.executionPlan.acceptanceCriteria,
      relevantPaths: options.executionPlan.relevantPaths,
      executionPlan: options.executionPlan.executionPlan,
      reviewNotes: [],
      constraints: options.executionPlan.constraints
    });

    return this.workflowOrchestrator.runFromApprovedPlan({
      bindingA: options.bindingA,
      bindingB: options.bindingB,
      userTask: options.executionPlan.objective,
      requestId: options.requestId,
      maxReviewRounds: this.options.maxReviewRounds ?? 3,
      state: this.workflowState,
      initialEnvelope
    });
  }

  private logPlanningLifecycleEvent(
    eventType: "planning.plan_ready" | "planning.plan_approved" | "planning.plan_discarded",
    bindingA: RoleRuntimeBinding,
    requestId: string,
    details?: Record<string, unknown>
  ): void {
    const event = normalizeLifecycleEvent({
      role: "A",
      sessionId: bindingA.sessionId,
      sessionFile: bindingA.sessionFile,
      eventType,
      requestId,
      details
    });
    event.operatorTurnId = this.operatorTurnId;
    this.logger.log(event);
    this.metrics.observe(event);
  }

  private getConversationMode(): ConversationMode {
    const activeWorkflow = this.getActiveWorkflow();
    if (activeWorkflow && !isWorkflowTerminal(activeWorkflow.status)) {
      return "executing";
    }

    return this.uiState.phase === "execution" || this.uiState.phase === "review"
      ? "executing"
      : "planning";
  }

  private setUiState(phase: CoordinatorUiPhase, activeRole: Role): void {
    this.uiState = { phase, activeRole };
  }

  private async supersedeActiveWorkflowIfNeeded(
    role: Role,
    binding: RoleRuntimeBinding
  ): Promise<void> {
    const activeWorkflow = this.getActiveWorkflow();
    if (!activeWorkflow || isWorkflowTerminal(activeWorkflow.status)) {
      return;
    }

    await this.supersedeWorkflow(activeWorkflow, {
      binding,
      reason: `Runtime ${role} was replaced while the workflow was still active.`,
      lastSummary: `Workflow ${activeWorkflow.workflowId} was superseded after runtime ${role} was replaced.`,
      replacedRole: role
    });
  }

  private async supersedeRecoveredWorkflowOnStartIfNeeded(): Promise<void> {
    if (this.options.supersedeRecoveredWorkflowOnStart === false) {
      return;
    }

    const activeWorkflow = this.getActiveWorkflow();
    if (!activeWorkflow || isWorkflowTerminal(activeWorkflow.status)) {
      return;
    }

    await this.replaceRuntimeInternal("A", { type: "new", role: "A" });
    this.configurationController?.signal.throwIfAborted();
    await this.replaceRuntimeInternal("B", { type: "new", role: "B" });
    this.lastSummary =
      `Workflow ${activeWorkflow.workflowId} was superseded when PI Dual started fresh runtime sessions.`;
  }

  private async supersedeWorkflow(
    activeWorkflow: WorkflowSnapshot,
    input: {
      binding: RoleRuntimeBinding;
      reason: string;
      lastSummary: string;
      replacedRole: Role;
    }
  ): Promise<void> {
    await this.ledger.append({
      workflowId: activeWorkflow.workflowId,
      iteration: activeWorkflow.currentIteration,
      status: "superseded",
      role: "coordinator",
      requestId: activeWorkflow.requestId,
      sessionId: input.binding.sessionId,
      sessionFile: input.binding.sessionFile,
      timestamp: new Date().toISOString(),
      details: {
        reason: input.reason,
        replacedRole: input.replacedRole
      }
    });
    this.workflowState = await this.recoveryLoader.load();
    this.lastSummary = input.lastSummary;
    this.clearAllActivity();
  }

  private observeActivityEvent(event: NormalizedTelemetryEvent): void {
    if (event.eventType.startsWith("response.")) {
      const progress = responseProgressSchema.safeParse(event.details);
      if (progress.success) this.responseProgress = progress.data;
    }
    if (
      (event.eventType === "pi.tool_execution_start" ||
        event.eventType === "pi.tool_execution_update" ||
        event.eventType === "pi.tool_execution_end") &&
      typeof event.details.toolName === "string"
    ) {
      this.lastToolNames.set(event.role, event.details.toolName);
    }

    const update = deriveActivityUpdate(event, this.getStatus());
    if (update?.clear) {
      if (update.role === "coordinator") {
        this.coordinatorActivity = undefined;
      } else {
        this.runtimeActivity.delete(update.role);
      }
    } else if (update?.snapshot) {
      if (update.role === "coordinator") {
        this.coordinatorActivity = update.snapshot;
      } else {
        this.runtimeActivity.set(update.role, update.snapshot);
      }
    }

    if (
      event.eventType === "workflow.finalized" ||
      event.eventType === "workflow.blocked" ||
      event.eventType === "workflow.capped"
    ) {
      this.runtimeActivity.clear();
      this.coordinatorActivity = undefined;
    }
  }

  private clearAllActivity(): void {
    this.runtimeActivity.clear();
    this.coordinatorActivity = undefined;
  }
}

export function selectLastValidatedRecord(state: WorkflowState): HandoffRecord | undefined {
  return state.records.at(-1);
}

export function getSessionRootForCwd(cwd: string): string {
  return join(getDefaultSessionRoot(cwd));
}

function renderPlanningTurnMessage(userInput: string): string {
  return [
    "Planning prompt for Agent A.",
    "You are in planning mode.",
    "Converse normally with the operator.",
    "Agent B is unavailable until the operator explicitly approves execution or asks to start now.",
    "If the operator only wants discussion or brainstorming, reply with plain prose and no machine block.",
    "If the operator wants a concrete implementation plan but has not approved execution yet, end the turn with exactly one `pi-plan` JSON block.",
    "If the operator explicitly wants execution to start now, end the turn with exactly one `pi-execute` JSON block.",
    "`pi-plan` and `pi-execute` are mutually exclusive.",
    ...PLANNING_GUIDANCE,
    "",
    "Operator turn:",
    userInput
  ].join("\n");
}

function labelPhase(phase: CoordinatorUiPhase): string {
  switch (phase) {
    case "planning":
      return "Planning";
    case "execution":
      return "Execution";
    case "review":
      return "Review";
    case "repair":
      return "Repair";
  }
}

function labelRole(role: Role): string {
  return `Agent ${role}`;
}

function resolvePlanningTurn(message: Parameters<typeof maybeParseExecutionPlanEnvelope>[0]):
  | { kind: "planning"; userResponse: string }
  | { kind: "plan"; userResponse: string; plan: NonNullable<ReturnType<typeof maybeParsePlanProposalEnvelope>> }
  | { kind: "execute"; executionPlan: NonNullable<ReturnType<typeof maybeParseExecutionPlanEnvelope>> }
  | { kind: "invalid_machine_block"; reason: string } {
  if (message?.role === "assistant" && message.stopReason === "length") return { kind: "invalid_machine_block", reason: "Truncated planning response." };
  const text = extractAssistantText(message);
  const counts = {
    plan: countMachineBlocks(text, PLAN_BLOCK_TYPE),
    execute: countMachineBlocks(text, EXECUTE_BLOCK_TYPE),
    handoff: countMachineBlocks(text, HANDOFF_BLOCK_TYPE),
    completion: countMachineBlocks(text, COMPLETION_BLOCK_TYPE),
    final: countMachineBlocks(text, FINAL_BLOCK_TYPE)
  };
  const totalKnownBlocks =
    counts.plan + counts.execute + counts.handoff + counts.completion + counts.final;
  const totalPiBlocks = countPiMachineBlocks(text);

  if (totalPiBlocks !== totalKnownBlocks) {
    return {
      kind: "invalid_machine_block",
      reason: "planning mode only accepts `pi-plan` or `pi-execute` machine blocks"
    };
  }

  if (counts.handoff + counts.completion + counts.final > 0) {
    return {
      kind: "invalid_machine_block",
      reason: "planning mode only accepts prose, exactly one `pi-plan`, or exactly one `pi-execute` block"
    };
  }

  if (counts.plan === 0 && counts.execute === 0) {
    const userResponse = stripMachineBlocks(text).trim();
    if (!userResponse) {
      return {
        kind: "invalid_machine_block",
        reason: "planning mode requires either operator-facing prose, exactly one `pi-plan`, or exactly one `pi-execute` block"
      };
    }
    return {
      kind: "planning",
      userResponse
    };
  }

  if (counts.plan > 1 || counts.execute > 1) {
    return {
      kind: "invalid_machine_block",
      reason: "expected at most one `pi-plan` block and at most one `pi-execute` block"
    };
  }

  if (counts.plan === 1 && counts.execute === 1) {
    return {
      kind: "invalid_machine_block",
      reason: "planning mode does not allow `pi-plan` and `pi-execute` in the same turn"
    };
  }

  if (totalKnownBlocks !== 1) {
    return {
      kind: "invalid_machine_block",
      reason: "planning mode accepts at most one machine block"
    };
  }

  if (counts.plan === 1) {
    const plan = maybeParsePlanProposalEnvelope(message);
    if (!plan) {
      return {
        kind: "invalid_machine_block",
        reason: "invalid `pi-plan` block"
      };
    }
    return {
      kind: "plan",
      userResponse: stripMachineBlocks(text).trim(),
      plan
    };
  }

  const executionPlan = maybeParseExecutionPlanEnvelope(message);
  if (!executionPlan) {
    return {
      kind: "invalid_machine_block",
      reason: "invalid `pi-execute` block"
    };
  }

  return {
    kind: "execute",
    executionPlan
  };
}

function countMachineBlocks(text: string, type: string): number {
  return [...text.matchAll(new RegExp("```" + type + "\\b", "g"))].length;
}

function countPiMachineBlocks(text: string): number {
  return [...text.matchAll(/```pi-[a-z-]+\b/g)].length;
}

function stripMachineBlocks(text: string): string {
  return text
    .replace(/```pi-(?:plan|execute|handoff|completion|final)\s*[\s\S]*?```/g, "")
    .trim();
}

function createPendingExecutionPlanSnapshot(
  plan: NonNullable<ReturnType<typeof maybeParsePlanProposalEnvelope>>,
  requestId: string
): PendingExecutionPlanSnapshot {
  return {
    objective: plan.objective,
    summary: plan.summary,
    acceptanceCriteria: [...plan.acceptanceCriteria],
    relevantPaths: [...plan.relevantPaths],
    executionPlan: [...plan.executionPlan],
    constraints: plan.constraints ? [...plan.constraints] : undefined,
    proposedAt: new Date().toISOString(),
    requestId,
    proposedByRole: "A"
  };
}

function createExecutionPlanEnvelopeFromPendingPlan(
  pendingPlan: PendingExecutionPlanSnapshot
): NonNullable<ReturnType<typeof maybeParseExecutionPlanEnvelope>> {
  return {
    schemaVersion: 1,
    objective: pendingPlan.objective,
    summary: pendingPlan.summary,
    acceptanceCriteria: [...pendingPlan.acceptanceCriteria],
    relevantPaths: [...pendingPlan.relevantPaths],
    executionPlan: [...pendingPlan.executionPlan],
    constraints: pendingPlan.constraints ? [...pendingPlan.constraints] : undefined
  };
}

function buildPendingPlanHint(): string {
  return "Run /approve to start coordinated execution with Agent B, send another message to revise the plan, or run /discard to clear it.";
}

function buildApproveStatusHint(): string {
  return "Run /approve to start coordinated execution with Agent B.";
}
