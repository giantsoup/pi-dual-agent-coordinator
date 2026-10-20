import { CurrentActivityReducer } from "./current-activity.js";
import { HistoryIndex, type loadHistoryEvents } from "./history.js";
import { projectHistoryDetail } from "./history-detail.js";
import { RequestTranscript } from "./transcript.js";
import type { ArchiveEntry } from "../../runtime/session-history.js";
import type { HistoryDetail, HistoryRecord, TranscriptBlock } from "../../types/history.js";
import { safeDisplayText, safeDisplayFields, visibleProse } from "../../security/display-text.js";
import { renderCheckInSummary } from "../presentation/check-in.js";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { extractAssistantText } from "../../handoff/handoff-envelope.js";
import type { SupportedThinkingLevel } from "../../runtime/create-role-runtime.js";
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
  UiNotification,
  UiRuntimeActivityHistoryItem
} from "../../types/ui.js";
import type { CoordinatorTurnResult } from "../../types/workflow.js";
import type { Role } from "../../types/role.js";
import type { ModelPickerCatalog, ModelSwitchProgress } from "../../types/model-selection.js";
import { LocalModelSwitchError } from "../../security/lm-studio.js";

export interface InteractiveCoordinatorLike {
  start(onProgress?: (role: Role, progress: ModelSwitchProgress) => void): Promise<void>;
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
  getHistoryEvents?(): ReturnType<typeof loadHistoryEvents>;
  getRunArchive?(run: Extract<HistoryRecord, { kind: "run" }>): Promise<ArchiveEntry[]>;
  getAvailableModels?(role?: Role): Array<{ canonical: string; name: string; reasoning: boolean; thinkingLevels: SupportedThinkingLevel[] }>;
  getModelPickerCatalog?(role: Role, signal?: AbortSignal): Promise<ModelPickerCatalog>;
  getSavedSessions?(role: Role): Promise<SessionInfo[]>;
  getSessionHistory?(role: Role, path: string): Promise<AgentMessage[]>;
  configureRole?(role: Role, input: { model?: string; thinking?: SupportedThinkingLevel; save: boolean }, onProgress?: (progress: ModelSwitchProgress) => void): Promise<void>;
  configureDefaults?(key: "review-rounds" | "timeout-ms", value: number, save: boolean): Promise<void>;
  cancelActive?(): Promise<void>;
  dispose(): Promise<void>;
}

export interface InteractiveCoordinatorService {
  getTranscript?(turnId: string): TranscriptBlock[];
  loadTranscript?(turnId: string): Promise<void>;
  loadHistoryDetail?(id: string, section: HistoryDetail["section"], offset?: number, limit?: number): Promise<HistoryDetail>;
  start(): Promise<void>;
  dispose(): Promise<void>;
  dispatch(action: UiAction, onAccepted?: () => void): Promise<void>;
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
  private busy = false;
  private readonly historyIndex = new HistoryIndex();
  private readonly transcript = new RequestTranscript(async (run) => {
    if (!this.coordinator.getRunArchive) throw new Error("This runtime has no retained archive reader.");
    return this.coordinator.getRunArchive(run);
  }, (runId) => this.historyIndex.getMessageSequences(runId));
  private helpReturn: InteractiveUiState["modal"] | undefined;
  private readonly committedMessages = new Set<string>();
  private operationTexts = new Set<string>();
  private modelQuery: AbortController | undefined;
  private quitting = false;
  private readonly currentActivity = new CurrentActivityReducer();

  public constructor(private readonly coordinator: InteractiveCoordinatorLike) {
    this.state = createInitialInteractiveUiState(coordinator.getStatus());
  }

