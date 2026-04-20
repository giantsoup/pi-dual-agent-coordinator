import { randomUUID } from "node:crypto";

import { buildHelpText } from "../repl-progress.js";
import { deriveActivityUpdate } from "../activity-summary.js";
import { parseReplCommand } from "../cli.js";
import {
  createConversationEntry,
  createInitialInteractiveUiState,
  interactiveUiReducer,
  type InteractiveStoreAction
} from "./store.js";
import {
  renderPendingPlan,
  renderHandoffSummary,
  renderSessionsSummary
} from "./presentation.js";
import type { RuntimeUiBridgeEvent } from "../../coordinator/bind-runtime-events.js";
import type { CoordinatorStatusSnapshot } from "../../types/status.js";
import type { NormalizedTelemetryEvent } from "../../types/telemetry.js";
import type {
  InteractiveUiState,
  UiAction,
  UiConversationEntryDraft,
  UiEvent,
  UiNotification
} from "../../types/ui.js";
import type { CoordinatorTurnResult } from "../../types/workflow.js";
import type { Role } from "../../types/role.js";

export interface InteractiveCoordinatorLike {
  start(): Promise<void>;
  submitUserInput(text: string): Promise<CoordinatorTurnResult>;
  approvePendingPlan(): Promise<CoordinatorTurnResult>;
  discardPendingPlan(): void;
  getStatus(): CoordinatorStatusSnapshot;
  getSessions(): unknown;
  getLastHandoff(): Promise<unknown>;
  subscribeEvents(listener: (event: NormalizedTelemetryEvent) => void): () => void;
  subscribeRuntimeUiEvents(listener: (event: RuntimeUiBridgeEvent) => void): () => void;
  replaceRuntime(
    role: Role,
    action: { type: "new"; role: Role } | { type: "switch"; role: Role; sessionPath: string }
  ): Promise<void>;
  dispose(): Promise<void>;
}

export interface InteractiveCoordinatorService {
  start(): Promise<void>;
  dispose(): Promise<void>;
  dispatch(action: UiAction): Promise<void>;
  getState(): InteractiveUiState;
  subscribeState(listener: (state: InteractiveUiState) => void): () => void;
  subscribeUiEvents(listener: (event: UiEvent) => void): () => void;
}

const WORKFLOW_TERMINAL_EVENTS = new Set([
  "workflow.finalized",
  "workflow.blocked",
  "workflow.capped"
]);

