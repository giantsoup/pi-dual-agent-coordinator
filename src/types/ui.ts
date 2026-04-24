import type { ActivitySnapshot } from "../app/activity-summary.js";
import type { ParsedReplCommand } from "../app/cli.js";
import type { CoordinatorStatusSnapshot } from "./status.js";
import type { Role } from "./role.js";
import type { PendingExecutionPlanSnapshot } from "./workflow.js";

export type UiSettingsFieldSource =
  | "cli"
  | "thread"
  | "project"
  | "global"
  | "legacy";

export type UiSettingsScope = "global" | "project" | "thread";
export type UiProviderKind =
  | "openai-codex"
  | "openai"
  | "lm-studio"
  | "ollama"
  | "custom-openai-compatible";

export interface UiProviderAuthState {
  connected: boolean;
  label: string;
  source:
    | "oauth"
    | "stored-key"
    | "env-var"
    | "custom-env-var"
    | "no-auth"
    | "unknown";
  detail?: string | undefined;
}

export interface UiProviderDiscoveryState {
  available: boolean;
  reachable: boolean;
  running?: boolean | undefined;
  installed?: boolean | undefined;
  modelsFound: number;
  label: string;
  detail?: string | undefined;
  lastVerifiedAt?: string | undefined;
}

export interface UiProviderVerifyState {
  status: "idle" | "running" | "passed" | "failed";
  message?: string | undefined;
  target?: string | undefined;
  checkedAt?: string | undefined;
  nextStep?: string | undefined;
}

export interface UiSelectableModel {
  id: string;
  provider: string;
  canonicalRef: string;
  name: string;
  available: boolean;
  reasoning: boolean;
  supportsReasoningEffort: boolean;
  input: Array<"text" | "image">;
  contextWindow?: number | undefined;
  maxTokens?: number | undefined;
  detail?: string | undefined;
}

export interface UiSettingsProviderState {
  id: string;
  kind: UiProviderKind;
  label: string;
  auth: UiProviderAuthState;
  discovery: UiProviderDiscoveryState;
  verify: UiProviderVerifyState;
  hidden?: boolean | undefined;
  sourceModelCount: number;
  defaultModelId?: string | undefined;
}

export interface UiSettingsProviderCatalog {
  providers: UiSettingsProviderState[];
  catalogByProvider: Record<string, UiSelectableModel[]>;
  lastDiscoveryAt?: string | undefined;
}

export interface UiSettingsValues {
  modelA?: string | undefined;
  modelB?: string | undefined;
  thinkingA?: "off" | "low" | "medium" | "high" | undefined;
  thinkingB?: "off" | "low" | "medium" | "high" | undefined;
  mcpEnabled?: boolean | undefined;
}

export interface UiSettingsOverrides {
  modelA?: string | null | undefined;
  modelB?: string | null | undefined;
  thinkingA?: "off" | "low" | "medium" | "high" | null | undefined;
  thinkingB?: "off" | "low" | "medium" | "high" | null | undefined;
  mcpEnabled?: boolean | null | undefined;
}

export interface UiSettingsScopeState {
  scope: UiSettingsScope;
  label: string;
  description?: string | undefined;
  available: boolean;
  hasOverrides: boolean;
  values: UiSettingsValues;
}

export interface UiSettingsState {
  activeScope: UiSettingsScope;
  scopes: Record<UiSettingsScope, UiSettingsScopeState>;
  effective: {
    values: UiSettingsValues;
    sources: Record<keyof UiSettingsValues, UiSettingsFieldSource>;
  };
  providers: UiSettingsProviderState[];
  catalogByProvider: Record<string, UiSelectableModel[]>;
  lastDiscoveryAt?: string | undefined;
  providerOperation?:
    | {
        kind:
          | "refresh"
          | "connect_oauth"
          | "save_api_key"
          | "save_custom_provider"
          | "verify_target";
        provider: string;
        status: "idle" | "running" | "error";
        message?: string | undefined;
      }
    | undefined;
}

export interface UiWorkspaceThread {
  id: string;
  threadId: string;
  title: string;
  projectHash: string;
  projectName: string;
  projectPath: string;
  startedAt: string;
  updatedAt: string;
  latestStatus: string;
  latestSummary?: string | undefined;
  activeModelA?: string | undefined;
  activeModelB?: string | undefined;
  resumable: boolean;
  isActive: boolean;
}

export interface UiWorkspaceProject {
  id: string;
  projectHash: string;
  projectName: string;
  projectPath: string;
  threads: UiWorkspaceThread[];
}

