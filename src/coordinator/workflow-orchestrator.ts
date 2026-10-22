import { repairResponse, ResponseRepairExhaustedError, type ResponseProgress } from "./response-repair.js";
import { responseShape, handoffEnvelopeSchema, finalDecisionSchema, completionRecordSchema } from "../workflow/workflow-schema.js";
import { randomUUID } from "node:crypto";

import { withPromptProvenance } from "../app/prompt-provenance.js";
import { PLANNING_GUIDANCE } from "../app/trust-policy.js";
import { createExecutionSupervisor, ExecutionCheckInError, ExecutionEvidenceError } from "./execution-supervisor.js";
import { createHandoffId } from "../handoff/handoff-id.js";
import { applyTransition } from "./handoff-state-machine.js";
import { deliverHandoff } from "./deliver-handoff.js";
import { renderCapExceededMessage } from "../workflow/render-final-message.js";
import { renderReviewMessage } from "../workflow/render-review-message.js";
import { resolveAgentAResponse, resolveAgentBResponse } from "./review-cycle.js";
import { normalizeLifecycleEvent } from "../telemetry/event-normalizer.js";
import { SessionLedger } from "../persistence/session-ledger.js";
import { getModelDisplayInfo } from "../runtime/model-display.js";
import { OperationStoppedError } from "./bind-runtime-events.js";
import type { RuntimeEventBridge } from "./bind-runtime-events.js";
import type { RoleRuntimeBinding } from "../runtime/create-role-runtime.js";
import type { CoordinatorUiPhase } from "../types/status.js";
import type {
  CompletionRecord,
  FinalDecisionRecord,
  HandoffEnvelope,
  HandoffRecord
} from "../types/handoff.js";
import type { Metrics } from "../telemetry/metrics.js";
import type { TelemetryLogger } from "../telemetry/logger.js";
import type {
  WorkflowRunResult,
  WorkflowRunStatus,
  WorkflowSnapshot,
  WorkflowState
} from "../types/workflow.js";

export interface WorkflowOrchestratorOptions {
  bindingA: RoleRuntimeBinding;
  bindingB: RoleRuntimeBinding;
  userTask: string;
  requestId: string;
  maxReviewRounds: number;
  state: WorkflowState;
}

export interface ApprovedPlanWorkflowOptions extends WorkflowOrchestratorOptions {
  initialEnvelope: HandoffEnvelope;
}

export class WorkflowOrchestrator {
  private currentState: WorkflowState | undefined;

  public constructor(
    private readonly ledger: SessionLedger,
    private readonly bridge: RuntimeEventBridge,
    private readonly logger: TelemetryLogger,
    private readonly metrics: Metrics,
    private readonly setUiState: (phase: CoordinatorUiPhase, role: "A" | "B") => void,
    private readonly onStateChange: (state: WorkflowState) => void
  ) {}

