import { join } from "node:path";

import { createRequestId } from "../telemetry/correlation.js";
import { RuntimeEventBridge } from "./bind-runtime-events.js";
import { createEmptyHandoffState } from "./handoff-state-machine.js";
import { WorkflowOrchestrator } from "./workflow-orchestrator.js";
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
import type { HandoffRecord } from "../types/handoff.js";
import type { Role } from "../types/role.js";
import type { WorkflowRunResult, WorkflowSnapshot, WorkflowState } from "../types/workflow.js";
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

  public async submitUserTask(text: string): Promise<WorkflowRunResult> {
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
      const { result } = await this.workflowOrchestrator.run({
        bindingA,
        bindingB,
        userTask: text,
        requestId,
        maxReviewRounds: this.options.maxReviewRounds ?? 3,
        state: this.workflowState
      });
      this.workflowState = await this.recoveryLoader.load();
      this.lastSummary = result.finalSummary;
      await this.eventBridge.waitForIdle();
      return result;
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