  public async start(): Promise<void> {
    if (this.disposed) {
      throw new Error("Interactive coordinator service has already been disposed.");
    }
    if (this.started) {
      return;
    }

    this.started = true;
    this.busy = true;
    try {
      this.showModelProgress("A", "startup", { phase: "checking", message: "Starting the agents…" });
      await this.coordinator.start((role, progress) => this.showModelProgress(role, "startup", progress));
    } catch (error) {
      if (this.state.shouldExit || this.quitting) return;
      throw error;
    } finally { this.busy = false; }
    const shouldExit = this.state.shouldExit;
    this.state = createInitialInteractiveUiState(this.coordinator.getStatus());
    this.state.shouldExit = shouldExit;
    this.historyIndex.restore(this.coordinator.getHistoryEvents?.() ?? { events: [], warnings: [] });
    this.updateState({ type: "set_history", history: this.historyIndex.snapshot() });
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
    this.transcript.reset();
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

  public async dispatch(action: UiAction, onAccepted?: () => void): Promise<void> {
    this.assertDispatchReady();

    try {
      if (action.type === "submit_input") {
        const command = parseReplCommand(action.input);
        if (command.type !== "user_turn") {
          await this.dispatchReplCommand(command, onAccepted);
          return;
        }
      }
      if (action.type === "run_repl_command") {
        await this.dispatchReplCommand(action.command, onAccepted);
        return;
      }
      if (this.busy && ["submit_input", "approve_pending_plan", "discard_pending_plan", "new_conversation", "replace_runtime", "configure_role", "configure_defaults"].includes(action.type)) {
        if (this.state.modal.kind !== "model_loading") this.updateState({ type: "set_modal", modal: { kind: "none" } });
        this.raiseNotification({ level: "info", scope: "operator", code: "operation.busy",
          message: "Work is running. Keep editing your draft, or use /cancel. Help, status and /quit remain available." });
        return;
      }
      if (!["open_help", "close_modal", "open_records", "inspect_record"].includes(action.type)) {
        this.updateState({ type: "set_error", error: undefined });
        this.updateState({ type: "set_notification", notification: undefined });
      }
      onAccepted?.();
      switch (action.type) {
        case "open_records":
          this.updateState({ type: "set_modal", modal: { kind: "records", title: "Retained history", content: this.state.history.records.map((record) => `${record.kind} [${record.outcome.kind}] ${record.title}\n  /inspect ${record.id}`).join("\n") || "No retained records yet.", format: "text", createdAt: new Date().toISOString() } });
          return;
        case "inspect_record": {
          const detail = await this.loadHistoryDetail(action.id, action.section ?? "output", action.offset ?? 0, 100);
          this.updateState({ type: "set_modal", modal: { kind: "record_detail", title: "Read-only record inspector", content: `${detail.recordId} | ${detail.section} | lines ${detail.offset + 1}-${detail.offset + detail.lines.length}/${detail.totalLines}\n${detail.reason ?? ""}\n${detail.lines.join("\n")}\n/inspect ID summary|request|output|metadata OFFSET for another range.`, format: "text", createdAt: new Date().toISOString() } });
          return;
        }
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
          await this.runWork(() => this.coordinator.submitUserInput(command.text));
          this.refreshStatus();
          return;
        }
        case "open_help":
          if (this.state.modal.kind === "help") { await this.dispatch({ type: "close_modal" }); return; }
          this.helpReturn = this.state.modal;
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
          if (action.role) {
            const role = action.role;
            const sessions = await this.coordinator.getSavedSessions?.(role) ?? [];
            this.updateState({ type: "set_modal", modal: { kind: "sessions", title: `Agent ${role} saved sessions`,
              content: sessions.length ? "Select to view history. Selecting does not switch the runtime.\n" + sessions.map((session) => `${session.id} | ${session.cwd} | ${session.modified.toISOString()} | ${session.firstMessage.slice(0, 100)}\n${session.path}`).join("\n") : "No saved sessions for this role and project.",
              format: "text", createdAt: new Date().toISOString(),
              choices: sessions.map((session) => ({ value: session.path, label: `${session.id} | ${session.cwd} | ${session.modified.toISOString()} | ${session.firstMessage.slice(0, 60)}`,
                action: { type: "view_session", role, sessionPath: session.path } })) } });
            return;
          }
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
          if (!this.state.pendingPlan) throw new Error("No pending plan is available. Ask Agent A for a plan first.");
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
          await this.runWork(() => this.coordinator.approvePendingPlan());
          this.refreshStatus();
          return;
        }
        case "discard_pending_plan":
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
        case "new_conversation":
          await this.runControl(async () => {
            for (const role of ["A", "B"] as const) await this.coordinator.replaceRuntime(role, { type: "new", role });
          });
          this.raiseNotification({ level: "info", scope: "runtime", code: "conversation.created",
            title: "New conversation", message: "Both agents now have empty sessions. Previous work remains in History.",
            nextStep: "Send your next request to Agent A." });
          return;
        case "replace_runtime":
          await this.runControl(() => this.coordinator.replaceRuntime(
            action.role,
            action.mode === "new"
              ? { type: "new", role: action.role }
              : {
                  type: "switch",
                  role: action.role,
                  sessionPath: action.sessionPath ?? ""
                }
          ));
          this.updateState({ type: "set_modal", modal: { kind: "none" } });
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
        case "select_choice": {
          const modal = this.state.modal;
          if (modal.kind === "none") return;
          const choice = modal.choices?.find((item) => item.value === action.value);
          if (choice) await this.dispatch(choice.action);
          return;
        }
        case "view_session": {
          const messages = await this.coordinator.getSessionHistory?.(action.role, action.sessionPath) ?? [];
          const content = messages.flatMap((message) => {
            if (message.role === "assistant") return [`Agent ${action.role}: ${visibleAssistantText(extractAssistantText(message))}`];
            if (message.role === "user") return [`Operator: ${typeof message.content === "string" ? message.content : message.content.filter((part) => part.type === "text").map((part) => part.type === "text" ? part.text : "").join("\n")}`];
            return [];
          }).join("\n\n");
          this.updateState({ type: "set_modal", modal: { kind: "history", title: `Agent ${action.role} history`,
            content: `${action.sessionPath}\n${content}\nSwitch restores conversation context only. No workflow will resume.`, format: "text", createdAt: new Date().toISOString(),
            choices: [{ label: "Switch to this session", value: "switch", action: { type: "replace_runtime", role: action.role, mode: "switch", sessionPath: action.sessionPath } }] } });
          return;
        }
        case "open_models": {
          if (this.state.modal.kind === "model_loading" && this.state.modal.operation !== "inventory") return;
          this.modelQuery?.abort();
          const controller = new AbortController(); this.modelQuery = controller;
          this.showModelProgress(action.role, "inventory", { phase: "checking", message: action.role === "B" ? "Reading downloaded models from LM Studio…" : "Reading GPT model choices…" });
          try {
            const runtime = this.state.status.runtimes.find((item) => item.role === action.role);
            const catalog: ModelPickerCatalog = await this.coordinator.getModelPickerCatalog?.(action.role, controller.signal) ?? {
              role: action.role, currentModel: runtime?.modelCanonical, currentThinking: runtime?.thinking,
              models: (this.coordinator.getAvailableModels?.(action.role) ?? []).map((model) => ({ canonical: model.canonical, name: model.name, description: model.canonical }))
            };
            if (controller.signal.aborted || this.modelQuery !== controller) return;
            const content = [`Agent ${action.role} models (current: ${catalog.currentModel ?? "none"})`,
              ...catalog.models.map((model) => `${model.name} / ${model.canonical}${model.disabledReason ? ` / ${model.disabledReason}` : model.loaded === undefined ? "" : model.loaded ? " / ready" : " / not loaded"}`),
              `/model ${action.role} PROVIDER/MODEL [save]`, `/thinking ${action.role} ${action.role === "A" ? "low|medium|high" : (catalog.models.find(model => model.canonical === catalog.currentModel)?.thinkingLevels ?? ["off"]).join("|")} [save]`].join("\n");
            this.updateState({ type: "set_modal", modal: { kind: "model_picker", title: "Models", content, format: "text", createdAt: new Date().toISOString(), catalog } });
          } catch (error) {
            if (!controller.signal.aborted) this.showModelError(action.role, error, action);
          } finally { if (this.modelQuery === controller) this.modelQuery = undefined; }
          return;
        }
        case "open_thinking": {
          const runtime = this.state.status.runtimes.find((item) => item.role === action.role);
          const model = this.coordinator.getAvailableModels?.().find((item) => item.canonical === runtime?.modelCanonical);
          const levels: SupportedThinkingLevel[] = action.role === "A" ? ["low", "medium", "high"] : model?.thinkingLevels ?? ["off"];
          this.updateState({ type: "set_modal", modal: { kind: "settings", title: `Agent ${action.role} thinking`,
            content: `Applies to the current conversation and next operation. Save explicitly with /thinking ${action.role} LEVEL save.\n${levels.join(" | ")}`,
            format: "text", createdAt: new Date().toISOString(), choices: levels.map((thinking) => ({ value: thinking, label: thinking, action: { type: "configure_role", role: action.role, thinking, save: false } })) } });
          return;
        }
        case "configure_role": {
          const configureRole = this.coordinator.configureRole?.bind(this.coordinator);
          if (!configureRole) throw new Error("Role configuration unavailable.");
          const hadPlan = Boolean(this.state.pendingPlan);
          this.showModelProgress(action.role, "switch", { phase: "checking", message: `Preparing Agent ${action.role}'s selection…` });
          try {
            await this.runControl(() => configureRole(action.role, { ...(action.model ? { model: action.model } : {}), ...(action.thinking ? { thinking: action.thinking } : {}), save: action.save }, (progress) => this.showModelProgress(action.role, "switch", progress)));
          } catch (error) {
            if (error instanceof LocalModelSwitchError && error.cancelled && error.recovery !== "unavailable") {
              this.updateState({ type: "set_modal", modal: { kind: "none" } });
              this.raiseNotification({ level: "info", scope: "runtime", code: "runtime.configuration_cancelled", message: error.message });
            } else this.showModelError(action.role, error, action);
            return;
          }
          this.refreshStatus();
          this.updateState({ type: "set_modal", modal: { kind: "none" } });
          const runtime = this.state.status.runtimes.find((item) => item.role === action.role);
          this.raiseNotification({ level: "info", scope: "runtime", code: "runtime.configured", title: `Agent ${action.role} ready`,
            message: `Agent ${action.role} ready: ${runtime?.modelName ?? action.model ?? "selected model"}${action.role === "A" ? ` / ${runtime?.thinking ?? action.thinking} reasoning` : ""}.${action.save ? " Saved for restart." : " Defaults unchanged."}${hadPlan ? " Pending plan cleared; request a new plan." : ""}` });
          return;
        }
        case "configure_defaults":
          const configureDefaults = this.coordinator.configureDefaults?.bind(this.coordinator);
          if (!configureDefaults) throw new Error("Coordinator configuration unavailable.");
          await this.runControl(() => configureDefaults(action.key, action.value, action.save));
          this.refreshStatus();
          this.raiseNotification({ level: "info", scope: "operator", code: "defaults.configured", message: `${action.key} = ${action.value} for the next operation.${action.save ? " Defaults saved." : " Defaults unchanged."}` });
          return;
        case "close_modal":
          this.modelQuery?.abort(); this.modelQuery = undefined;
          this.updateState({
            type: "set_modal",
            modal: this.state.modal.kind === "help" ? this.helpReturn ?? { kind: "none" } : { kind: "none" }
          });
          this.helpReturn = undefined;
          return;
        case "cancel":
          if (this.state.modal.kind === "model_loading") {
            if (this.state.modal.operation === "inventory") {
              this.modelQuery?.abort(); this.modelQuery = undefined;
              this.updateState({ type: "set_modal", modal: { kind: "none" } }); return;
            }
            const modal = this.state.modal;
            this.updateState({ type: "set_modal", modal: { ...modal, cancelling: true, content: "Cancellation requested. Waiting for LM Studio and restoring the previous model…" } });
            if (modal.operation === "startup") this.updateState({ type: "set_should_exit", value: true });
            await this.coordinator.cancelActive?.();
            return;
          }
          if (this.state.operation.kind === "running" || this.state.operation.kind === "cancelling") {
            this.updateState({ type: "set_operation", operation: { kind: "cancelling" } });
            await this.coordinator.cancelActive?.();
            this.refreshStatus();
          }
          return;
        case "quit":
          this.quitting = true;
          this.modelQuery?.abort();
          if (this.state.modal.kind === "model_loading") this.updateState({ type: "set_modal", modal: { ...this.state.modal, cancelling: true, content: "Restoring safely before exiting…" } });
          await this.coordinator.cancelActive?.();
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
    command: ReturnType<typeof parseReplCommand>,
    onAccepted?: () => void
  ): Promise<void> {
    switch (command.type) {
      case "user_turn":
        if (command.text) {
          await this.dispatch({
            type: "submit_input",
            input: command.text
          }, onAccepted);
        }
        return;
      case "history":
        await this.dispatch({ type: "open_records" }, onAccepted); return;
      case "inspect":
        await this.dispatch({ type: "inspect_record", id: command.id, section: command.section, offset: command.offset }, onAccepted); return;
      case "help":
        await this.dispatch({ type: "open_help" }, onAccepted);
        return;
      case "status":
        await this.dispatch({ type: "open_status" }, onAccepted);
        return;
      case "approve":
        await this.dispatch({ type: "approve_pending_plan" }, onAccepted);
        return;
      case "discard":
        await this.dispatch({ type: "discard_pending_plan" }, onAccepted);
        return;
      case "sessions":
        await this.dispatch({ type: "open_sessions", ...(command.role ? { role: command.role } : {}) }, onAccepted);
        return;
      case "model":
        await this.dispatch(command.model ? { type: "configure_role", role: command.role, model: command.model, save: command.save } : { type: "open_models", role: command.role }, onAccepted);
        return;
      case "thinking":
        await this.dispatch(command.thinking ? { type: "configure_role", role: command.role, thinking: command.thinking, save: command.save } : { type: "open_thinking", role: command.role }, onAccepted);
        return;
      case "config":
        await this.dispatch({ type: "configure_defaults", key: command.key, value: command.value, save: command.save }, onAccepted);
        return;
      case "handoff":
        await this.dispatch({ type: "open_handoff" }, onAccepted);
        return;
      case "new":
        await this.dispatch({
          type: "replace_runtime",
          role: command.role,
          mode: "new"
        }, onAccepted);
        return;
      case "new_conversation":
        await this.dispatch({ type: "new_conversation" }, onAccepted);
        return;
      case "switch":
        await this.dispatch({
          type: "replace_runtime",
          role: command.role,
          mode: "switch",
          sessionPath: command.sessionPath
        }, onAccepted);
        return;
      case "cancel":
        await this.dispatch({ type: "cancel" }, onAccepted);
        return;
      case "quit":
        await this.dispatch({ type: "quit" }, onAccepted);
        return;
    }
  }

  private handleTelemetryEvent(event: NormalizedTelemetryEvent): void {
    if (this.disposed) {
      return;
    }
    const historyChanged = this.historyIndex.observe(event);
    if (historyChanged) this.transcript.observeTool(event, this.historyIndex.eventSequence);
    if (historyChanged) this.updateState({ type: "set_history", history: this.historyIndex.snapshot() });
    event = { ...event, details: safeDisplayFields(event.details) };
    const status = this.coordinator.getStatus();
    if (event.eventType === "ui.conversation_reset") {
      this.helpReturn = undefined;
      this.operationTexts.clear();
      this.committedMessages.clear();
      this.updateState({ type: "reset_conversation", status });
    }
    if (status.operation) this.updateState({ type: "set_operation", operation: status.operation });
    this.state = { ...this.state, status, currentActivity: this.currentActivity.update({ ...this.state, status }, event) };
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
      this.updateState({
        type: "apply_activity_history_event",
        event,
        snapshot: update.snapshot
      });
      this.emitUiEvent({
        type: "activity_changed",
        state: this.state,
        activity: this.state.activity
      });
    } else {
      this.updateState({
        type: "apply_activity_history_event",
        event
      });
    }
    if (WORKFLOW_TERMINAL_EVENTS.has(event.eventType)) {
      this.updateState({
        type: "replace_activity",
        activity: {
          ...this.state.activity,
          active: undefined,
          coordinator: undefined,
          runtimes: {}
        }
      });
      this.emitUiEvent({
        type: "activity_changed",
        state: this.state,
        activity: this.state.activity
      });
    }
  }