  public async run(options: WorkflowOrchestratorOptions): Promise<{
    state: WorkflowState;
    result: WorkflowRunResult;
  }> {
    let state = options.state;
    this.currentState = state;
    this.onStateChange(state);
    const workflowId = randomUUID();
    const startedAt = Date.now();
    try {
      this.logWorkflowEvent("workflow.started", options.bindingA, options, {
        workflowId,
        handoffId: undefined,
        iteration: 1,
        userTask: options.userTask
      });

      const initialPromptOptions = options.bindingA.session.isStreaming
        ? { streamingBehavior: "followUp" as const }
        : undefined;

      this.setUiState("planning", "A");
      const submit = (responseId: string) => this.bridge.promptAndWaitForTurnEnd(
        options.bindingA,
        withPromptProvenance(
          "user_task",
          renderInitialPlanningMessage({
            workflowId,
            iteration: 1,
            maxReviewRounds: options.maxReviewRounds,
            requestId: options.requestId,
            userTask: options.userTask
          }),
          {
            requestId: options.requestId,
            workflowId,
            iteration: 1,
            sessionRole: "A"
          }
        ),
        { ...initialPromptOptions, responseId }
      );

      const aOutcome = await this.acceptAgentAResponse({
        bindingA: options.bindingA,
        bindingB: options.bindingB,
        workflowId,
        responseKind: "handoff",
        allowedHandoffIterations: [1],
        allowedFinalIterations: [1],
        requestId: options.requestId,
        submit,
        iteration: 1
      });

      if (aOutcome.kind === "final") {
        const finalRecord = createFinalizedRecord({
          workflowId,
          requestId: options.requestId,
          binding: options.bindingA,
          finalDecision: aOutcome.finalDecision,
          userTask: options.userTask
        });
        state = await this.persistRecord(state, finalRecord);
        this.logWorkflowEvent("workflow.finalized", options.bindingA, options, {
          workflowId,
          handoffId: undefined,
          iteration: finalRecord.iteration,
          decision: aOutcome.finalDecision.decision,
          durationMs: Date.now() - startedAt
        });
        return {
          state,
          result: buildWorkflowRunResult(
            finalRecord.finalDecision,
            statusFromFinal(finalRecord.finalDecision),
            options.requestId
          )
        };
      }

      return await this.runApprovedPlanLoop({
        ...options,
        state,
        startedAt,
        workflowId,
        initialEnvelope: aOutcome.envelope
      });
    } catch (error) {
      if (error instanceof OperationStoppedError) throw error;
      const failure =
        error instanceof ResponseRepairExhaustedError
          ? {
              workflowId: error.details.workflowId ?? workflowId,
              iteration: error.details.iteration ?? 1,
              binding: error.details.role === "A" ? options.bindingA : options.bindingB,
              reason: error.details.reason ?? error.message
            }
          : {
              workflowId,
              iteration: 1,
              binding: error instanceof ExecutionEvidenceError ? options.bindingB : options.bindingA,
              reason: error instanceof Error ? error.message : String(error)
            };

      const blockedRecord = createTerminalRecord({
        workflowId: failure.workflowId,
        iteration: failure.iteration,
        requestId: options.requestId,
        binding: failure.binding,
        status: "blocked",
        userTask: options.userTask,
        details: {
          ...(error instanceof ResponseRepairExhaustedError ? error.details : {}),
          reason: failure.reason,
          role: error instanceof ResponseRepairExhaustedError ? error.details.role : error instanceof ExecutionCheckInError ? "A" : error instanceof ExecutionEvidenceError ? "B" : "coordinator",
          unexpectedError: !(error instanceof ResponseRepairExhaustedError || error instanceof ExecutionCheckInError || error instanceof ExecutionEvidenceError)
        }
      });
      state = await this.persistRecord(state, blockedRecord);
      this.logWorkflowEvent("workflow.blocked", failure.binding, options, {
        workflowId: failure.workflowId,
        handoffId: undefined,
        iteration: failure.iteration,
        reason: failure.reason,
        durationMs: Date.now() - startedAt
      });
      return {
        state,
        result: buildCoordinatorFailureResult({
          workflowId: failure.workflowId,
          requestId: options.requestId,
          iteration: failure.iteration,
          status: "blocked",
          summary: `Workflow blocked: ${failure.reason}`
        })
      };
    } finally {
      this.currentState = undefined;
    }
  }

