import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { withPromptProvenance } from "../app/prompt-provenance.js";
import { createRequestId } from "../telemetry/correlation.js";
import { RuntimeEventBridge } from "./bind-runtime-events.js";
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
  EXECUTE_BLOCK_TYPE,
  FINAL_BLOCK_TYPE,
  HANDOFF_BLOCK_TYPE,
  extractAssistantText,
  maybeParseExecutionPlanEnvelope
} from "../handoff/handoff-envelope.js";
import type { HandoffRecord } from "../types/handoff.js";
import type { Role } from "../types/role.js";
import type { CoordinatorTurnResult, ConversationMode, WorkflowSnapshot, WorkflowState } from "../types/workflow.js";
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
  private workflowState: WorkflowState = createEmptyHandoffState();
  private lastSummary: string | undefined;
  private executionInFlight = false;

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
      this.metrics
    );
  }

  public async start(): Promise<void> {
    this.workflowState = await this.recoveryLoader.load();
    const bindingA = await this.runtimeFactory({
      role: "A",
      cwd: this.options.cwd,
      agentDir: this.options.agentDir,
      sessionRoot: this.sessionRoot,
      modelOverride: this.options.modelA,
      thinkingOverride: this.options.thinkingA,
      sessionMode: this.options.sessionMode
    });
    const bindingB = await this.runtimeFactory({
      role: "B",
      cwd: this.options.cwd,
      agentDir: this.options.agentDir,
      sessionRoot: this.sessionRoot,
      modelOverride: this.options.modelB,
      thinkingOverride: this.options.thinkingB,
      sessionMode: this.options.sessionMode
    });
    this.registry.set(bindingA);
    this.registry.set(bindingB);
    await this.eventBridge.bind(bindingA);
    await this.eventBridge.bind(bindingB);
  }

  public async submitUserInput(text: string): Promise<CoordinatorTurnResult> {
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

    try {
      const planningOutcome = await this.submitPlanningTurn({
        bindingA,
        requestId,
        userInput: text
      });

      if (planningOutcome.kind === "planning") {
        await this.eventBridge.waitForIdle();
        return {
          mode: "planning",
          userResponse: planningOutcome.userResponse
        };
      }

      this.executionInFlight = true;
      try {
        const { result } = await this.startExecutionFromPlan({
          bindingA,
          bindingB,
          requestId,
          executionPlan: planningOutcome.executionPlan
        });
        this.workflowState = await this.recoveryLoader.load();
        this.lastSummary = result.finalSummary;
        await this.eventBridge.waitForIdle();
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
        this.executionInFlight = false;
      }
    } finally {
      this.eventBridge.setRequestId("A", undefined);
      this.eventBridge.setRequestId("B", undefined);
    }
  }

  public async replaceRuntime(role: Role, action: RuntimeReplacementAction): Promise<void> {
    const binding = this.requireBinding(role);
    const updated = await applyRuntimeOperation(binding, action);
    this.registry.set(updated);
    await this.eventBridge.bind(updated);
    await this.supersedeActiveWorkflowIfNeeded(role, updated);
    await this.eventBridge.waitForIdle();
  }

  public getStatus(): Record<string, unknown> {
    const list = this.registry.list().map((binding) => ({
      role: binding.role,
      sessionId: binding.sessionId,
      sessionFile: binding.sessionFile,
      cwd: binding.cwd,
      model: binding.session.model
        ? `${binding.session.model.provider}/${binding.session.model.id}`
        : "(pi-default)",
      thinking: binding.session.thinkingLevel ?? "(default)"
    }));
    const workflow = this.getActiveWorkflow() ?? this.getLatestWorkflowSnapshot();

    return {
      cwd: this.options.cwd,
      conversationMode: this.getConversationMode(),
      sessionRoot: this.options.sessionMode === "memory" ? "(memory)" : this.sessionRoot,
      lastSummary: this.lastSummary,
      activeWorkflowId: this.workflowState.activeWorkflowId,
      currentIteration: workflow?.currentIteration,
      workflowStatus: workflow?.status,
      lastCompletionSummary: workflow?.latestCompletion?.summary,
      repairCount: workflow?.repairCount ?? 0,
      maxReviewRounds: this.options.maxReviewRounds ?? 3,
      runtimes: list,
      metrics: this.metrics.snapshot()
    };
  }

  public getSessions(): ReturnType<typeof getRuntimeHealth>[] {
    return this.registry.list().map(getRuntimeHealth);
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
    if (first.kind !== "invalid_execute") {
      return first;
    }

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
    if (repaired.kind === "invalid_execute") {
      throw new Error(`Agent A planning response remained invalid after repair: ${repaired.reason}`);
    }
    return repaired;
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

  private getConversationMode(): ConversationMode {
    if (this.executionInFlight) {
      return "executing";
    }
    const activeWorkflow = this.getActiveWorkflow();
    return activeWorkflow && !isWorkflowTerminal(activeWorkflow.status)
      ? "executing"
      : "planning";
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
    "Agent B is unavailable until you decide execution should start now.",
    "Emit no machine block unless execution is being started now.",
    "If execution should start now, end the turn with exactly one `pi-execute` JSON block.",
    "",
    "Operator turn:",
    userInput
  ].join("\n");
}

function renderPlanningRepairMessage(reason: string): string {
  return [
    "Planning repair prompt for Agent A.",
    `Your previous planning response could not be accepted: ${reason}`,
    "Reply with either normal prose and no machine block, or exactly one valid `pi-execute` block.",
    "Do not emit `pi-handoff`, `pi-completion`, or `pi-final` in planning mode."
  ].join("\n");
}

function resolvePlanningTurn(message: Parameters<typeof maybeParseExecutionPlanEnvelope>[0]):
  | { kind: "planning"; userResponse: string }
  | { kind: "execute"; executionPlan: NonNullable<ReturnType<typeof maybeParseExecutionPlanEnvelope>> }
  | { kind: "invalid_execute"; reason: string } {
  const text = extractAssistantText(message);
  const counts = {
    execute: countMachineBlocks(text, EXECUTE_BLOCK_TYPE),
    handoff: countMachineBlocks(text, HANDOFF_BLOCK_TYPE),
    completion: countMachineBlocks(text, COMPLETION_BLOCK_TYPE),
    final: countMachineBlocks(text, FINAL_BLOCK_TYPE)
  };
  const totalBlocks = counts.execute + counts.handoff + counts.completion + counts.final;

  if (counts.handoff + counts.completion + counts.final > 0) {
    return {
      kind: "invalid_execute",
      reason: "planning mode only accepts prose or exactly one `pi-execute` block"
    };
  }

  if (counts.execute === 0) {
    return {
      kind: "planning",
      userResponse: stripMachineBlocks(text).trim()
    };
  }

  if (counts.execute !== 1) {
    return {
      kind: "invalid_execute",
      reason: "expected at most one `pi-execute` block"
    };
  }

  if (totalBlocks !== 1) {
    return {
      kind: "invalid_execute",
      reason: "planning mode accepts exactly one `pi-execute` block and no other machine blocks"
    };
  }

  const executionPlan = maybeParseExecutionPlanEnvelope(message);
  if (!executionPlan) {
    return {
      kind: "invalid_execute",
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

function stripMachineBlocks(text: string): string {
  return text
    .replace(/```pi-(?:execute|handoff|completion|final)\s*[\s\S]*?```/g, "")
    .trim();
}
