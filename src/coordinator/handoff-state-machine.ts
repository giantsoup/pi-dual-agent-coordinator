import type { HandoffRecord } from "../types/handoff.js";
import type {
  WorkflowIterationState,
  WorkflowRunStatus,
  WorkflowSnapshot,
  WorkflowState
} from "../types/workflow.js";
import { isWorkflowTerminal } from "../types/workflow.js";

export function createEmptyHandoffState(): WorkflowState {
  return {
    workflows: {},
    records: []
  };
}

export function replayHandoffState(records: HandoffRecord[]): WorkflowState {
  return records.reduce((state, record) => applyTransition(state, record), createEmptyHandoffState());
}

export function applyTransition(state: WorkflowState, record: HandoffRecord): WorkflowState {
  const existing = state.workflows[record.workflowId];
  const status = deriveWorkflowStatus(record, existing?.status);
  const iterations = upsertIteration(existing?.iterations ?? [], record);
  const nextWorkflow: WorkflowSnapshot = {
    workflowId: record.workflowId,
    requestId: record.requestId ?? existing?.requestId,
    status,
    currentIteration: Math.max(existing?.currentIteration ?? 0, record.iteration),
    userTask:
      (typeof record.details?.userTask === "string"
        ? record.details.userTask
        : undefined) ?? existing?.userTask,
    latestHandoff: record.envelope ?? existing?.latestHandoff,
    latestCompletion: record.completion ?? existing?.latestCompletion,
    finalDecision: record.finalDecision ?? existing?.finalDecision,
    latestIteration: iterations.find((item) => item.iteration === record.iteration),
    iterations,
    repairCount:
      (existing?.repairCount ?? 0) + (record.status === "repair_requested" ? 1 : 0),
    capCount: (existing?.capCount ?? 0) + (record.status === "capped" ? 1 : 0),
    startedAt: existing?.startedAt ?? record.timestamp,
    updatedAt: record.timestamp
  };

  const nextState: WorkflowState = {
    activeWorkflowId: isWorkflowTerminal(nextWorkflow.status) ? undefined : record.workflowId,
    latestWorkflowId: record.workflowId,
    workflows: {
      ...state.workflows,
      [record.workflowId]: nextWorkflow
    },
    records: [...state.records, record]
  };

  if (
    state.activeWorkflowId &&
    state.activeWorkflowId !== record.workflowId &&
    !isWorkflowTerminal(state.workflows[state.activeWorkflowId]?.status ?? "running")
  ) {
    nextState.activeWorkflowId = state.activeWorkflowId;
  }

  return nextState;
}

function deriveWorkflowStatus(
  record: HandoffRecord,
  previous: WorkflowRunStatus | undefined
): WorkflowRunStatus {
  switch (record.status) {
    case "finalized":
      return record.finalDecision?.decision === "approved" ? "completed" : "blocked";
    case "blocked":
    case "superseded":
      return "blocked";
    case "capped":
      return "capped";
    default:
      return previous ?? "running";
  }
}

function upsertIteration(
  iterations: WorkflowIterationState[],
  record: HandoffRecord
): WorkflowIterationState[] {
  const existing = iterations.find((item) => item.iteration === record.iteration) ?? {
    iteration: record.iteration
  };
  const updated: WorkflowIterationState = {
    ...existing,
    handoffId: record.handoffId ?? existing.handoffId
  };

  if (record.status === "prepared") {
    updated.prepared = record;
  }
  if (record.status === "delivered") {
    updated.delivered = record;
  }
  if (record.status === "completed") {
    updated.completed = record;
  }

  const remainder = iterations.filter((item) => item.iteration !== record.iteration);
  return [...remainder, updated].sort((left, right) => left.iteration - right.iteration);
}