  public async runFromApprovedPlan(options: ApprovedPlanWorkflowOptions): Promise<{
    state: WorkflowState;
    result: WorkflowRunResult;
  }> {
    this.currentState = options.state;
    this.onStateChange(options.state);
    try {
      this.logWorkflowEvent("workflow.started", options.bindingA, options, {
        workflowId: options.initialEnvelope.workflowId,
        handoffId: options.initialEnvelope.handoffId,
        iteration: options.initialEnvelope.iteration,
        userTask: options.userTask
      });

      return await this.runApprovedPlanLoop({
        ...options,
        startedAt: Date.now(),
        workflowId: options.initialEnvelope.workflowId
      });
    } catch (error) {
      if (error instanceof OperationStoppedError) throw error;
      const failure =
        error instanceof ResponseRepairExhaustedError
          ? {
              workflowId: error.details.workflowId ?? options.initialEnvelope.workflowId,
              iteration: error.details.iteration ?? options.initialEnvelope.iteration,
              binding: error.details.role === "A" ? options.bindingA : options.bindingB,
              reason: error.details.reason ?? error.message
            }
          : deriveUnexpectedApprovedPlanFailure(options, this.currentState, error);

      const blockedRecord = createTerminalRecord({
        workflowId: failure.workflowId,
        iteration: failure.iteration,
        requestId: options.requestId,
        binding: failure.binding,
        status: "blocked",
        userTask: options.userTask,
        details: {
          ...(error instanceof ResponseRepairExhaustedError ? error.details : {}),
          reason: failure.reason,
          role: error instanceof ResponseRepairExhaustedError ? error.details.role : error instanceof ExecutionCheckInError ? "A" : error instanceof ExecutionEvidenceError ? "B" : "coordinator",
          unexpectedError: !(error instanceof ResponseRepairExhaustedError || error instanceof ExecutionCheckInError || error instanceof ExecutionEvidenceError)
        }
      });
      const state = await this.persistRecord(this.currentState ?? options.state, blockedRecord);
      this.logWorkflowEvent(
        "workflow.blocked",
        failure.binding,
        options,
        {
          workflowId: failure.workflowId,
          handoffId: options.initialEnvelope.handoffId,
          iteration: failure.iteration,
          reason: failure.reason
        }
      );
      return {
        state,
        result: buildCoordinatorFailureResult({
          workflowId: failure.workflowId,
          requestId: options.requestId,
          iteration: failure.iteration,
          status: "blocked",
          summary: `Workflow blocked: ${failure.reason}`
        })
      };
    } finally {
      this.currentState = undefined;
    }
  }

  private async recordRepair(binding: RoleRuntimeBinding, progress: ResponseProgress): Promise<void> {
    await this.persistRecordNoStateMutation({
      workflowId: progress.workflowId ?? progress.requestId, handoffId: progress.handoffId,
      iteration: progress.iteration ?? 0, requestId: progress.requestId, status: "repair_requested", role: "coordinator",
      sessionId: binding.sessionId, sessionFile: binding.sessionFile, timestamp: new Date().toISOString(),
      details: { ...progress }
    });
  }

  private async acceptAgentAResponse(options: {
    bindingA: RoleRuntimeBinding;
    bindingB: RoleRuntimeBinding;
    workflowId: string;
    iteration: number;
    allowedHandoffIterations: number[];
    allowedFinalIterations: number[];
    requestId: string;
    submit: (responseId: string) => ReturnType<RuntimeEventBridge["promptAndWaitForTurnEnd"]>;
    responseKind?: "handoff" | "review";
    expectedBlockType?: "pi-final" | "pi-handoff-or-pi-final";
  }): Promise<
    | { kind: "handoff"; envelope: HandoffEnvelope }
    | { kind: "final"; finalDecision: FinalDecisionRecord }
  > {
    return repairResponse({ bridge: this.bridge, binding: options.bindingA,
      kind: options.expectedBlockType === "pi-final" ? "final" : options.responseKind ?? "review",
      identifiers: { workflowId: options.workflowId, requestId: options.requestId, iteration: options.iteration },
      shape: [
        options.expectedBlockType === "pi-final" ? "Exactly one fenced pi-final JSON block." : "Exactly one fenced pi-handoff or pi-final JSON block.",
        `pi-handoff.iteration must be one of ${JSON.stringify(options.allowedHandoffIterations)}. pi-final.iteration must be one of ${JSON.stringify(options.allowedFinalIterations)}.`,
        responseShape(...(options.expectedBlockType === "pi-final" ? [finalDecisionSchema] : [handoffEnvelopeSchema, finalDecisionSchema]))
      ].join("\n"),
      submit: options.submit,
      onRepair: (progress) => this.recordRepair(options.bindingA, progress),
      onProgress: () => this.setUiState("repair", "A"),
      validate: (message) => {
        const response = resolveAgentAResponse({ ...options, message });
        if (response.kind === "invalid") return { reason: response.reason };
        if (!this.matchesExpectedBlock(response.kind, options.expectedBlockType)) return { reason: "Unexpected block type from Agent A." };
        return { value: response };
      }
    });
  }

