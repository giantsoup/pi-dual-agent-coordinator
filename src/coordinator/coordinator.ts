import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { getAgentDir } from "@mariozechner/pi-coding-agent";
import {
  deriveActivityUpdate,
  renderActivityText,
  renderReasonText,
  type ActivitySnapshot
} from "../app/activity-summary.js";
import { withPromptProvenance } from "../app/prompt-provenance.js";
import { createRequestId } from "../telemetry/correlation.js";
import { normalizeLifecycleEvent } from "../telemetry/event-normalizer.js";
import {
  RuntimeEventBridge,
  type RuntimeUiBridgeEvent
} from "./bind-runtime-events.js";
import { createEmptyHandoffState } from "./handoff-state-machine.js";
import { WorkflowOrchestrator, createWorkflowHandoffEnvelope } from "./workflow-orchestrator.js";
import {
  createRoleRuntime,
  getDefaultSessionRoot,
  type RoleRuntimeBinding,
  type SupportedThinkingLevel
} from "../runtime/create-role-runtime.js";
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
  createRoleRuntime?: typeof createRoleRuntime;
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
  private pendingPlan: PendingExecutionPlanSnapshot | undefined;
  private uiState: { phase: CoordinatorUiPhase; activeRole: Role } = {
    phase: "planning",
    activeRole: "A"
  };
  private readonly runtimeActivity = new Map<Role, ActivitySnapshot>();
  private readonly lastToolNames = new Map<Role, string>();
  private coordinatorActivity: ActivitySnapshot | undefined;
  private readonly unsubscribeActivityListener: () => void;

  public constructor(private readonly options: CoordinatorOptions) {
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

  public async start(): Promise<void> {
    this.workflowState = await this.recoveryLoader.load();
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
    const bindingB = await this.runtimeFactory({
      role: "B",
      cwd: this.options.cwd,
      agentDir: this.options.agentDir,
      sessionRoot: this.sessionRoot,
      modelOverride: this.options.modelB,
      thinkingOverride: this.options.thinkingB,
      sessionMode: this.options.sessionMode,
      mcp: this.resolvedMcpConfig
    });
    this.registry.set(bindingA);
    this.registry.set(bindingB);
    await this.eventBridge.bind(bindingA);
    await this.eventBridge.bind(bindingB);
    this.setUiState("planning", "A");
  }

  public async submitUserInput(text: string): Promise<CoordinatorTurnResult> {
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

  public async approvePendingPlan(): Promise<CoordinatorTurnResult> {
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
  }

  public getStatus(): CoordinatorStatusSnapshot {
    const list = this.registry.list().map((binding) => {
      const health = getRuntimeHealth(binding);
      const snapshot = this.runtimeActivity.get(binding.role);
      return {
        ...health,
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
      repairCount: workflow?.repairCount ?? 0,
      maxReviewRounds: this.options.maxReviewRounds ?? 3,
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
    this.unsubscribeActivityListener();
    this.eventBridge.dispose();
    await this.registry.disposeAll();
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
    const response = await this.eventBridge.promptAndWaitForTurnEnd(
      options.bindingA,
      withPromptProvenance(
        "planning_user",
        renderPlanningTurnMessage(options.userInput),
        {
          requestId: options.requestId,
          sessionRole: "A"
        }
      )
    );
    const first = resolvePlanningTurn(response);
    if (first.kind !== "invalid_machine_block") {
      return first;
    }

    this.coordinatorActivity = {
      role: "coordinator",
      phase: "planning",
      kind: "repair",
      label: "repairing Agent A planning response",
      reason: first.reason,
      startedAt: new Date().toISOString()
    };

    try {
      const repairedResponse = await this.eventBridge.promptAndWaitForTurnEnd(
        options.bindingA,
        withPromptProvenance(
          "planning_repair",
          renderPlanningRepairMessage(first.reason),
          {
            requestId: options.requestId,
            sessionRole: "A"
          }
        )
      );
      const repaired = resolvePlanningTurn(repairedResponse);
      if (repaired.kind === "invalid_machine_block") {
        throw new Error(`Agent A planning response remained invalid after repair: ${repaired.reason}`);
      }
      return repaired;
    } finally {
      this.coordinatorActivity = undefined;
    }
  }

  private async executeApprovedPlan(options: {
    bindingA: RoleRuntimeBinding;
    bindingB: RoleRuntimeBinding;
    requestId: string;
    executionPlan: NonNullable<ReturnType<typeof maybeParseExecutionPlanEnvelope>>;
  }) {
    try {
      this.setUiState("execution", "B");
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

    await this.ledger.append({
      workflowId: activeWorkflow.workflowId,
      iteration: activeWorkflow.currentIteration,
      status: "superseded",
      role: "coordinator",
      requestId: activeWorkflow.requestId,
      sessionId: binding.sessionId,
      sessionFile: binding.sessionFile,
      timestamp: new Date().toISOString(),
      details: {
        reason: `Runtime ${role} was replaced while the workflow was still active.`,
        replacedRole: role
      }
    });
    this.workflowState = await this.recoveryLoader.load();
    this.lastSummary = `Workflow ${activeWorkflow.workflowId} was superseded after runtime ${role} was replaced.`;
    this.clearAllActivity();
  }

  private observeActivityEvent(event: NormalizedTelemetryEvent): void {
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
    "",
    "Operator turn:",
    userInput
  ].join("\n");
}

function renderPlanningRepairMessage(reason: string): string {
  return [
    "Planning repair prompt for Agent A.",
    `Your previous planning response could not be accepted: ${reason}`,
    "Reply with either normal prose and no machine block, exactly one valid `pi-plan` block, or exactly one valid `pi-execute` block.",
    "Do not emit `pi-handoff`, `pi-completion`, or `pi-final` in planning mode.",
    "`pi-plan` and `pi-execute` are mutually exclusive."
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
