import type { Role } from "./role.js";

export type HandoffStatus =
  | "prepared"
  | "delivered"
  | "completed"
  | "finalized"
  | "blocked"
  | "capped"
  | "repair_requested"
  | "superseded";

export type HandoffRecordActor = Role | "coordinator";

export interface HandoffEnvelope {
  schemaVersion: 1;
  workflowId: string;
  handoffId: string;
  iteration: number;
  objective: string;
  summary: string;
  acceptanceCriteria: string[];
  relevantPaths: string[];
  executionPlan?: string[] | undefined;
  reviewNotes?: string[] | undefined;
  constraints?: string[] | undefined;
  requestId?: string | undefined;
  originatingTurnIndex?: number | undefined;
}

export interface ExecutionPlanEnvelope {
  schemaVersion: 1;
  objective: string;
  summary: string;
  acceptanceCriteria: string[];
  relevantPaths: string[];
  executionPlan: string[];
  constraints?: string[] | undefined;
}

export type PlanProposalEnvelope = ExecutionPlanEnvelope;

export interface CompletionRecord {
  schemaVersion: 1;
  workflowId: string;
  handoffId: string;
  iteration: number;
  summary: string;
  changedPaths: string[];
  verification?: string[] | undefined;
  openQuestions?: string[] | undefined;
  requestId?: string | undefined;
  originatingTurnIndex?: number | undefined;
}

export interface FinalDecisionRecord {
  schemaVersion: 1;
  workflowId: string;
  iteration: number;
  decision: "approved" | "blocked";
  summary: string;
  userResponse: string;
  changedPaths: string[];
  followUps?: string[] | undefined;
  requestId?: string | undefined;
}

export interface HandoffRecord {
  workflowId: string;
  handoffId?: string | undefined;
  iteration: number;
  status: HandoffStatus;
  role: HandoffRecordActor;
  requestId?: string | undefined;
  sessionId: string;
  sessionFile?: string | undefined;
  timestamp: string;
  envelope?: HandoffEnvelope | undefined;
  completion?: CompletionRecord | undefined;
  finalDecision?: FinalDecisionRecord | undefined;
  details?: Record<string, unknown> | undefined;
}