  private async acceptAgentBResponse(options: {
    bindingB: RoleRuntimeBinding;
    workflowId: string;
    handoffId: string;
    iteration: number;
    requestId: string;
    assertCompletionEvidence: (completion: CompletionRecord) => void;
    submit: (responseId: string) => ReturnType<RuntimeEventBridge["promptAndWaitForTurnEnd"]>;
  }): Promise<CompletionRecord> {
    return repairResponse({ bridge: this.bridge, binding: options.bindingB, kind: "completion",
      identifiers: { workflowId: options.workflowId, handoffId: options.handoffId, requestId: options.requestId, iteration: options.iteration },
      shape: "Exactly one fenced pi-completion JSON block. " + responseShape(completionRecordSchema),
      submit: options.submit, onRepair: (progress) => this.recordRepair(options.bindingB, progress),
      onProgress: () => this.setUiState("repair", "B"),
      validate: (message) => {
        const response = resolveAgentBResponse({ ...options, message });
        if (response.kind === "completion") options.assertCompletionEvidence(response.completion);
        return response.kind === "invalid" ? { reason: response.reason } : { value: response.completion };
      }
    });
  }

  private async persistRecord(state: WorkflowState, record: HandoffRecord): Promise<WorkflowState> {
    this.bridge.assertActive();
    await this.ledger.append(record);
    const nextState = applyTransition(this.currentState ?? state, record);
    this.currentState = nextState;
    this.onStateChange(nextState);
    return nextState;
  }

  private async persistRecordNoStateMutation(record: HandoffRecord): Promise<void> {
    this.bridge.assertActive();
    await this.ledger.append(record);
    if (this.currentState) {
      this.currentState = applyTransition(this.currentState, record);
      this.onStateChange(this.currentState);
    }
  }

  private logWorkflowEvent(
    eventType: string,
    actor: RoleRuntimeBinding,
    options: Pick<WorkflowOrchestratorOptions, "bindingA" | "bindingB" | "requestId">,
    details: Record<string, unknown>
  ): void {
    const modelA = formatBindingModelDisplay(options.bindingA);
    const modelB = formatBindingModelDisplay(options.bindingB);
    const event = normalizeLifecycleEvent({
      role: actor.role,
      sessionId: actor.sessionId,
      sessionFile: actor.sessionFile,
      eventType,
      requestId: options.requestId,
      details: {
        ...details,
        modelDisplayA: modelA.display,
        modelDisplayB: modelB.display,
        modelNameA: modelA.name,
        modelNameB: modelB.name,
        modelIdA: modelA.id,
        modelIdB: modelB.id,
        sessionIdA: options.bindingA.sessionId,
        sessionIdB: options.bindingB.sessionId,
        sessionFileA: options.bindingA.sessionFile,
        sessionFileB: options.bindingB.sessionFile
      }
    });
    this.logger.log(event);
    this.metrics.observe(event);
  }

  private matchesExpectedBlock(
    kind: "handoff" | "final",
    expected: "pi-final" | "pi-handoff-or-pi-final" | undefined
  ): boolean {
    if (!expected || expected === "pi-handoff-or-pi-final") {
      return true;
    }
    return expected === "pi-final" ? kind === "final" : true;
  }

