import { randomUUID } from "node:crypto";

import {
  applyActivityHistoryEvent,
  syncActivityHistoryWithStatus
} from "../activity-history.js";
import type { ActivitySnapshot, ActivityUpdate } from "../activity-summary.js";
import type { NormalizedTelemetryEvent } from "../../types/telemetry.js";
import type { CoordinatorStatusSnapshot } from "../../types/status.js";
import type {
  InteractiveUiState,
  UiActivityState,
  UiConversationEntry,
  UiConversationEntryDraft,
  UiModalState,
  UiNotification
} from "../../types/ui.js";

interface StoreActionMap {
  replace_status: {
    status: CoordinatorStatusSnapshot;
  };
  append_entry: {
    entry: UiConversationEntry;
  };
  set_modal: {
    modal: UiModalState;
  };
  append_stream_delta: {
    role: "A" | "B";
    sessionId: string;
    delta: string;
    timestamp: string;
  };
  commit_stream: {
    role: "A" | "B";
    sessionId: string;
  };
  replace_activity: {
    activity: UiActivityState;
  };
  apply_activity_update: {
    update: ActivityUpdate;
  };
  apply_activity_history_event: {
    event: NormalizedTelemetryEvent;
    snapshot?: ActivitySnapshot | undefined;
  };
  set_notification: {
    notification?: UiNotification | undefined;
  };
  set_error: {
    error?: UiNotification | undefined;
  };
  set_command_palette: {
    open: boolean;
  };
  set_should_exit: {
    value: boolean;
  };
}

export type InteractiveStoreAction = {
  [Key in keyof StoreActionMap]: {
    type: Key;
  } & StoreActionMap[Key];
}[keyof StoreActionMap];

export function createInitialInteractiveUiState(
  status: CoordinatorStatusSnapshot
): InteractiveUiState {
  return {
    status,
    conversation: [],
    activity: {
      runtimes: {},
      history: {}
    },
    pendingPlan: status.pendingPlan
      ? {
          plan: status.pendingPlan,
          nextActionHint: status.nextActionHint
        }
      : undefined,
    modal: { kind: "none" },
    commandPalette: {
      open: false
    },
    notifications: [],
    shouldExit: false
  };
}

export function interactiveUiReducer(
  state: InteractiveUiState,
  action: InteractiveStoreAction
): InteractiveUiState {
  switch (action.type) {
    case "replace_status":
      return {
        ...state,
        status: action.status,
        activity: syncActivityHistoryWithStatus(state.activity, action.status),
        pendingPlan: action.status.pendingPlan
          ? {
              plan: action.status.pendingPlan,
              nextActionHint: action.status.nextActionHint
            }
          : undefined
      };
    case "append_entry":
      return {
        ...state,
        conversation: [...state.conversation, action.entry]
      };
    case "set_modal":
      return {
        ...state,
        modal: action.modal
      };
    case "append_stream_delta": {
      const liveStream =
        state.liveStream &&
        state.liveStream.role === action.role &&
        state.liveStream.sessionId === action.sessionId
          ? state.liveStream
          : {
              role: action.role,
              sessionId: action.sessionId,
              text: "",
              startedAt: action.timestamp
            };

      return {
        ...state,
        liveStream: {
          ...liveStream,
          text: `${liveStream.text}${action.delta}`
        }
      };
    }
    case "commit_stream":
      if (
        !state.liveStream ||
        state.liveStream.role !== action.role ||
        state.liveStream.sessionId !== action.sessionId
      ) {
        return state;
      }
      return {
        ...state,
        liveStream: undefined
      };
    case "replace_activity":
      return {
        ...state,
        activity: action.activity
      };
    case "apply_activity_update":
      return {
        ...state,
        activity: applyActivityUpdate(state.activity, action.update)
      };
    case "apply_activity_history_event":
      return {
        ...state,
        activity: applyActivityHistoryEvent(state.activity, action.event, action.snapshot)
      };
    case "set_notification":
      return {
        ...state,
        notifications: updateNotifications(state.notifications, action.notification),
        notification: action.notification
      };
    case "set_error":
      return {
        ...state,
        notifications: updateNotifications(state.notifications, action.error),
        lastError: action.error
      };
    case "set_command_palette":
      return {
        ...state,
        commandPalette: {
          open: action.open
        }
      };
    case "set_should_exit":
      return {
        ...state,
        shouldExit: action.value
      };
  }
}

export function createConversationEntry<T extends UiConversationEntryDraft>(
  entry: T,
  createdAt = new Date().toISOString()
): Extract<UiConversationEntry, T & { kind: UiConversationEntry["kind"] }> {
  return {
    ...entry,
    id: randomUUID(),
    createdAt
  } as Extract<UiConversationEntry, T & { kind: UiConversationEntry["kind"] }>;
}

function applyActivityUpdate(
  activity: UiActivityState,
  update: ActivityUpdate
): UiActivityState {
  if (update.clear) {
    if (update.role === "coordinator") {
      return {
        ...activity,
        active:
          activity.active?.role === "coordinator" ? undefined : activity.active,
        coordinator: undefined
      };
    }

    const nextRuntimes = { ...activity.runtimes };
    delete nextRuntimes[update.role];
    return {
      ...activity,
      active: activity.active?.role === update.role ? undefined : activity.active,
      runtimes: nextRuntimes
    };
  }

  if (!update.snapshot) {
    return activity;
  }

  if (update.role === "coordinator") {
    return {
      ...activity,
      active: update.snapshot,
      coordinator: update.snapshot
    };
  }

  return {
    ...activity,
    active: update.snapshot,
    runtimes: {
      ...activity.runtimes,
      [update.role]: update.snapshot
    }
  };
}

export function cloneActivitySnapshot(
  activity?: ActivitySnapshot | undefined
): ActivitySnapshot | undefined {
  if (!activity) {
    return undefined;
  }

  return {
    ...activity
  };
}

function updateNotifications(
  notifications: UiNotification[],
  notification?: UiNotification | undefined
): UiNotification[] {
  if (!notification) {
    return notifications;
  }

  return [...notifications, notification].slice(-20);
}
