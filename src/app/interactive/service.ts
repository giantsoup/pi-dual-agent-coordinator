import { randomUUID } from "node:crypto";

import { buildHelpText } from "../repl-progress.js";
import { deriveActivityUpdate } from "../activity-summary.js";
import { parseReplCommand, type PortalCliOptions } from "../cli.js";
import {
  appendConversationEntryToTimeline,
  applyRuntimeUiEventToTimeline,
  applyTelemetryEventToTimeline,
  setTimelineGroupExpanded
} from "./timeline.js";
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
import {
  renderNoticeText,
  renderProjectLaunchBlockedNotice,
  renderProjectLaunchSuccessNotice,
  renderProjectValidationNotice
} from "../presentation/notices.js";
import {
  resolveUiSettingsState,
  saveUiSettings
} from "../settings-store.js";
import {
  SettingsProviderService,
  augmentSettingsWithProviderCatalog
} from "../settings-provider-service.js";
import {
  buildThreadManifest,
  loadWorkspaceIndex,
  readThreadView,
  writeThreadManifest,
  writeThreadView,
  type PersistedThreadView
} from "../workspace-index.js";
import { ProjectLauncherService } from "../project-launcher-service.js";
import type { RuntimeUiBridgeEvent } from "../../coordinator/bind-runtime-events.js";
import type { CoordinatorStatusSnapshot } from "../../types/status.js";
import type { NormalizedTelemetryEvent } from "../../types/telemetry.js";
import type {
  InteractiveUiState,
  UiAction,
  UiConversationEntryDraft,
  UiEvent,
  UiNotification,
  UiPendingPlanState,
  UiSettingsScope,
  UiTimelineItem,
  UiWorkspaceState
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

export interface InteractiveCoordinatorServiceDependencies {
  settingsProviderService?: SettingsProviderService | undefined;
  createCoordinator?(options: PortalCliOptions): InteractiveCoordinatorLike;
  portalOptions?: PortalCliOptions | undefined;
  projectLauncherService?: ProjectLauncherService | undefined;
}

export class InteractiveActionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InteractiveActionError";
  }
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
  private readonly coordinatorUnsubscribers: Array<() => void> = [];
  private state = createInitialInteractiveUiState(createEmptyStatusSnapshot());
  private readonly threadViews = new Map<string, ThreadUiProjection>();
  private liveThreadId = createEmptyStatusSnapshot().threadId;
  private started = false;
  private disposed = false;
  private readonly settingsProviderService: SettingsProviderService;
  private readonly createCoordinator?: ((options: PortalCliOptions) => InteractiveCoordinatorLike) | undefined;
  private readonly portalOptions?: PortalCliOptions | undefined;
  private readonly projectLauncherService: ProjectLauncherService;
  private settingsRefreshToken = 0;

  public constructor(
    private coordinator: InteractiveCoordinatorLike,
    dependencies: InteractiveCoordinatorServiceDependencies = {}
  ) {
    this.settingsProviderService =
      dependencies.settingsProviderService ?? new SettingsProviderService();
    this.createCoordinator = dependencies.createCoordinator;
    this.portalOptions = dependencies.portalOptions;
    this.projectLauncherService =
      dependencies.projectLauncherService ?? new ProjectLauncherService();
  }

  public async start(): Promise<void> {
    if (this.disposed) {
      throw new Error("Interactive coordinator service has already been disposed.");
    }
    if (this.started) {
      return;
    }

    await this.coordinator.start();
    this.started = true;
    this.initializeLiveStateFromCoordinator();
    await this.refreshWorkspace(this.liveThreadId);
    await this.refreshSettings();
    await this.persistThreadProjection(this.liveThreadId);
    this.emitStateChanged();
    this.attachCoordinatorSubscriptions();
  }

  public async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.detachCoordinatorSubscriptions();
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
          this.assertLiveThreadSelected();
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
        case "select_thread":
          await this.selectThread(action.threadId);
          return;
        case "launch_project_thread":
          await this.launchProjectThread(action.projectPath);
          return;
        case "open_settings":
          this.updateState({
            type: "set_active_view",
            activeView: "settings"
          });
          this.updateState({
            type: "replace_settings",
            settings: {
              ...this.state.settings,
              activeScope: action.scope ?? this.state.settings.activeScope
            }
          });
          this.scheduleSettingsRefresh({
            scope: action.scope,
            providerOperation: {
              kind: "refresh",
              provider: "settings",
              status: "running"
            }
          });
          return;
        case "close_settings":
          this.updateState({
            type: "set_active_view",
            activeView: "thread"
          });
          return;
        case "save_settings":
          await this.ensureManagedProvidersForSettings(action.values);
          await saveUiSettings({
            projectPath: this.state.status.cwd,
            scope: action.scope,
            threadId: this.state.status.threadId,
            values: action.values
          });
          await this.refreshSettings(action.scope);
          if (action.scope !== "thread") {
            await this.refreshWorkspace();
          }
          return;
        case "refresh_settings_providers":
          this.scheduleSettingsRefresh({
            forceProviderRefresh: true,
            providerOperation: {
              kind: "refresh",
              provider: "settings",
              status: "running"
            }
          });
          return;
        case "connect_provider_oauth":
          this.startSettingsProviderAction(
            {
              kind: "connect_oauth",
              provider: action.provider
            },
            async (refreshToken, providerOperation) => {
              const providerCatalog =
                await this.settingsProviderService.connectProviderOauth(action.provider);
              await this.refreshSettings(undefined, undefined, {
                providerCatalog,
                providerOperation,
                refreshToken
              });
            }
          );
          return;
        case "save_provider_api_key":
          this.startSettingsProviderAction(
            {
              kind: "save_api_key",
              provider: action.provider
            },
            async (refreshToken, providerOperation) => {
              const providerCatalog =
                await this.settingsProviderService.saveOpenAiApiKey({
                  mode: action.mode,
                  value: action.value
                });
              await this.refreshSettings(undefined, undefined, {
                providerCatalog,
                providerOperation,
                refreshToken
              });
            }
          );
          return;
        case "save_custom_provider":
          this.startSettingsProviderAction(
            {
              kind: "save_custom_provider",
              provider: "custom-openai-compatible"
            },
            async (refreshToken, providerOperation) => {
              const providerCatalog =
                await this.settingsProviderService.saveCustomProvider({
                  label: action.label,
                  baseUrl: action.baseUrl,
                  authMode: action.authMode,
                  authValue: action.authValue,
                  modelId: action.modelId
                });
              await this.refreshSettings(undefined, undefined, {
                providerCatalog,
                providerOperation,
                refreshToken
              });
            }
          );
          return;
        case "verify_provider_target":
          this.startSettingsProviderAction(
            {
              kind: "verify_target",
              provider: action.provider
            },
            async (refreshToken, providerOperation) => {
              const providerCatalog =
                await this.settingsProviderService.verifyTarget({
                  provider: action.provider,
                  modelId: action.modelId
                });
              await this.refreshSettings(undefined, undefined, {
                providerCatalog,
                providerOperation,
                refreshToken
              });
            }
          );
          return;
        case "set_timeline_group_expanded":
          this.updateState({
            type: "replace_timeline",
            timeline: setTimelineGroupExpanded(
              this.state.timeline,
              action.itemId,
              action.expanded
            )
          });
          await this.persistSelectedThreadProjection();
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
          this.refreshStatusForLiveThreadIfSelected();
          this.updateState({
            type: "set_modal",
            modal: {
              kind: "status",
              title: "Status",
              content: JSON.stringify(this.getSelectedThreadStatus(), null, 2),
              format: "json",
              createdAt: new Date().toISOString()
            }
          });
          return;
        case "open_sessions": {
          this.refreshStatusForLiveThreadIfSelected();
          const status = this.getSelectedThreadStatus();
          const sessions = this.isSelectedThreadLive()
            ? this.coordinator.getSessions()
            : status.runtimes;
          this.updateState({
            type: "set_modal",
            modal: {
              kind: "sessions",
              title: "Sessions",
              content: renderSessionsSummary(status, sessions),
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
          this.assertLiveThreadSelected();
          const result = await this.coordinator.approvePendingPlan();
          this.appendConversationEntry({
            kind: "approval_discard",
            action: "approved",
            text: "Approved the pending plan."
          });
          this.raiseNotification({
            level: "info",
            scope: "workflow",
            code: "pending_plan.approved",
            title: "Plan approved",
            message: "Execution started for this project.",
            nextStep:
              "Wait for Agent B to finish the work, then Agent A will review the result.",
            relatedAction: action.type
          });
          this.appendResultEntries(result);
          this.refreshStatus();
          return;
        }
        case "discard_pending_plan":
          this.assertLiveThreadSelected();
          if (!this.state.pendingPlan) {
            this.raiseNotification({
              level: "info",
              scope: "operator",
              code: "pending_plan.absent",
              title: "There is no pending plan to discard",
              message: "PI Dual is not waiting on a plan decision right now.",
              nextStep: "Send another prompt if you want Agent A to draft a new plan.",
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
          this.raiseNotification({
            level: "info",
            scope: "workflow",
            code: "pending_plan.discarded",
            title: "Plan discarded",
            message: "The pending plan was cleared for this thread.",
            nextStep: "Send another prompt if you want a revised plan."
          });
          this.refreshStatus();
          return;
        case "replace_runtime":
          this.assertLiveThreadSelected();
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
          this.raiseNotification({
            level: "info",
            scope: "runtime",
            code:
              action.mode === "new"
                ? "runtime.session.created"
                : "runtime.session.switched",
            title:
              action.mode === "new"
                ? `New ${action.role === "A" ? "Agent A" : "Agent B"} session selected`
                : `${action.role === "A" ? "Agent A" : "Agent B"} session switched`,
            message:
              action.mode === "new"
                ? "The next turn will use a fresh session for this role."
                : `The next turn will use ${action.sessionPath}.`,
            nextStep: "Send the next prompt when you are ready."
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
      if (error instanceof InteractiveActionError) {
        throw error;
      }
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

  private initializeLiveStateFromCoordinator(): void {
    this.state = createInitialInteractiveUiState(this.coordinator.getStatus());
    this.liveThreadId = this.state.status.threadId;
    this.threadViews.set(this.liveThreadId, extractThreadProjection(this.state));
  }

  private attachCoordinatorSubscriptions(): void {
    this.coordinatorUnsubscribers.push(
      this.coordinator.subscribeEvents((event) => {
        this.handleTelemetryEvent(event);
      })
    );
    this.coordinatorUnsubscribers.push(
      this.coordinator.subscribeRuntimeUiEvents((event) => {
        this.handleRuntimeUiEvent(event);
      })
    );
  }

  private detachCoordinatorSubscriptions(): void {
    while (this.coordinatorUnsubscribers.length > 0) {
      this.coordinatorUnsubscribers.pop()?.();
    }
  }

  private async launchProjectThread(projectPath: string): Promise<void> {
    this.assertLiveThreadSelected();
    this.assertProjectThreadLaunchAvailable();

    const validation = await this.projectLauncherService.validateProjectPath(
      projectPath,
      this.coordinator.getStatus().cwd
    );
    if (!validation.ok || !validation.normalizedPath) {
      this.rejectAction(
        renderProjectValidationNotice(
          validation.error ?? "Project path was not valid."
        ),
        "launch_project_thread"
      );
    }

    if (!this.createCoordinator || !this.portalOptions) {
      throw new Error(
        "This PI Dual portal instance cannot launch a new project thread because it was started without coordinator factory support."
      );
    }

    const nextOptions = await this.projectLauncherService.resolvePortalThreadOptions(
      this.portalOptions,
      validation.normalizedPath
    );
    const previousCoordinator = this.coordinator;
    const nextCoordinator = this.createCoordinator(nextOptions);

    await this.persistThreadProjection(this.liveThreadId);
    this.detachCoordinatorSubscriptions();
    await previousCoordinator.dispose();

    this.coordinator = nextCoordinator;
    await this.coordinator.start();
    this.attachCoordinatorSubscriptions();

    this.initializeLiveStateFromCoordinator();
    this.updateState({
      type: "set_modal",
      modal: { kind: "none" }
    });
    this.updateState({
      type: "set_active_view",
      activeView: "thread"
    });

    await this.refreshWorkspace(this.liveThreadId);
    await this.refreshSettings(undefined, this.liveThreadId);
    await this.persistThreadProjection(this.liveThreadId);
    await this.projectLauncherService.recordRecentProject(validation.normalizedPath);
    await this.refreshWorkspace(this.liveThreadId);

    const notice = renderProjectLaunchSuccessNotice(validation.normalizedPath);
    this.raiseNotification({
      level: "info",
      scope: "service",
      code: "project.thread_launched",
      title: notice.title,
      message: notice.message,
      nextStep: notice.nextStep,
      relatedAction: "launch_project_thread"
    });
  }

  private assertProjectThreadLaunchAvailable(): void {
    const projection = this.getProjection(this.liveThreadId);
    if (projection.status.pendingPlanReady) {
      this.rejectAction(
        renderProjectLaunchBlockedNotice("pending_plan"),
        "launch_project_thread"
      );
    }
    if (projection.status.activeWorkflowId) {
      this.rejectAction(
        renderProjectLaunchBlockedNotice("active_workflow"),
        "launch_project_thread"
      );
    }
    if (
      projection.liveStream ||
      projection.activity.active ||
      projection.activity.coordinator ||
      Object.values(projection.activity.runtimes).some((snapshot) => Boolean(snapshot))
    ) {
      this.rejectAction(
        renderProjectLaunchBlockedNotice("active_runtime_activity"),
        "launch_project_thread"
      );
    }
  }

  private rejectAction(
    notice: {
      title: string;
      message: string;
      nextStep?: string | undefined;
      detail?: string | undefined;
    },
    relatedAction: UiAction["type"]
  ): never {
    this.raiseNotification({
      level: "error",
      scope: "service",
      code: "action.rejected",
      title: notice.title,
      message: notice.message,
      nextStep: notice.nextStep,
      detail: notice.detail,
      relatedAction
    });
    throw new InteractiveActionError(renderNoticeText(notice));
  }

  private handleTelemetryEvent(event: NormalizedTelemetryEvent): void {
    if (this.disposed) {
      return;
    }
    const status = this.coordinator.getStatus();
    const update = deriveActivityUpdate(event, status);
    const actions: InteractiveStoreAction[] = [
      {
        type: "replace_status",
        status
      }
    ];
    if (update) {
      actions.push({
        type: "apply_activity_update",
        update
      });
      actions.push({
        type: "apply_activity_history_event",
        event,
        snapshot: update.snapshot
      });
    } else {
      actions.push({
        type: "apply_activity_history_event",
        event
      });
    }
    if (WORKFLOW_TERMINAL_EVENTS.has(event.eventType)) {
      actions.push({
        type: "replace_activity",
        activity: {
          ...this.getProjection(this.liveThreadId).activity,
          active: undefined,
          coordinator: undefined,
          runtimes: {}
        }
      });
    }

    this.applyActionsToLiveProjection(actions);
    const nextProjection = this.getProjection(this.liveThreadId);
    const timelineUpdate = applyTelemetryEventToTimeline(
      nextProjection.timeline,
      nextProjection.status,
      event
    );
    nextProjection.timeline = timelineUpdate.timeline;
    this.threadViews.set(this.liveThreadId, nextProjection);

    if (this.isSelectedThreadLive()) {
      this.projectProjectionIntoState(this.liveThreadId);
      if (update || WORKFLOW_TERMINAL_EVENTS.has(event.eventType)) {
        this.emitUiEvent({
          type: "activity_changed",
          state: this.state,
          activity: this.state.activity
        });
      }
      if (timelineUpdate.appended.length > 0) {
        this.emitUiEvent({
          type: "timeline_appended",
          state: this.state,
          items: timelineUpdate.appended
        });
      }
    } else {
      void this.refreshWorkspace();
    }
    void this.persistThreadProjection(this.liveThreadId);
  }

  private handleRuntimeUiEvent(event: RuntimeUiBridgeEvent): void {
    if (this.disposed) {
      return;
    }
    if (event.type === "assistant_text_delta") {
      this.applyActionsToLiveProjection([
        {
          type: "append_stream_delta",
          role: event.role,
          sessionId: event.sessionId,
          delta: event.delta,
          timestamp: event.timestamp
        }
      ]);
      this.applyTimelineRuntimeEvent(event);
      if (this.isSelectedThreadLive()) {
        this.projectProjectionIntoState(this.liveThreadId);
        this.emitUiEvent({
          type: "stream_delta_appended",
          state: this.state,
          role: event.role,
          sessionId: event.sessionId,
          delta: event.delta
        });
      }
      void this.persistThreadProjection(this.liveThreadId);
      return;
    }

    if (event.type === "assistant_turn_committed") {
      const projection = this.getProjection(this.liveThreadId);
      const committedText =
        projection.liveStream?.role === event.role &&
        projection.liveStream.sessionId === event.sessionId
          ? projection.liveStream.text
          : event.text;

      this.applyActionsToLiveProjection([
        {
          type: "commit_stream",
          role: event.role,
          sessionId: event.sessionId
        }
      ]);
      this.applyTimelineRuntimeEvent({
        ...event,
        text: committedText
      });
      if (this.isSelectedThreadLive()) {
        this.projectProjectionIntoState(this.liveThreadId);
        this.emitUiEvent({
          type: "stream_committed",
          state: this.state,
          role: event.role,
          sessionId: event.sessionId,
          text: committedText
        });
      }
      void this.persistThreadProjection(this.liveThreadId);
      return;
    }

    this.applyTimelineRuntimeEvent(event);
    if (this.isSelectedThreadLive()) {
      this.projectProjectionIntoState(this.liveThreadId);
    }
    void this.persistThreadProjection(this.liveThreadId);
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
    const conversationEntry = createConversationEntry(entry);
    this.updateState({
      type: "append_entry",
      entry: conversationEntry
    });
    this.updateState({
      type: "replace_timeline",
      timeline: appendConversationEntryToTimeline(
        this.state.timeline,
        this.state.status,
        conversationEntry
      )
    });
    this.syncSelectedProjectionFromState();
    void this.persistSelectedThreadProjection();
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
    this.syncSelectedProjectionFromState();
    this.emitUiEvent({
      type: "notification_raised",
      state: this.state,
      notification: completeNotification
    });
    void this.persistSelectedThreadProjection();
  }

  private handleDispatchError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const notification = createUiNotification({
      level: "error",
      scope: "service",
      code: "dispatch.failed",
      title: "PI Dual could not complete that action",
      message,
      nextStep:
        "Try the action again. If it keeps failing, reopen the local launch link and retry.",
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
    this.syncSelectedProjectionFromState();
    this.emitUiEvent({
      type: "fatal_error",
      state: this.state,
      error: notification
    });
    void this.persistSelectedThreadProjection();
  }

  private refreshStatus(): void {
    const status = this.coordinator.getStatus();
    this.updateState({
      type: "replace_status",
      status
    });
    this.syncSelectedProjectionFromState();
    void this.persistSelectedThreadProjection();
    void this.refreshWorkspace();
  }

  private refreshStatusForLiveThreadIfSelected(): void {
    if (!this.isSelectedThreadLive()) {
      return;
    }
    this.refreshStatus();
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

  private assertLiveThreadSelected(): void {
    if (!this.isSelectedThreadLive()) {
      throw new Error(
        "Only the active live thread can accept new input. Reopen the active thread in the workspace rail to continue."
      );
    }
  }

  private isSelectedThreadLive(): boolean {
    return this.state.workspace.selectedThreadId === this.liveThreadId;
  }

  private getSelectedThreadStatus(): CoordinatorStatusSnapshot {
    if (this.isSelectedThreadLive()) {
      return this.coordinator.getStatus();
    }
    return this.getProjection(
      this.state.workspace.selectedThreadId ?? this.state.status.threadId
    ).status;
  }

  private async selectThread(threadId: string): Promise<void> {
    const projection = await this.loadThreadProjection(threadId);
    if (!projection) {
      throw new Error(`Could not load thread ${threadId}.`);
    }
    this.threadViews.set(threadId, projection);
    await this.refreshWorkspace(threadId);
    this.projectProjectionIntoState(threadId);
    await this.refreshSettings(undefined, threadId);
    this.updateState({
      type: "set_active_view",
      activeView: "thread"
    });
  }

  private async refreshWorkspace(
    selectedThreadId = this.state.workspace.selectedThreadId
  ): Promise<void> {
    const [index, recentProjects] = await Promise.all([
      loadWorkspaceIndex({
        activeThreadId: this.liveThreadId,
        selectedThreadId
      }),
      this.projectLauncherService.loadRecentProjects()
    ]);
    this.updateState({
      type: "replace_workspace",
      workspace: {
        ...index.workspace,
        recentProjects
      }
    });
    this.emitUiEvent({
      type: "workspace_updated",
      state: this.state,
      workspace: this.state.workspace
    });
  }

  private async refreshSettings(
    scope?: UiSettingsScope | undefined,
    threadId = this.state.workspace.selectedThreadId,
    options: {
      forceProviderRefresh?: boolean | undefined;
      providerCatalog?: Awaited<ReturnType<SettingsProviderService["getCatalog"]>> | undefined;
      providerOperation?: InteractiveUiState["settings"]["providerOperation"] | undefined;
      refreshToken?: number | undefined;
    } = {}
  ): Promise<void> {
    const selectedProjection = threadId ? await this.loadThreadProjection(threadId) : undefined;
    const scopedSettings = await resolveUiSettingsState({
      projectPath: selectedProjection?.status.cwd ?? this.state.status.cwd,
      threadId: selectedProjection?.status.threadId ?? threadId,
      selectedScope: scope ?? this.state.settings.activeScope
    });
    const providerCatalog =
      options.providerCatalog ??
      (await this.settingsProviderService.getCatalog({
        force: options.forceProviderRefresh
      }));
    const settings = {
      ...augmentSettingsWithProviderCatalog(scopedSettings, providerCatalog),
      providerOperation: options.providerOperation
    };
    if (
      options.refreshToken !== undefined &&
      options.refreshToken !== this.settingsRefreshToken
    ) {
      return;
    }
    this.updateState({
      type: "replace_settings",
      settings
    });
    this.emitUiEvent({
      type: "settings_updated",
      state: this.state,
      settings
    });
  }

  private async ensureManagedProvidersForSettings(
    values: Extract<UiAction, { type: "save_settings" }>["values"]
  ): Promise<void> {
    if (typeof values.modelA === "string") {
      await this.settingsProviderService.ensureManagedProviderForModelRef(values.modelA);
    }
    if (typeof values.modelB === "string") {
      await this.settingsProviderService.ensureManagedProviderForModelRef(values.modelB);
    }
  }

  private scheduleSettingsRefresh(input: {
    forceProviderRefresh?: boolean | undefined;
    providerCatalog?: Awaited<ReturnType<SettingsProviderService["getCatalog"]>> | undefined;
    providerOperation?: InteractiveUiState["settings"]["providerOperation"] | undefined;
    scope?: UiSettingsScope | undefined;
    threadId?: string | undefined;
  }): void {
    const refreshToken = ++this.settingsRefreshToken;
    if (input.providerOperation) {
      this.setSettingsProviderOperation(input.providerOperation);
    }

    void this.refreshSettings(input.scope, input.threadId, {
      forceProviderRefresh: input.forceProviderRefresh,
      providerCatalog: input.providerCatalog,
      providerOperation: input.providerOperation,
      refreshToken
    })
      .then(() => {
        if (
          refreshToken !== this.settingsRefreshToken ||
          !input.providerOperation
        ) {
          return;
        }
        this.setSettingsProviderOperation(undefined);
      })
      .catch((error) => {
        if (refreshToken !== this.settingsRefreshToken) {
          return;
        }
        this.handleSettingsProviderActionError(error, input.providerOperation);
      });
  }

  private startSettingsProviderAction(
    operation: Omit<
      NonNullable<InteractiveUiState["settings"]["providerOperation"]>,
      "status" | "message"
    >,
    run: (
      refreshToken: number,
      providerOperation: NonNullable<InteractiveUiState["settings"]["providerOperation"]>
    ) => Promise<void>
  ): void {
    const refreshToken = ++this.settingsRefreshToken;
    const runningOperation = {
      ...operation,
      status: "running"
    } as const;
    this.setSettingsProviderOperation(runningOperation);

    void run(refreshToken, runningOperation)
      .then(() => {
        if (refreshToken !== this.settingsRefreshToken) {
          return;
        }
        const activeOperation = this.state.settings.providerOperation;
        if (
          activeOperation?.status === "running" &&
          activeOperation.kind === runningOperation.kind &&
          activeOperation.provider === runningOperation.provider
        ) {
          this.setSettingsProviderOperation(undefined);
        }
      })
      .catch((error) => {
        if (refreshToken !== this.settingsRefreshToken) {
          return;
        }
        this.handleSettingsProviderActionError(error, runningOperation);
      });
  }

  private setSettingsProviderOperation(
    providerOperation: InteractiveUiState["settings"]["providerOperation"]
  ): void {
    this.updateState({
      type: "replace_settings",
      settings: {
        ...this.state.settings,
        providerOperation
      }
    });
  }

  private handleSettingsProviderActionError(
    error: unknown,
    operation: InteractiveUiState["settings"]["providerOperation"]
  ): void {
    const message = error instanceof Error ? error.message : String(error);
    this.setSettingsProviderOperation(
      operation
        ? {
            ...operation,
            status: "error",
            message
          }
        : undefined
    );
    this.raiseNotification({
      level: "error",
      scope: "service",
      code: "settings.provider_operation_failed",
      title: "Provider settings update failed",
      message,
      nextStep:
        "Adjust the provider configuration and try again. If it keeps failing, rerun the matching CLI auth or setup flow."
    });
  }

  private applyActionsToLiveProjection(actions: InteractiveStoreAction[]): void {
    const currentProjection = this.getProjection(this.liveThreadId);
    const nextProjection = actions.reduce(
      (projection, action) => reduceThreadProjection(projection, action),
      currentProjection
    );
    this.threadViews.set(this.liveThreadId, nextProjection);
  }

  private applyTimelineRuntimeEvent(event: RuntimeUiBridgeEvent): void {
    const projection = this.getProjection(this.liveThreadId);
    const timelineUpdate = applyRuntimeUiEventToTimeline(
      projection.timeline,
      projection.status,
      event
    );
    projection.timeline = timelineUpdate.timeline;
    this.threadViews.set(this.liveThreadId, projection);
    if (this.isSelectedThreadLive()) {
      this.updateState({
        type: "replace_timeline",
        timeline: projection.timeline
      });
    }
    if (timelineUpdate.appended.length > 0) {
      this.emitUiEvent({
        type: "timeline_appended",
        state: this.state,
        items: timelineUpdate.appended
      });
    }
  }

  private getProjection(threadId: string): ThreadUiProjection {
    return (
      this.threadViews.get(threadId) ??
      extractThreadProjection(this.state)
    );
  }

  private syncSelectedProjectionFromState(): void {
    const threadId = this.state.status.threadId;
    this.threadViews.set(threadId, extractThreadProjection(this.state));
  }

  private projectProjectionIntoState(threadId: string): void {
    const projection = this.getProjection(threadId);
    this.updateState({
      type: "replace_status",
      status: projection.status
    });
    this.updateState({
      type: "replace_activity",
      activity: projection.activity
    });
    this.updateState({
      type: "replace_timeline",
      timeline: projection.timeline
    });
    this.state = {
      ...this.state,
      conversation: projection.conversation,
      liveStream: projection.liveStream,
      pendingPlan: projection.pendingPlan,
      notification: projection.notification,
      lastError: projection.lastError,
      workspace: {
        ...this.state.workspace,
        selectedThreadId: threadId
      }
    };
    this.emitStateChanged();
  }

  private async loadThreadProjection(
    threadId: string
  ): Promise<ThreadUiProjection | undefined> {
    if (threadId === this.liveThreadId && this.threadViews.has(threadId)) {
      return this.getProjection(threadId);
    }
    const persisted = await readThreadView(threadId);
    return persisted ? projectionFromPersistedView(persisted) : undefined;
  }

  private async persistSelectedThreadProjection(): Promise<void> {
    await this.persistThreadProjection(this.state.status.threadId);
  }

  private async persistThreadProjection(threadId: string): Promise<void> {
    const projection = this.getProjection(threadId);
    const persisted = createPersistedThreadView(projection);
    await writeThreadView(threadId, persisted);
    await writeThreadManifest(
      buildThreadManifest({
        status: projection.status,
        latestSummary:
          projection.lastError?.message ??
          projection.notification?.message ??
          projection.status.lastSummary
      })
    );
    if (threadId === this.liveThreadId) {
      await this.refreshWorkspace(this.state.workspace.selectedThreadId);
    }
  }
}

function createEmptyStatusSnapshot(): CoordinatorStatusSnapshot {
  const timestamp = new Date(0).toISOString();
  return {
    threadId: "thread-pending",
    threadTitle: "PI Dual Thread",
    threadStartedAt: timestamp,
    threadUpdatedAt: timestamp,
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

interface ThreadUiProjection {
  status: CoordinatorStatusSnapshot;
  conversation: InteractiveUiState["conversation"];
  timeline: UiTimelineItem[];
  liveStream?: InteractiveUiState["liveStream"] | undefined;
  activity: InteractiveUiState["activity"];
  pendingPlan?: UiPendingPlanState | undefined;
  notification?: UiNotification | undefined;
  lastError?: UiNotification | undefined;
}

function extractThreadProjection(state: InteractiveUiState): ThreadUiProjection {
  return {
    status: state.status,
    conversation: state.conversation,
    timeline: state.timeline,
    liveStream: state.liveStream,
    activity: state.activity,
    pendingPlan: state.pendingPlan,
    notification: state.notification,
    lastError: state.lastError
  };
}

function reduceThreadProjection(
  projection: ThreadUiProjection,
  action: InteractiveStoreAction
): ThreadUiProjection {
  const state = interactiveUiReducer(
    {
      status: projection.status,
      conversation: projection.conversation,
      timeline: projection.timeline,
      workspace: {
        projects: [],
        recentProjects: [],
        threads: []
      },
      activeView: "thread",
      settings: {
        activeScope: "global",
        effective: {
          values: {},
          sources: {
            modelA: "legacy",
            modelB: "legacy",
            thinkingA: "legacy",
            thinkingB: "legacy",
            mcpEnabled: "legacy"
          }
        },
        scopes: {
          global: {
            scope: "global",
            label: "Global defaults",
            available: true,
            hasOverrides: false,
            values: {}
          },
          project: {
            scope: "project",
            label: "Project overrides",
            available: false,
            hasOverrides: false,
            values: {}
          },
          thread: {
            scope: "thread",
            label: "Thread overrides",
            available: false,
            hasOverrides: false,
            values: {}
          }
        },
        providers: [],
        catalogByProvider: {},
        providerOperation: undefined
      },
      liveStream: projection.liveStream,
      activity: projection.activity,
      pendingPlan: projection.pendingPlan,
      modal: { kind: "none" },
      commandPalette: {
        open: false
      },
      notifications: [],
      notification: projection.notification,
      lastError: projection.lastError,
      shouldExit: false
    },
    action
  );

  return extractThreadProjection(state);
}

function createPersistedThreadView(
  projection: ThreadUiProjection
): PersistedThreadView {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    status: projection.status,
    conversation: projection.conversation,
    timeline: projection.timeline,
    activity: projection.activity,
    pendingPlan: projection.pendingPlan,
    notification: projection.notification,
    lastError: projection.lastError
  };
}

function projectionFromPersistedView(view: PersistedThreadView): ThreadUiProjection {
  return {
    status: view.status,
    conversation: view.conversation,
    timeline: view.timeline,
    activity: view.activity,
    pendingPlan: view.pendingPlan,
    notification: view.notification,
    lastError: view.lastError
  };
}
