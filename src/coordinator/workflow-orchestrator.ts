import { randomUUID } from "node:crypto";

import { withPromptProvenance } from "../app/prompt-provenance.js";
import { createHandoffId } from "../handoff/handoff-id.js";
import { applyTransition } from "./handoff-state-machine.js";
import { deliverHandoff } from "./deliver-handoff.js";
import { renderCapExceededMessage, renderRepairMessage } from "../workflow/render-final-message.js";
import { renderReviewMessage } from "../workflow/render-review-message.js";
import { resolveAgentAResponse, resolveAgentBResponse } from "./review-cycle.js";
import { normalizeLifecycleEvent } from "../telemetry/event-normalizer.js";
import { SessionLedger } from "../persistence/session-ledger.js";
import type { RuntimeEventBridge } from "./bind-runtime-events.js";
import type { RoleRuntimeBinding } from "../runtime/create-role-runtime.js";
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
  public constructor(
    private readonly ledger: SessionLedger,
    private readonly bridge: RuntimeEventBridge,
    private readonly logger: TelemetryLogger,
    private readonly metrics: Metrics
  ) {}

  public async run(options: WorkflowOrchestratorOptions): Promise<{
    state: WorkflowState;
    result: WorkflowRunResult;
  }> {
    let state = options.state;
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

      let agentAMessage = await this.bridge.promptAndWaitForTurnEnd(
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
        initialPromptOptions
      );

      const aOutcome = await this.acceptAgentAResponse({
        bindingA: options.bindingA,
        bindingB: options.bindingB,
        workflowId,
        allowedHandoffIterations: [1],
        allowedFinalIterations: [1],
        requestId: options.requestId,
        message: agentAMessage
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

      return this.runApprovedPlanLoop({
        ...options,
        state,
        startedAt,
        workflowId,
        initialEnvelope: aOutcome.envelope
      });
    } catch (error) {
      if (!(error instanceof WorkflowProtocolError)) {
        throw error;
      }

      const blockedRecord = createTerminalRecord({
        workflowId: error.details.workflowId,
        iteration: error.details.iteration,
        requestId: options.requestId,
        binding: error.details.role === "A" ? options.bindingA : options.bindingB,
        status: "blocked",
        userTask: options.userTask,
        details: {
          reason: error.details.reason,
          role: error.details.role
        }
      });
      state = await this.persistRecord(state, blockedRecord);
      this.logWorkflowEvent("workflow.blocked", error.details.role === "A" ? options.bindingA : options.bindingB, options, {
        workflowId: error.details.workflowId,
        handoffId: undefined,
        iteration: error.details.iteration,
        reason: error.details.reason,
        durationMs: Date.now() - startedAt
      });
      return {
        state,
        result: buildCoordinatorFailureResult({
          workflowId: error.details.workflowId,
          requestId: options.requestId,
          iteration: error.details.iteration,
          status: "blocked",
          summary: `Workflow blocked: ${error.details.reason}`
        })
      };
    }
  }

  public async runFromApprovedPlan(options: ApprovedPlanWorkflowOptions): Promise<{
    state: WorkflowState;
    result: WorkflowRunResult;
  }> {
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
      if (!(error instanceof WorkflowProtocolError)) {
        throw error;
      }

      const blockedRecord = createTerminalRecord({
        workflowId: error.details.workflowId,
        iteration: error.details.iteration,
        requestId: options.requestId,
        binding: error.details.role === "A" ? options.bindingA : options.bindingB,
        status: "blocked",
        userTask: options.userTask,
        details: {
          reason: error.details.reason,
          role: error.details.role
        }
      });
      const state = await this.persistRecord(options.state, blockedRecord);
      this.logWorkflowEvent(
        "workflow.blocked",
        error.details.role === "A" ? options.bindingA : options.bindingB,
        options,
        {
          workflowId: error.details.workflowId,
          handoffId: options.initialEnvelope.handoffId,
          iteration: error.details.iteration,
          reason: error.details.reason
        }
      );
      return {
        state,
        result: buildCoordinatorFailureResult({
          workflowId: error.details.workflowId,
          requestId: options.requestId,
          iteration: error.details.iteration,
          status: "blocked",
          summary: `Workflow blocked: ${error.details.reason}`
        })
      };
    }
  }

  private async acceptAgentAResponse(options: {
    bindingA: RoleRuntimeBinding;
    bindingB: RoleRuntimeBinding;
    workflowId: string;
    allowedHandoffIterations: number[];
    allowedFinalIterations: number[];
    requestId: string;
    message: Awaited<ReturnType<RuntimeEventBridge["promptAndWaitForTurnEnd"]>>;
    expectedBlockType?: "pi-final" | "pi-handoff-or-pi-final";
  }): Promise<
    | { kind: "handoff"; envelope: HandoffEnvelope }
    | { kind: "final"; finalDecision: FinalDecisionRecord }
  > {
    const first = resolveAgentAResponse({
      message: options.message,
      workflowId: options.workflowId,
      allowedHandoffIterations: options.allowedHandoffIterations,
      allowedFinalIterations: options.allowedFinalIterations
    });
    if (first.kind !== "invalid" && this.matchesExpectedBlock(first.kind, options.expectedBlockType)) {
      return first;
    }

    const repairRecord = createRepairRecord({
      workflowId: options.workflowId,
      iteration: [
        ...options.allowedFinalIterations,
        ...options.allowedHandoffIterations
      ].sort((left, right) => right - left)[0] ?? 1,
      requestId: options.requestId,
      binding: options.bindingA,
      reason: first.kind === "invalid" ? first.reason : "unexpected block type from Agent A"
    });
    await this.persistRecordNoStateMutation(repairRecord);
    this.logWorkflowEvent("workflow.repair_requested", options.bindingA, {
      bindingA: options.bindingA,
      bindingB: options.bindingB,
      requestId: options.requestId
    }, {
      workflowId: options.workflowId,
      handoffId: undefined,
      iteration:
        [...options.allowedFinalIterations, ...options.allowedHandoffIterations].sort(
          (left, right) => right - left
        )[0] ?? 1,
      reason: repairRecord.details?.reason
    });

    const repairedMessage = await this.bridge.promptAndWaitForTurnEnd(
      options.bindingA,
      withPromptProvenance(
        "coordinator_repair",
        renderRepairMessage(
          "A",
          options.expectedBlockType ?? "pi-handoff-or-pi-final",
          first.kind === "invalid" ? first.reason : "unexpected block type",
          options.allowedFinalIterations.length === 1 &&
            options.allowedHandoffIterations.length === 1
            ? `For this turn, \`pi-final.iteration\` must be ${options.allowedFinalIterations[0]} and \`pi-handoff.iteration\` must be ${options.allowedHandoffIterations[0]}.`
            : undefined
        ),
        {
          requestId: options.requestId,
          workflowId: options.workflowId,
          iteration:
            [...options.allowedFinalIterations, ...options.allowedHandoffIterations].sort(
              (left, right) => right - left
            )[0] ?? 1,
          sessionRole: "A"
        }
      )
    );
    const repaired = resolveAgentAResponse({
      message: repairedMessage,
      workflowId: options.workflowId,
      allowedHandoffIterations: options.allowedHandoffIterations,
      allowedFinalIterations: options.allowedFinalIterations
    });
    if (repaired.kind !== "invalid" && this.matchesExpectedBlock(repaired.kind, options.expectedBlockType)) {
      return repaired;
    }

    throw new WorkflowProtocolError({
      role: "A",
      workflowId: options.workflowId,
      iteration:
        [...options.allowedFinalIterations, ...options.allowedHandoffIterations].sort(
          (left, right) => right - left
        )[0] ?? 1,
      reason:
        repaired.kind === "invalid" ? repaired.reason : "unexpected block type from Agent A after repair"
    });
  }

  private async acceptAgentBResponse(options: {
    bindingB: RoleRuntimeBinding;
    bindingA: RoleRuntimeBinding;
    workflowId: string;
    handoffId: string;
    iteration: number;
    requestId: string;
    message: Awaited<ReturnType<RuntimeEventBridge["promptAndWaitForTurnEnd"]>>;
  }): Promise<CompletionRecord> {
    const first = resolveAgentBResponse({
      message: options.message,
      workflowId: options.workflowId,
      handoffId: options.handoffId,
      iteration: options.iteration
    });
    if (first.kind === "completion") {
      return first.completion;
    }

    const repairRecord = createRepairRecord({
      workflowId: options.workflowId,
      iteration: options.iteration,
      requestId: options.requestId,
      binding: options.bindingB,
      handoffId: options.handoffId,
      reason: first.reason
    });
    await this.persistRecordNoStateMutation(repairRecord);
    this.logWorkflowEvent("workflow.repair_requested", options.bindingB, {
      bindingA: options.bindingA,
      bindingB: options.bindingB,
      requestId: options.requestId
    }, {
      workflowId: options.workflowId,
      handoffId: options.handoffId,
      iteration: options.iteration,
      reason: repairRecord.details?.reason
    });

    const repairedMessage = await this.bridge.promptAndWaitForTurnEnd(
      options.bindingB,
      withPromptProvenance(
        "coordinator_repair",
        renderRepairMessage("B", "pi-completion", first.reason),
        {
          requestId: options.requestId,
          workflowId: options.workflowId,
          handoffId: options.handoffId,
          iteration: options.iteration,
          sessionRole: "B"
        }
      )
    );
    const repaired = resolveAgentBResponse({
      message: repairedMessage,
      workflowId: options.workflowId,
      handoffId: options.handoffId,
      iteration: options.iteration
    });
    if (repaired.kind === "completion") {
      return repaired.completion;
    }

    throw new WorkflowProtocolError({
      role: "B",
      workflowId: options.workflowId,
      iteration: options.iteration,
      reason: repaired.reason
    });
  }

  private async persistRecord(state: WorkflowState, record: HandoffRecord): Promise<WorkflowState> {
    await this.ledger.append(record);
    return applyTransition(state, record);
  }

  private async persistRecordNoStateMutation(record: HandoffRecord): Promise<void> {
    await this.ledger.append(record);
  }

  private logWorkflowEvent(
    eventType: string,
    actor: RoleRuntimeBinding,
    options: Pick<WorkflowOrchestratorOptions, "bindingA" | "bindingB" | "requestId">,
    details: Record<string, unknown>
  ): void {
    const event = normalizeLifecycleEvent({
      role: actor.role,
      sessionId: actor.sessionId,
      sessionFile: actor.sessionFile,
      eventType,
      requestId: options.requestId,
      details: {
        ...details,
        modelA: modelLabel(options.bindingA),
        modelB: modelLabel(options.bindingB),
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

      const { delivered, message: agentBMessage } = await deliverHandoff({
        prepared,
        binding: options.bindingB,
        bridge: this.bridge
      });
      state = await this.persistRecord(state, delivered);
      this.logWorkflowEvent("workflow.iteration_delivered", options.bindingB, options, {
        workflowId: options.workflowId,
        handoffId: delivered.handoffId,
        iteration
      });

      const bOutcome = await this.acceptAgentBResponse({
        bindingB: options.bindingB,
        bindingA: options.bindingA,
        workflowId: options.workflowId,
        handoffId: prepared.handoffId ?? envelope.handoffId,
        iteration,
        requestId: options.requestId,
        message: agentBMessage
      });

      const completed = createCompletedRecord({
        workflowId: options.workflowId,
        requestId: options.requestId,
        binding: options.bindingB,
        completion: bOutcome
      });
      state = await this.persistRecord(state, completed);
      this.logWorkflowEvent("workflow.iteration_completed", options.bindingB, options, {
        workflowId: options.workflowId,
        handoffId: completed.handoffId,
        iteration
      });

      const workflow = selectWorkflowSnapshot(state, options.workflowId);
      if (iteration >= options.maxReviewRounds) {
        const agentAMessage = await this.bridge.promptAndWaitForTurnEnd(
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
          )
        );
        const cappedOutcome = await this.acceptAgentAResponse({
          bindingA: options.bindingA,
          bindingB: options.bindingB,
          workflowId: options.workflowId,
          allowedHandoffIterations: [],
          allowedFinalIterations: [iteration],
          requestId: options.requestId,
          message: agentAMessage,
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

      const agentAMessage = await this.bridge.promptAndWaitForTurnEnd(
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
        )
      );
      const aOutcome = await this.acceptAgentAResponse({
        bindingA: options.bindingA,
        bindingB: options.bindingB,
        workflowId: options.workflowId,
        allowedHandoffIterations: [iteration + 1],
        allowedFinalIterations: [iteration],
        requestId: options.requestId,
        message: agentAMessage
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

function createRepairRecord(options: {
  workflowId: string;
  iteration: number;
  requestId: string;
  binding: RoleRuntimeBinding;
  handoffId?: string | undefined;
  reason: string;
}): HandoffRecord {
  return {
    workflowId: options.workflowId,
    handoffId: options.handoffId,
    iteration: options.iteration,
    status: "repair_requested",
    role: "coordinator",
    requestId: options.requestId,
    sessionId: options.binding.sessionId,
    sessionFile: options.binding.sessionFile,
    timestamp: new Date().toISOString(),
    details: {
      reason: options.reason
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

function modelLabel(binding: RoleRuntimeBinding): string {
  return binding.session.model
    ? `${binding.session.model.provider}/${binding.session.model.id}`
    : "(pi-default)";
}

export class WorkflowProtocolError extends Error {
  public constructor(
    public readonly details: {
      role: "A" | "B";
      workflowId: string;
      iteration: number;
      reason: string;
    }
  ) {
    super(`${details.role} protocol error: ${details.reason}`);
  }
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