  private handleRuntimeUiEvent(event: RuntimeUiBridgeEvent): void {
    if (this.disposed || this.state.operation.kind === "cancelling" || this.state.operation.kind === "cancelled" || this.state.operation.kind === "timed_out") {
      return;
    }
    const currentSession = this.coordinator.getStatus().runtimes.find((runtime) => runtime.role === event.role)?.sessionId;
    if (currentSession && currentSession !== event.sessionId) return;
    const run = [...this.state.history.records].reverse().find((record) => record.kind === "run" && record.role === event.role && record.sessionId === event.sessionId && record.outcome.kind === "running" && (!event.runId || record.id === event.runId));
    if (event.runId && !run) return;
    if (run?.kind === "run") this.transcript.observeOutput(event, run, this.historyIndex.eventSequence + 0.1);
    if (event.type === "assistant_text_delta") {
      this.updateState({
        type: "append_stream_delta",
        role: event.role,
        sessionId: event.sessionId,
        delta: safeDisplayText(event.delta),
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

    const committedText = visibleAssistantText(event.text);
    const key = `${event.role}:${event.sessionId}:${event.messageId ?? event.timestamp}`;
    if (committedText && !this.committedMessages.has(key)) {
      this.committedMessages.add(key);
      this.operationTexts.add(committedText);
      this.appendConversationEntry({ kind: "assistant_planning_response", role: event.role, text: committedText });
    }

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

  public getTranscript(turnId: string): TranscriptBlock[] {
    return this.transcript.blocks(this.state.history.records, turnId, this.state.history.milestones);
  }

  public async loadTranscript(turnId: string): Promise<void> {
    await this.transcript.hydrate(this.state.history.records, turnId);
  }

  public async loadHistoryDetail(id: string, section: HistoryDetail["section"], offset = 0, limit = 100): Promise<HistoryDetail> {
    const record = this.historyIndex.get(id);
    if (!record) throw new Error("History record unavailable: unknown ID.");
    const run = record.kind === "tool" ? this.historyIndex.get(record.parentId) : record;
    let entries: ArchiveEntry[] = [];
    let reason: string | undefined;
    if (run?.kind === "run" && (section === "output" || section === "request" || section === "metadata" && run.phase === "Check-in")) {
      try {
        if (!this.coordinator.getRunArchive) throw new Error("This runtime has no retained archive reader.");
        entries = await this.coordinator.getRunArchive(run);
      } catch (error) { reason = `Output unavailable: ${error instanceof Error ? error.message : "archive could not be read"}`; }
    }
    return projectHistoryDetail(record, this.state.history.records, entries, section, offset, limit, reason);
  }

  private async runControl(run: () => Promise<void>): Promise<void> {
    this.busy = true;
    try { await run(); }
    finally { this.busy = false; this.refreshStatus(); }
  }

  private showModelProgress(role: Role, operation: "inventory" | "switch" | "startup", progress: ModelSwitchProgress): void {
    const previous = this.state.modal;
    const same = previous.kind === "model_loading" && previous.operation === operation;
    this.updateState({ type: "set_modal", modal: { kind: "model_loading", title: `${operation === "inventory" ? "Models" : "Preparing"} / Agent ${role}`, content: progress.message,
      format: "text", createdAt: same ? previous.createdAt : new Date().toISOString(), role, operation, progress,
      startedAt: same ? previous.startedAt : Date.now(), cancelling: same && previous.cancelling } });
  }

  private showModelError(role: Role, error: unknown, retry: UiAction): void {
    const message = safeDisplayText(error instanceof Error ? error.message : "Model selection failed.");
    this.updateState({ type: "set_modal", modal: { kind: "model_error", title: `Agent ${role} / Could not switch model`, content: message,
      format: "text", createdAt: new Date().toISOString(), choices: [
        { value: "retry", label: "Try again", action: retry },
        { value: "models", label: "Choose another model", action: { type: "open_models", role } }
      ] } });
    this.raiseNotification({ level: "error", scope: "runtime", code: "runtime.configuration_failed", message });
  }

  private async runWork(run: () => Promise<CoordinatorTurnResult>): Promise<CoordinatorTurnResult> {
    this.busy = true;
    this.operationTexts = new Set();
    this.updateState({ type: "set_operation", operation: { kind: "running" } });
    try {
      const result = await run();
      this.appendResultEntries(result);
      const kind = this.coordinator.getStatus().operation?.kind ?? (result.workflow?.status === "blocked" || result.workflow?.status === "capped" ? "failed" : "completed");
      this.updateState({ type: "set_operation", operation: { kind } });
      return result;
    } catch (error) {
      this.updateState({ type: "set_operation", operation: { kind: "failed" } });
      throw error;
    } finally {
      const stream = this.state.liveStream;
      if (stream) {
        const text = visibleAssistantText(stream.text);
        if (text) this.appendConversationEntry({ kind: "assistant_planning_response", role: stream.role, text: `[Interrupted] ${text}` });
        this.updateState({ type: "commit_stream", role: stream.role, sessionId: stream.sessionId });
      }
      const history = { ...this.state.activity.history };
      const terminalStatus: UiRuntimeActivityHistoryItem["status"] = this.state.operation.kind === "cancelled" ? "cancelled" : this.state.operation.kind === "timed_out" ? "timed_out" : this.state.operation.kind === "failed" ? "failed" : "interrupted";
      for (const role of ["A", "B"] as const) {
        const previous = history[role];
        if (previous) history[role] = { ...previous, recent: previous.recent.map((item) => item.status === "active" ? { ...item, status: terminalStatus } : item) };
      }
      this.updateState({ type: "replace_activity", activity: { history, runtimes: {} } });
      this.busy = false;
      this.refreshStatus();
    }
  }

  private appendResultEntries(result: CoordinatorTurnResult): void {
    const prose = visibleAssistantText(result.userResponse);
    if (prose && !this.operationTexts.has(prose)) {
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
      entry: createConversationEntry({ ...entry, text: safeDisplayText(entry.text) })
    });
  }

  private raiseNotification(
    notification: Omit<UiNotification, "id" | "createdAt">
  ): void {
    const completeNotification = createUiNotification({ ...notification, message: safeDisplayText(notification.message) });
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
      title: "PI Dual could not complete that action",
      message,
      nextStep:
        "Review the error and retry the action. Use /status to inspect current work.",
      fatal: false
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
    if (action.type === "set_modal" && action.modal.kind !== "none") {
      action = { ...action, modal: { ...action.modal, title: safeDisplayText(action.modal.title), content: safeDisplayText(action.modal.content),
        ...(action.modal.choices ? { choices: action.modal.choices.map((choice) => ({ ...choice, label: safeDisplayText(choice.label) })) } : {}) } };
    }
    this.state = interactiveUiReducer(this.state, action);
    this.state = { ...this.state, currentActivity: this.currentActivity.update(this.state) };
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
    message: safeDisplayText(notification.message),
    ...(notification.detail ? { detail: safeDisplayText(notification.detail) } : {}),
    id: randomUUID(),
    createdAt: new Date().toISOString()
  };
}

export function visibleAssistantText(text: string): string {
  return [visibleProse(text), renderCheckInSummary(text)].filter(Boolean).join("\n\n");
}
