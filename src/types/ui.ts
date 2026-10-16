import type { ActivitySnapshot } from "../app/activity-summary.js";
import type { ParsedReplCommand } from "../app/cli.js";
import type { CoordinatorStatusSnapshot } from "./status.js";
import type { Role } from "./role.js";
import type { PendingExecutionPlanSnapshot } from "./workflow.js";

export interface UiNotification {
  id: string;
  level: "info" | "error";
  scope: "system" | "service" | "workflow" | "runtime" | "operator";
  code: string;
  title?: string | undefined;
  message: string;
  detail?: string | undefined;
  nextStep?: string | undefined;
  fatal?: boolean | undefined;
  relatedAction?: UiAction["type"] | undefined;
  createdAt: string;
}

export interface UiStreamingState {
  role: Role;
  sessionId: string;
  text: string;
  startedAt: string;
}

export interface UiPendingPlanState {
  plan: PendingExecutionPlanSnapshot;
  nextActionHint?: string | undefined;
}

export type UiModalState =
  | {
      kind: "none";
    }
  | {
      kind: "help" | "status" | "sessions" | "handoff" | "settings" | "history" | "records" | "record_detail";
      title: string;
      content: string;
      format: "text" | "json";
      createdAt: string;
      choices?: Array<{ label: string; value: string; action: UiAction }> | undefined;
    };

export interface UiRuntimeActivityTotals {
  reads: number;
  searches: number;
  listings: number;
  writes: number;
  edits: number;
  commands: number;
  mcpCalls: number;
  otherTools: number;
}

export interface UiRuntimeActivityHistoryItem {
  id: string;
  text: string;
  detail?: string | undefined;
  status: "active" | "completed" | "failed" | "cancelled" | "timed_out" | "interrupted";
  toolName?: string | undefined;
  toolCallId?: string | undefined;
  startedAt: string;
  updatedAt: string;
}

export interface UiRuntimeActivityHistory {
  sessionId: string;
  totals: UiRuntimeActivityTotals;
  seenCalls?: string[] | undefined;
  recent: UiRuntimeActivityHistoryItem[];
  updatedAt?: string | undefined;
}

export interface UiActivityState {
  active?: ActivitySnapshot | undefined;
  coordinator?: ActivitySnapshot | undefined;
  runtimes: Partial<Record<Role, ActivitySnapshot>>;
  history: Partial<Record<Role, UiRuntimeActivityHistory>>;
}

interface UiConversationEntryBase {
  id: string;
  createdAt: string;
  text: string;
}

export type UiConversationEntry =
  | (UiConversationEntryBase & {
      kind: "operator_message";
    })
  | (UiConversationEntryBase & {
      kind: "assistant_planning_response";
      role: Role;
    })
  | (UiConversationEntryBase & {
      kind: "workflow_summary";
      workflowId?: string | undefined;
      status?: string | undefined;
    })
  | (UiConversationEntryBase & {
      kind: "plan_ready";
      plan: PendingExecutionPlanSnapshot;
      nextActionHint?: string | undefined;
    })
  | (UiConversationEntryBase & {
      kind: "approval_discard";
      action: "approved" | "discarded";
    })
  | (UiConversationEntryBase & {
      kind: "runtime_session";
      action: "new" | "switch";
      role: Role;
      sessionPath?: string | undefined;
    })
  | (UiConversationEntryBase & {
      kind: "error";
    });

export type UiConversationEntryDraft =
  | {
      kind: "operator_message";
      text: string;
    }
  | {
      kind: "assistant_planning_response";
      role: Role;
      text: string;
    }
  | {
      kind: "workflow_summary";
      workflowId?: string | undefined;
      status?: string | undefined;
      text: string;
    }
  | {
      kind: "plan_ready";
      plan: PendingExecutionPlanSnapshot;
      nextActionHint?: string | undefined;
      text: string;
    }
  | {
      kind: "approval_discard";
      action: "approved" | "discarded";
      text: string;
    }
  | {
      kind: "runtime_session";
      action: "new" | "switch";
      role: Role;
      sessionPath?: string | undefined;
      text: string;
    }
  | {
      kind: "error";
      text: string;
    };

export interface InteractiveUiState {
  status: CoordinatorStatusSnapshot;
  conversation: UiConversationEntry[];
  liveStream?: UiStreamingState | undefined;
  activity: UiActivityState;
  pendingPlan?: UiPendingPlanState | undefined;
  modal: UiModalState;
  notifications: UiNotification[];
  notification?: UiNotification | undefined;
  lastError?: UiNotification | undefined;
  history: import("./history.js").HistorySnapshot;
  operation: NonNullable<CoordinatorStatusSnapshot["operation"]>;
  shouldExit: boolean;
}

export type UiAction =
  | { type: "open_records" }
  | { type: "inspect_record"; id: string; section?: import("./history.js").HistoryDetail["section"]; offset?: number }
  | { type: "open_models"; role: Role }
  | { type: "open_thinking"; role: Role }
  | { type: "configure_role"; role: Role; model?: string; thinking?: import("../runtime/create-role-runtime.js").SupportedThinkingLevel; save: boolean }
  | { type: "configure_defaults"; key: "review-rounds" | "timeout-ms"; value: number; save: boolean }
  | { type: "view_session"; role: Role; sessionPath: string }
  | { type: "select_choice"; value: string }

  | {
      type: "submit_input";
      input: string;
    }
  | {
      type: "run_repl_command";
      command: ParsedReplCommand;
    }
  | {
      type: "open_help";
    }
  | {
      type: "open_status";
    }
  | {
      type: "open_sessions";
      role?: Role;
    }
  | {
      type: "open_handoff";
    }
  | {
      type: "approve_pending_plan";
    }
  | {
      type: "discard_pending_plan";
    }
  | {
      type: "replace_runtime";
      role: Role;
      mode: "new" | "switch";
      sessionPath?: string | undefined;
    }
  | {
      type: "close_modal";
    }
  | {
      type: "cancel";
    }
  | {
      type: "quit";
    };

export type UiEvent =
  | {
      type: "state_changed";
      state: InteractiveUiState;
    }
  | {
      type: "stream_delta_appended";
      state: InteractiveUiState;
      role: Role;
      sessionId: string;
      delta: string;
    }
  | {
      type: "stream_committed";
      state: InteractiveUiState;
      role: Role;
      sessionId: string;
      text: string;
    }
  | {
      type: "activity_changed";
      state: InteractiveUiState;
      activity: UiActivityState;
    }
  | {
      type: "notification_raised";
      state: InteractiveUiState;
      notification: UiNotification;
    }
  | {
      type: "fatal_error";
      state: InteractiveUiState;
      error: UiNotification;
    };
