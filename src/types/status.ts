import type { ResponseProgress } from "../coordinator/response-progress.js";
import type { Role } from "./role.js";
import type {
  ConversationMode,
  PendingExecutionPlanSnapshot,
  WorkflowRunStatus
} from "./workflow.js";
import type { CoordinatorMcpStatusSnapshot } from "../mcp/types.js";

export type CoordinatorUiPhase = "planning" | "execution" | "review" | "repair";

export interface RuntimeStatusSnapshot {
  role: Role;
  sessionId: string;
  sessionFile?: string | undefined;
  cwd: string;
  modelName?: string | undefined;
  modelProvider?: string | undefined;
  modelId?: string | undefined;
  modelCanonical?: string | undefined;
  modelDisplay: string;
  thinking: string;
  healthy: boolean;
  currentActivity?: string | undefined;
  currentReason?: string | undefined;
  currentTarget?: string | undefined;
  lastToolName?: string | undefined;
}

export interface CoordinatorStatusSnapshot {
  operation?: { kind: "idle" | "running" | "cancelling" | "completed" | "failed" | "cancelled" | "timed_out" } | undefined;
  cwd: string;
  conversationMode: ConversationMode;
  phase: CoordinatorUiPhase;
  phaseLabel: string;
  activeRole: Role;
  activeRoleLabel: string;
  activeModelName?: string | undefined;
  activeModelProvider?: string | undefined;
  activeModelId?: string | undefined;
  activeModelCanonical?: string | undefined;
  activeModelDisplay: string;
  sessionRoot: string;
  lastSummary?: string | undefined;
  pendingPlan?: PendingExecutionPlanSnapshot | undefined;
  pendingPlanReady?: boolean | undefined;
  nextActionHint?: string | undefined;
  activeWorkflowId?: string | undefined;
  currentIteration?: number | undefined;
  workflowStatus?: WorkflowRunStatus | undefined;
  currentActivity?: string | undefined;
  currentReason?: string | undefined;
  currentTarget?: string | undefined;
  coordinatorActivity?: string | undefined;
  coordinatorReason?: string | undefined;
  lastCompletionSummary?: string | undefined;
  responseProgress?: ResponseProgress | undefined;
  repairCount: number;
  maxReviewRounds: number;
  timeoutMs?: number;
  runtimes: RuntimeStatusSnapshot[];
  mcp?: CoordinatorMcpStatusSnapshot;
  metrics: Record<string, number>;
}
