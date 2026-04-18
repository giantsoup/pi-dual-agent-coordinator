import type { Role } from "./role.js";

export type HandoffStatus = "prepared" | "delivered" | "acked" | "completed" | "superseded";

export interface HandoffEnvelope {
  schemaVersion: 1;
  handoffId: string;
  objective: string;
  summary: string;
  acceptanceCriteria: string[];
  relevantPaths: string[];
  constraints?: string[] | undefined;
  requestId?: string | undefined;
  originatingTurnIndex?: number | undefined;
}

export interface CompletionRecord {
  schemaVersion: 1;
  handoffId: string;
  summary: string;
  changedPaths: string[];
  verification?: string[] | undefined;
  requestId?: string | undefined;
  originatingTurnIndex?: number | undefined;
}

export interface HandoffRecord {
  handoffId: string;
  status: HandoffStatus;
  role: Role;
  requestId?: string | undefined;
  sessionId: string;
  sessionFile?: string | undefined;
  timestamp: string;
  envelope?: HandoffEnvelope | undefined;
  completion?: CompletionRecord | undefined;
  details?: Record<string, unknown> | undefined;
}

export interface HandoffState {
  activeHandoffId?: string | undefined;
  lastPrepared?: HandoffRecord | undefined;
  lastDelivered?: HandoffRecord | undefined;
  lastCompleted?: HandoffRecord | undefined;
  records: HandoffRecord[];
}