export class HeadlessInteractiveCoordinatorService
  implements InteractiveCoordinatorService
{
  private readonly stateListeners = new Set<(state: InteractiveUiState) => void>();
  private readonly uiListeners = new Set<(event: UiEvent) => void>();
  private readonly unsubscribers: Array<() => void> = [];
  private state = createInitialInteractiveUiState(createEmptyStatusSnapshot());
  private started = false;
  private disposed = false;

  public constructor(private readonly coordinator: InteractiveCoordinatorLike) {}

  public async start(): Promise<void> {
    if (this.disposed) {
      throw new Error("Interactive coordinator service has already been disposed.");
    }
    if (this.started) {
      return;
    }

    await this.coordinator.start();
    this.started = true;
    this.state = createInitialInteractiveUiState(this.coordinator.getStatus());
    this.emitStateChanged();

    this.unsubscribers.push(
      this.coordinator.subscribeEvents((event) => {
        this.handleTelemetryEvent(event);
      })
    );
    this.unsubscribers.push(
      this.coordinator.subscribeRuntimeUiEvents((event) => {
        this.handleRuntimeUiEvent(event);
      })
    );
  }

  public async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    while (this.unsubscribers.length > 0) {
      this.unsubscribers.pop()?.();
    }
    this.stateListeners.clear();
    this.uiListeners.clear();
    await this.coordinator.dispose();
  }

  public getState(): InteractiveUiState {
    return this.state;
  }

  public subscribeState(listener: (state: InteractiveUiState) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  public subscribeUiEvents(listener: (event: UiEvent) => void): () => void {
    this.uiListeners.add(listener);
    return () => {
      this.uiListeners.delete(listener);
    };
  }

  public async dispatch(action: UiAction): Promise<void> {
    this.assertDispatchReady();

    try {
      switch (action.type) {
        case "submit_input": {
          const command = parseReplCommand(action.input);
          if (command.type !== "user_turn") {
            await this.dispatch({
              type: "run_repl_command",
              command
            });
            return;
          }

          if (!command.text) {
            return;
          }

          this.appendConversationEntry({
            kind: "operator_message",
            text: command.text
          });
          const result = await this.coordinator.submitUserInput(command.text);
          this.appendResultEntries(result);
          this.refreshStatus();
          return;
        }
        case "run_repl_command":
          await this.dispatchReplCommand(action.command);
          return;
        case "open_help":
          this.updateState({
            type: "set_modal",
            modal: {
              kind: "help",
              title: "Help",
              content: buildHelpText(false),
              format: "text",
              createdAt: new Date().toISOString()
            }
          });
          return;
        case "open_status":
          this.refreshStatus();
          this.updateState({
            type: "set_modal",
            modal: {
              kind: "status",
              title: "Status",
              content: JSON.stringify(this.state.status, null, 2),
              format: "json",
              createdAt: new Date().toISOString()
            }
          });
          return;
        case "open_sessions": {
          this.refreshStatus();
          const sessions = this.coordinator.getSessions();
          this.updateState({
            type: "set_modal",
            modal: {
              kind: "sessions",
              title: "Sessions",
              content: renderSessionsSummary(this.state.status, sessions),
              format: "text",
              createdAt: new Date().toISOString()
            }
          });
          return;
        }
        case "open_handoff": {
          const handoff = await this.coordinator.getLastHandoff();
          this.updateState({
            type: "set_modal",
            modal: {
              kind: "handoff",
              title: "Latest Handoff",
              content: renderHandoffSummary(handoff),
              format: "text",
              createdAt: new Date().toISOString()
            }
          });
          return;
        }
        case "approve_pending_plan": {
          const result = await this.coordinator.approvePendingPlan();
          this.appendConversationEntry({
            kind: "approval_discard",
            action: "approved",
            text: "Approved the pending plan."
          });
          this.appendResultEntries(result);
          this.refreshStatus();
          return;
        }
        case "discard_pending_plan":
          if (!this.state.pendingPlan) {
            this.raiseNotification({
              level: "info",
              scope: "operator",
              code: "pending_plan.absent",
              message: "No pending plan to discard.",
              relatedAction: action.type
            });
            return;
          }
          this.coordinator.discardPendingPlan();
          this.appendConversationEntry({
            kind: "approval_discard",
            action: "discarded",
            text: "Discarded the pending plan."
          });
          this.refreshStatus();
          return;
        case "replace_runtime":
          await this.coordinator.replaceRuntime(
            action.role,
            action.mode === "new"
              ? { type: "new", role: action.role }
              : {
                  type: "switch",
                  role: action.role,
                  sessionPath: action.sessionPath ?? ""
                }
          );
          this.appendConversationEntry({
            kind: "runtime_session",
            action: action.mode,
            role: action.role,
            sessionPath: action.sessionPath,
            text:
              action.mode === "new"
                ? `Created new session for role ${action.role}.`
                : `Switched role ${action.role} to ${action.sessionPath}.`
          });
          this.refreshStatus();
          return;
        case "close_modal":
          this.updateState({
            type: "set_modal",
            modal: { kind: "none" }
          });
          return;
        case "set_command_palette":
          this.updateState({
            type: "set_command_palette",
            open: action.open
          });
          return;
        case "quit":
          this.updateState({
            type: "set_should_exit",
            value: true
          });
          return;
      }
    } catch (error) {
      this.handleDispatchError(error);
    }
  }

  private async dispatchReplCommand(
    command: ReturnType<typeof parseReplCommand>
  ): Promise<void> {
    switch (command.type) {
      case "user_turn":
        if (command.text) {
          await this.dispatch({
            type: "submit_input",
            input: command.text
          });
        }
        return;
      case "help":
        await this.dispatch({ type: "open_help" });
        return;
      case "status":
        await this.dispatch({ type: "open_status" });
        return;
      case "approve":
        await this.dispatch({ type: "approve_pending_plan" });
        return;
      case "discard":
        await this.dispatch({ type: "discard_pending_plan" });
        return;
      case "sessions":
        await this.dispatch({ type: "open_sessions" });
        return;
      case "handoff":
        await this.dispatch({ type: "open_handoff" });
        return;
      case "new":
        await this.dispatch({
          type: "replace_runtime",
          role: command.role,
          mode: "new"
        });
        return;
      case "switch":
        await this.dispatch({
          type: "replace_runtime",
          role: command.role,
          mode: "switch",
          sessionPath: command.sessionPath
        });
        return;
      case "quit":
        await this.dispatch({ type: "quit" });
        return;
    }
  }

  private handleTelemetryEvent(event: NormalizedTelemetryEvent): void {
    if (this.disposed) {
      return;
    }
    const status = this.coordinator.getStatus();
    const update = deriveActivityUpdate(event, status);
    this.updateState({
      type: "replace_status",
      status
    });
    if (update) {
      this.updateState({
        type: "apply_activity_update",
        update
      });
      this.emitUiEvent({
        type: "activity_changed",
        state: this.state,
        activity: this.state.activity
      });
    }
    if (WORKFLOW_TERMINAL_EVENTS.has(event.eventType)) {
      this.updateState({
        type: "replace_activity",
        activity: { runtimes: {} }
      });
      this.emitUiEvent({
        type: "activity_changed",
        state: this.state,
        activity: this.state.activity
      });
    }
  }

  private handleRuntimeUiEvent(event: RuntimeUiBridgeEvent): void {
    if (this.disposed) {
      return;
    }
    if (event.type === "assistant_text_delta") {
      this.updateState({
        type: "append_stream_delta",
        role: event.role,
        sessionId: event.sessionId,
        delta: event.delta,
        timestamp: event.timestamp
      });
      this.emitUiEvent({
        type: "stream_delta_appended",
        state: this.state,
        role: event.role,
        sessionId: event.sessionId,
        delta: event.delta
      });
      return;
    }

    const committedText =
      this.state.liveStream?.role === event.role &&
      this.state.liveStream.sessionId === event.sessionId
        ? this.state.liveStream.text
        : event.text;

    this.updateState({
      type: "commit_stream",
      role: event.role,
      sessionId: event.sessionId
    });
    this.emitUiEvent({
      type: "stream_committed",
      state: this.state,
      role: event.role,
      sessionId: event.sessionId,
      text: committedText
    });
  }

  private appendResultEntries(result: CoordinatorTurnResult): void {
    const prose = result.userResponse.trim();
    if (prose) {
      this.appendConversationEntry(
        result.workflow
          ? {
              kind: "workflow_summary",
              workflowId: result.workflow.workflowId,
              status: result.workflow.status,
              text: prose
            }
          : {
              kind: "assistant_planning_response",
              role: "A" as const,
              text: prose
            }
      );
    }

    if (result.pendingPlan) {
      this.appendConversationEntry({
        kind: "plan_ready",
        text: renderPendingPlan(result.pendingPlan, result.nextActionHint),
        plan: result.pendingPlan,
        nextActionHint: result.nextActionHint
      });
    }
  }

  private appendConversationEntry<T extends UiConversationEntryDraft>(
    entry: T
  ): void {
    this.updateState({
      type: "append_entry",
      entry: createConversationEntry(entry)
    });
  }

  private raiseNotification(
    notification: Omit<UiNotification, "id" | "createdAt">
  ): void {
    const completeNotification = createUiNotification(notification);
    const action: InteractiveStoreAction =
      completeNotification.level === "error"
        ? {
            type: "set_error",
            error: completeNotification
          }
        : {
            type: "set_notification",
            notification: completeNotification
          };
    this.updateState(action);
    this.emitUiEvent({
      type: "notification_raised",
      state: this.state,
      notification: completeNotification
    });
  }

  private handleDispatchError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const notification = createUiNotification({
      level: "error",
      scope: "service",
      code: "dispatch.failed",
      message,
      detail: error instanceof Error && error.stack ? error.stack : undefined,
      fatal: true
    });
    this.updateState({
      type: "set_error",
      error: notification
    });
    this.appendConversationEntry({
      kind: "error",
      text: `Error: ${message}`
    });
    this.emitUiEvent({
      type: "fatal_error",
      state: this.state,
      error: notification
    });
  }

  private refreshStatus(): void {
    this.updateState({
      type: "replace_status",
      status: this.coordinator.getStatus()
    });
  }

  private updateState(action: InteractiveStoreAction): void {
    if (this.disposed) {
      return;
    }
    this.state = interactiveUiReducer(this.state, action);
    this.emitStateChanged();
  }

  private emitStateChanged(): void {
    if (this.disposed) {
      return;
    }
    for (const listener of this.stateListeners) {
      listener(this.state);
    }
    this.emitUiEvent({
      type: "state_changed",
      state: this.state
    });
  }

  private emitUiEvent(event: UiEvent): void {
    if (this.disposed) {
      return;
    }
    for (const listener of this.uiListeners) {
      listener(event);
    }
  }

  private assertDispatchReady(): void {
    if (this.disposed) {
      throw new Error("Interactive coordinator service has already been disposed.");
    }
    if (!this.started) {
      throw new Error("Interactive coordinator service has not been started.");
    }
  }
}

function createEmptyStatusSnapshot(): CoordinatorStatusSnapshot {
  return {
    cwd: "",
    conversationMode: "planning",
    phase: "planning",
    phaseLabel: "Planning",
    activeRole: "A",
    activeRoleLabel: "Agent A",
    activeModelDisplay: "(pi-default)",
    sessionRoot: "(memory)",
    repairCount: 0,
    maxReviewRounds: 3,
    runtimes: [],
    metrics: {}
  };
}

function createUiNotification(
  notification: Omit<UiNotification, "id" | "createdAt">
): UiNotification {
  return {
    ...notification,
    id: randomUUID(),
    createdAt: new Date().toISOString()
  };
}