  private async runApprovedPlanLoop(options: WorkflowOrchestratorOptions & {
    initialEnvelope: HandoffEnvelope;
    startedAt: number;
    workflowId: string;
  }): Promise<{
    state: WorkflowState;
    result: WorkflowRunResult;
  }> {
    let state = options.state;
    let envelope = options.initialEnvelope;
    const recoveryBudget = { redirects: 0 };

    while (true) {
      const iteration = envelope.iteration;
      const prepared = createPreparedRecord({
        workflowId: options.workflowId,
        requestId: options.requestId,
        binding: options.bindingA,
        envelope,
        userTask: options.userTask
      });
      state = await this.persistRecord(state, prepared);
      this.logWorkflowEvent("workflow.iteration_prepared", options.bindingA, options, {
        workflowId: options.workflowId,
        handoffId: prepared.handoffId,
        iteration
      });

      this.setUiState("execution", "B");
      const onTurnEnd = createExecutionSupervisor({
        bindingA: options.bindingA,
        cwd: options.bindingB.cwd,
        bridge: this.bridge,
        envelope,
        recoveryBudget,
        setUiState: this.setUiState,
        onRepair: (progress) => this.recordRepair(options.bindingA, progress),
        logEvent: (eventType, details) => this.logWorkflowEvent(eventType, eventType === "workflow.execution_progress" || eventType === "workflow.tool_recovery_redirected" ? options.bindingB : options.bindingA, options, details)
      });
      const bOutcome = await this.acceptAgentBResponse({
        bindingB: options.bindingB,
        workflowId: options.workflowId,
        handoffId: prepared.handoffId ?? envelope.handoffId,
        iteration,
        requestId: options.requestId,
        assertCompletionEvidence: onTurnEnd.assertCompletionEvidence,
        submit: async (responseId) => {
          const { delivered, message } = await deliverHandoff({ prepared, binding: options.bindingB, bridge: this.bridge, onTurnEnd, responseId });
          state = await this.persistRecord(state, delivered);
          this.logWorkflowEvent("workflow.iteration_delivered", options.bindingB, options, {
            workflowId: options.workflowId, handoffId: delivered.handoffId, iteration
          });
          return message;
        }
      });

      const completed = createCompletedRecord({
        workflowId: options.workflowId,
        requestId: options.requestId,
        binding: options.bindingB,
        completion: bOutcome
      });
      completed.details = { nativeEvidence: onTurnEnd.getNativeEvidence() };
      state = await this.persistRecord(state, completed);
      this.logWorkflowEvent("workflow.iteration_completed", options.bindingB, options, {
        workflowId: options.workflowId,
        handoffId: completed.handoffId,
        iteration
      });

      const workflow = selectWorkflowSnapshot(state, options.workflowId);
      if (iteration >= options.maxReviewRounds) {
        this.setUiState("review", "A");
        const submit = (responseId: string) => this.bridge.promptAndWaitForTurnEnd(
          options.bindingA,
          withPromptProvenance(
            "coordinator_control",
            renderCapExceededMessage(workflow),
            {
              requestId: options.requestId,
              workflowId: options.workflowId,
              handoffId: completed.handoffId,
              iteration,
              sessionRole: "A"
            }
          ), { responseId }
        );
        const cappedOutcome = await this.acceptAgentAResponse({
          bindingA: options.bindingA,
          bindingB: options.bindingB,
          workflowId: options.workflowId,
          allowedHandoffIterations: [],
          allowedFinalIterations: [iteration],
          requestId: options.requestId,
          submit,
          iteration,
          expectedBlockType: "pi-final"
        });

        if (cappedOutcome.kind !== "final") {
          const cappedRecord = createTerminalRecord({
            workflowId: options.workflowId,
            iteration,
            requestId: options.requestId,
            binding: options.bindingA,
            status: "capped",
            userTask: options.userTask,
            details: {
              reason: "Agent A did not provide a terminal `pi-final` response after the review cap was hit."
            }
          });
          state = await this.persistRecord(state, cappedRecord);
          this.logWorkflowEvent("workflow.capped", options.bindingA, options, {
            workflowId: options.workflowId,
            handoffId: completed.handoffId,
            iteration,
            durationMs: Date.now() - options.startedAt
          });
          return {
            state,
            result: buildCoordinatorFailureResult({
              workflowId: options.workflowId,
              requestId: options.requestId,
              iteration,
              status: "capped",
              summary: "Review cap reached and Agent A did not produce a valid terminal response."
            })
          };
        }

        const finalRecord = createFinalizedRecord({
          workflowId: options.workflowId,
          requestId: options.requestId,
          binding: options.bindingA,
          finalDecision: cappedOutcome.finalDecision,
          userTask: options.userTask
        });
        state = await this.persistRecord(state, finalRecord);
        this.logWorkflowEvent("workflow.finalized", options.bindingA, options, {
          workflowId: options.workflowId,
          handoffId: completed.handoffId,
          iteration: finalRecord.iteration,
          decision: cappedOutcome.finalDecision.decision,
          durationMs: Date.now() - options.startedAt
        });
        return {
          state,
          result: buildWorkflowRunResult(
            finalRecord.finalDecision,
            statusFromFinal(finalRecord.finalDecision),
            options.requestId
          )
        };
      }

      this.setUiState("review", "A");
      const submit = (responseId: string) => this.bridge.promptAndWaitForTurnEnd(
        options.bindingA,
        withPromptProvenance(
          "coordinator_review",
          renderReviewMessage(workflow, completed.completion as CompletionRecord),
          {
            requestId: options.requestId,
            workflowId: options.workflowId,
            handoffId: completed.handoffId,
            iteration,
            sessionRole: "A"
          }
        ), { responseId }
      );
      const aOutcome = await this.acceptAgentAResponse({
        bindingA: options.bindingA,
        bindingB: options.bindingB,
        workflowId: options.workflowId,
        allowedHandoffIterations: [iteration + 1],
        allowedFinalIterations: [iteration],
        requestId: options.requestId,
        submit,
        iteration
      });

      if (aOutcome.kind === "final") {
        const finalRecord = createFinalizedRecord({
          workflowId: options.workflowId,
          requestId: options.requestId,
          binding: options.bindingA,
          finalDecision: aOutcome.finalDecision,
          userTask: options.userTask
        });
        state = await this.persistRecord(state, finalRecord);
        this.logWorkflowEvent("workflow.finalized", options.bindingA, options, {
          workflowId: options.workflowId,
          handoffId: completed.handoffId,
          iteration: finalRecord.iteration,
          decision: aOutcome.finalDecision.decision,
          durationMs: Date.now() - options.startedAt
        });
        return {
          state,
          result: buildWorkflowRunResult(
            finalRecord.finalDecision,
            statusFromFinal(finalRecord.finalDecision),
            options.requestId
          )
        };
      }

      envelope = aOutcome.envelope;
    }
  }
}

