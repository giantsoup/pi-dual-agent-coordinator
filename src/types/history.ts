import type { ResponseProgress } from "../coordinator/response-progress.js";
import type { Role } from "./role.js";
import type { ExecutionProgress } from "../workflow/execution-progress.js";

export type RecordOutcome =
  | { kind: "running"; startedAt: string }
  | { kind: "waiting_approval"; endedAt: string }
  | { kind: "interrupted"; endedAt: string | null }
  | { kind: "completed" | "failed" | "cancelled" | "timed_out"; endedAt: string };
interface HistoryBase {
  id: string;
  title: string;
  timestamp: string;
  outcome: RecordOutcome;
}
export type HistoryRecord =
  | (HistoryBase & { kind: "turn"; requestIds: string[]; planId?: string | undefined; workflowId?: string | undefined; execution?: ExecutionProgress | undefined; responseProgress?: ResponseProgress | undefined })
  | (HistoryBase & { kind: "run"; parentId: string; role: Role; sessionId: string; sessionFile?: string | undefined; branchId?: string | undefined; requestId?: string | undefined; workflowId?: string | undefined; handoffId?: string | undefined; phase: string })
  | (HistoryBase & { kind: "tool"; parentId: string; role: Role; sessionId: string; callId: string; toolName: string; request: string; preview: string });
export interface HistorySnapshot {
  records: HistoryRecord[];
  currentTurnId?: string | undefined;
  resetId?: string | undefined;
  revision: number;
  warnings: string[];
}
export interface HistoryDetail {
  recordId: string;
  section: "summary" | "request" | "output" | "metadata";
  offset: number;
  lines: string[];
  totalLines: number;
  reason?: string | undefined;
}
export const roleLabel = (role: Role): string => role === "A" ? "A - Senior" : "B - Junior";