export interface UiRecentProject {
  path: string;
  name: string;
  lastOpenedAt: string;
}

export interface UiWorkspaceState {
  projects: UiWorkspaceProject[];
  recentProjects: UiRecentProject[];
  threads: UiWorkspaceThread[];
  activeThreadId?: string | undefined;
  selectedThreadId?: string | undefined;
}

export type UiTimelineActor = "operator" | "system" | Role;
export type UiTimelineActivityKind =
  | "message"
  | "thinking"
  | "mcp"
  | "harness"
  | "workflow"
  | "plan"
  | "system";
export type UiTimelineStatus = "active" | "completed" | "failed";

export interface UiTimelineChildRow {
  id: string;
  toolCallId?: string | undefined;
  toolName?: string | undefined;
  summary: string;
  detailPreview?: string | undefined;
  target?: string | undefined;
  argsPreview?: string | undefined;
  resultPreview?: string | undefined;
  errorPreview?: string | undefined;
  status: UiTimelineStatus;
  startedAt: string;
  updatedAt: string;
}

export interface UiTimelineMessageItem {
  id: string;
  kind: "message";
  threadId: string;
  activityKind: "message";
  actor: UiTimelineActor;
  sourceLabel: string;
  createdAt: string;
  text: string;
  streaming: boolean;
}

export interface UiTimelineGroupItem {
  id: string;
  kind: "group";
  threadId: string;
  activityKind: Exclude<UiTimelineActivityKind, "message">;
  actor: UiTimelineActor;
  sourceLabel: string;
  summary: string;
  startedAt: string;
  updatedAt: string;
  durationMs?: number | undefined;
  status: UiTimelineStatus;
  expanded: boolean;
  inline?: boolean | undefined;
  requestId?: string | undefined;
  turnIndex?: number | undefined;
  rows: UiTimelineChildRow[];
  expansionMode?: "auto" | "manual" | undefined;
}

export type UiTimelineItem = UiTimelineMessageItem | UiTimelineGroupItem;

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
      kind: "help" | "status" | "sessions" | "handoff";
      title: string;
      content: string;
      format: "text" | "json";
      createdAt: string;
    };

export interface UiCommandPaletteState {
  open: boolean;
}

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
  status: "active" | "completed" | "failed";
  toolName?: string | undefined;
  toolCallId?: string | undefined;
  startedAt: string;
  updatedAt: string;
}

export interface UiRuntimeActivityHistory {
  sessionId: string;
  totals: UiRuntimeActivityTotals;
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
  workspace: UiWorkspaceState;
  timeline: UiTimelineItem[];
  activeView: "thread" | "settings";
  settings: UiSettingsState;
  liveStream?: UiStreamingState | undefined;
  activity: UiActivityState;
  pendingPlan?: UiPendingPlanState | undefined;
  modal: UiModalState;
  commandPalette: UiCommandPaletteState;
  notifications: UiNotification[];
  notification?: UiNotification | undefined;
  lastError?: UiNotification | undefined;
  shouldExit: boolean;
}

export type UiAction =
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
      type: "select_thread";
      threadId: string;
    }
  | {
      type: "launch_project_thread";
      projectPath: string;
    }
  | {
      type: "open_settings";
      scope?: UiSettingsScope | undefined;
    }
  | {
      type: "close_settings";
    }
  | {
      type: "save_settings";
      scope: UiSettingsScope;
      values: UiSettingsOverrides;
    }
  | {
      type: "refresh_settings_providers";
    }
  | {
      type: "connect_provider_oauth";
      provider: "openai-codex";
    }
  | {
      type: "save_provider_api_key";
      provider: "openai";
      mode: "paste-now" | "openai-api-key-env" | "custom-env";
      value?: string | undefined;
    }
  | {
      type: "save_custom_provider";
      label: string;
      baseUrl: string;
      authMode: "paste-now" | "env-var" | "custom-env" | "no-auth";
      authValue?: string | undefined;
      modelId: string;
    }
  | {
      type: "verify_provider_target";
      provider: string;
      modelId?: string | undefined;
    }
  | {
      type: "set_timeline_group_expanded";
      itemId: string;
      expanded: boolean;
    }
  | {
      type: "close_modal";
    }
  | {
      type: "set_command_palette";
      open: boolean;
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
      type: "timeline_appended";
      state: InteractiveUiState;
      items: UiTimelineItem[];
    }
  | {
      type: "workspace_updated";
      state: InteractiveUiState;
      workspace: UiWorkspaceState;
    }
  | {
      type: "settings_updated";
      state: InteractiveUiState;
      settings: UiSettingsState;
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