function renderInitialPlanningMessage(options: {
  workflowId: string;
  requestId: string;
  iteration: number;
  maxReviewRounds: number;
  userTask: string;
}): string {
  return [
    "Coordinator planning prompt for Agent A.",
    "You own planning, review, and final sign-off for this workflow.",
    ...PLANNING_GUIDANCE,
    "When you finalize a workflow, keep `pi-final.summary` short and make `pi-final.userResponse` specific about implementation details, touched files or areas, verification, and any remaining caveats.",
    `Workflow ID: ${options.workflowId}`,
    `Request ID: ${options.requestId}`,
    `Iteration: ${options.iteration}`,
    `Max review rounds: ${options.maxReviewRounds}`,
    "",
    "User objective:",
    options.userTask,
    "",
    "If no Agent B execution is needed, emit `pi-final`. Otherwise emit `pi-handoff`."
  ].join("\n");
}

function createPreparedRecord(options: {
  workflowId: string;
  requestId: string;
  binding: RoleRuntimeBinding;
  envelope: HandoffEnvelope;
  userTask: string;
}): HandoffRecord {
  return {
    workflowId: options.workflowId,
    handoffId: options.envelope.handoffId,
    iteration: options.envelope.iteration,
    status: "prepared",
    role: "A",
    requestId: options.requestId,
    sessionId: options.binding.sessionId,
    sessionFile: options.binding.sessionFile,
    timestamp: new Date().toISOString(),
    envelope: options.envelope,
    details: {
      userTask: options.userTask
    }
  };
}

function createCompletedRecord(options: {
  workflowId: string;
  requestId: string;
  binding: RoleRuntimeBinding;
  completion: CompletionRecord;
}): HandoffRecord {
  return {
    workflowId: options.workflowId,
    handoffId: options.completion.handoffId,
    iteration: options.completion.iteration,
    status: "completed",
    role: "B",
    requestId: options.requestId,
    sessionId: options.binding.sessionId,
    sessionFile: options.binding.sessionFile,
    timestamp: new Date().toISOString(),
    completion: options.completion
  };
}

function createFinalizedRecord(options: {
  workflowId: string;
  requestId: string;
  binding: RoleRuntimeBinding;
  finalDecision: FinalDecisionRecord;
  userTask: string;
}): HandoffRecord {
  return {
    workflowId: options.workflowId,
    iteration: options.finalDecision.iteration,
    status: "finalized",
    role: "A",
    requestId: options.requestId,
    sessionId: options.binding.sessionId,
    sessionFile: options.binding.sessionFile,
    timestamp: new Date().toISOString(),
    finalDecision: options.finalDecision,
    details: {
      userTask: options.userTask
    }
  };
}

