import type { CompletionRecord, FinalDecisionRecord, HandoffEnvelope, HandoffRecord } from "./handoff.js";

export type WorkflowRunStatus = "running" | "completed" | "blocked" | "capped";

export interface WorkflowRunResult {
  workflowId: string;
  status: WorkflowRunStatus;
  iterations: number;
  userResponse: string;
  finalSummary: string;
  changedPaths: string[];
  requestId: string;
}

export interface WorkflowIterationState {
  iteration: number;
  handoffId?: string | undefined;
  prepared?: HandoffRecord | undefined;
  delivered?: HandoffRecord | undefined;
  completed?: HandoffRecord | undefined;
}

export interface WorkflowSnapshot {
  workflowId: string;
  requestId?: string | undefined;
  status: WorkflowRunStatus;
  currentIteration: number;
  userTask?: string | undefined;
  latestHandoff?: HandoffEnvelope | undefined;
  latestCompletion?: CompletionRecord | undefined;
  finalDecision?: FinalDecisionRecord | undefined;
  latestIteration?: WorkflowIterationState | undefined;
  iterations: WorkflowIterationState[];
  repairCount: number;
  capCount: number;
  startedAt?: string | undefined;
  updatedAt?: string | undefined;
}

export interface WorkflowState {
  activeWorkflowId?: string | undefined;
  latestWorkflowId?: string | undefined;
  workflows: Record<string, WorkflowSnapshot>;
  records: HandoffRecord[];
}

export function isWorkflowTerminal(status: WorkflowRunStatus): boolean {
  return status === "completed" || status === "blocked" || status === "capped";
}