function createTerminalRecord(options: {
  workflowId: string;
  iteration: number;
  requestId: string;
  binding: RoleRuntimeBinding;
  status: Extract<WorkflowRunStatus, "blocked" | "capped">;
  userTask: string;
  details: Record<string, unknown>;
}): HandoffRecord {
  return {
    workflowId: options.workflowId,
    iteration: options.iteration,
    status: options.status,
    role: "coordinator",
    requestId: options.requestId,
    sessionId: options.binding.sessionId,
    sessionFile: options.binding.sessionFile,
    timestamp: new Date().toISOString(),
    details: {
      userTask: options.userTask,
      ...options.details
    }
  };
}

function selectWorkflowSnapshot(state: WorkflowState, workflowId: string): WorkflowSnapshot {
  const workflow = state.workflows[workflowId];
  if (!workflow) {
    return {
      workflowId,
      status: "running",
      currentIteration: 0,
      iterations: [],
      repairCount: 0,
      capCount: 0
    };
  }
  return workflow;
}

function buildWorkflowRunResult(
  finalDecision: FinalDecisionRecord | undefined,
  status: WorkflowRunStatus,
  requestId: string
): WorkflowRunResult {
  return {
    workflowId: finalDecision?.workflowId ?? "",
    status,
    iterations: finalDecision?.iteration ?? 0,
    userResponse:
      finalDecision?.userResponse ??
      "The workflow ended without a final Agent A response.",
    finalSummary:
      finalDecision?.summary ??
      "The workflow ended without a final Agent A response.",
    changedPaths: finalDecision?.changedPaths ?? [],
    requestId
  };
}

function buildCoordinatorFailureResult(options: {
  workflowId: string;
  requestId: string;
  iteration: number;
  status: Extract<WorkflowRunStatus, "blocked" | "capped">;
  summary: string;
}): WorkflowRunResult {
  return {
    workflowId: options.workflowId,
    status: options.status,
    iterations: options.iteration,
    userResponse: options.summary,
    finalSummary: options.summary,
    changedPaths: [],
    requestId: options.requestId
  };
}

function statusFromFinal(finalDecision: FinalDecisionRecord | undefined): WorkflowRunStatus {
  return finalDecision?.decision === "approved" ? "completed" : "blocked";
}

function formatBindingModelDisplay(binding: RoleRuntimeBinding) {
  return getModelDisplayInfo(binding.session.model);
}

function deriveUnexpectedApprovedPlanFailure(
  options: ApprovedPlanWorkflowOptions,
  currentState: WorkflowState | undefined,
  error: unknown
): {
  workflowId: string;
  iteration: number;
  binding: RoleRuntimeBinding;
  reason: string;
} {
  const workflow = currentState?.workflows[options.initialEnvelope.workflowId];
  const latestIteration = workflow?.currentIteration ?? options.initialEnvelope.iteration;
  const binding =
    error instanceof ExecutionEvidenceError ? options.bindingB
      : error instanceof ExecutionCheckInError || workflow?.latestCompletion || workflow?.finalDecision ? options.bindingA : options.bindingB;
  return {
    workflowId: options.initialEnvelope.workflowId,
    iteration: latestIteration,
    binding,
    reason: error instanceof Error ? error.message : String(error)
  };
}

export function createWorkflowHandoffEnvelope(options: {
  workflowId: string;
  handoffId?: string | undefined;
  iteration: number;
  requestId: string;
  objective: string;
  summary: string;
  acceptanceCriteria: string[];
  relevantPaths: string[];
  executionPlan?: string[] | undefined;
  reviewNotes?: string[] | undefined;
  constraints?: string[] | undefined;
}): HandoffEnvelope {
  return {
    schemaVersion: 1,
    workflowId: options.workflowId,
    handoffId: options.handoffId ?? createHandoffId(),
    iteration: options.iteration,
    objective: options.objective,
    summary: options.summary,
    acceptanceCriteria: options.acceptanceCriteria,
    relevantPaths: options.relevantPaths,
    executionPlan: options.executionPlan,
    reviewNotes: options.reviewNotes,
    constraints: options.constraints,
    requestId: options.requestId
  };
}
