import { renderCurrentActivity } from "./current-activity.js";
import { roleLabel } from "../../types/history.js";
import { CurrentWorkspace, paintRole, type WorkspaceFocus, frame } from "./workspace.js";
import { bindingMatches, browsingInput, controlActions, contextualHelp, footerBindings, type ControlAction } from "./bindings.js";
import { safeDisplayText } from "../../security/display-text.js";
import { ModelPicker } from "./model-picker.js";
import {
  Editor,
  CURSOR_MARKER,
  SelectList,
  CombinedAutocompleteProvider,
  matchesKey,
  Key,
  type TUI,
  truncateToWidth,
  wrapTextWithAnsi,
  type Component,
  type EditorTheme,
  type Focusable,
  type Terminal
} from "@earendil-works/pi-tui";

import { REPL_COMPLETION_COMMANDS } from "../cli.js";
import { renderRuntimeActivitySummary } from "../activity-history.js";
import type { InteractiveCoordinatorService } from "../interactive/service.js";
import { renderPendingPlan } from "../interactive/presentation.js";
import type { InteractiveUiState, UiModalState } from "../../types/ui.js";

const EDITOR_THEME: EditorTheme = {
  borderColor: (text) => text,
  selectList: {
    selectedPrefix: (text) => text,
    selectedText: (text) => text,
    description: (text) => text,
    scrollInfo: (text) => text,
    noMatch: (text) => text
  }
};

export interface CoordinatorTuiAppOptions {
  onExit(): void;
}

type PaneFocus = WorkspaceFocus;
type PanelAlign = "bottom" | "top";

export class CoordinatorTuiApp implements Component, Focusable {
  public focused = false;

  private readonly editor: Editor;
  private readonly autocompleteProvider: CombinedAutocompleteProvider;
  private controls: { kind: "menu"; selected: number } | { kind: "quit" } | undefined;
  private controlsPaste = false;
  private lastCtrlCAt = 0;
  private lastModalKey: string | undefined;
  private modalScrollOffset = 0;
  private transientHint: string | undefined;
  private readonly workspace: CurrentWorkspace;
  private get paneFocus(): PaneFocus { return this.workspace.focus; }
  private set paneFocus(value: PaneFocus) { this.workspace.focus = value; }
  private readonly savedModals = new Map<string, { offset: number; selected?: string | undefined }>();
  private activityScrollOffset = 0;
  private showActivity = false;
  private historyPaste = false;
  private historyPasteTail = "";
  private historyDraft: string | undefined;
  private selection: SelectList | undefined;
  private modalViewport = { width: 1, height: 1 };
  private workspaceBounds = { left: 1, top: 2, width: 0, height: 0 };
  private modelPicker: ModelPicker | undefined;
  private modelPickerKey: string | undefined;

  public constructor(
    private readonly tui: TUI,
    private readonly terminal: Terminal,
    private readonly service: InteractiveCoordinatorService,
    private readonly options: CoordinatorTuiAppOptions
  ) {
    this.workspace = new CurrentWorkspace(service, () => this.tui.requestRender());
    this.editor = new Editor(this.tui, EDITOR_THEME, {
      paddingX: 1,
      autocompleteMaxVisible: 8
    });
    this.autocompleteProvider = new CombinedAutocompleteProvider(REPL_COMPLETION_COMMANDS, this.service.getState().status.cwd);
    this.editor.setAutocompleteProvider(this.autocompleteProvider);
    this.editor.onSubmit = (text) => {
      if (!text.trim()) return;
      // Pi clears before onSubmit. Restore until the shared service accepts it.
      this.editor.setText(text);
      void this.service.dispatch({ type: "submit_input", input: text }, () => {
        this.editor.addToHistory(text);
        this.editor.setText("");
        this.transientHint = undefined;
      }).finally(() => {
        if (this.service.getState().shouldExit) this.options.onExit();
        this.tui.requestRender(true);
      });
    };
    this.editor.onChange = () => {
      if (this.transientHint) {
        this.transientHint = undefined;
        this.tui.requestRender();
      }
    };
  }

  public invalidate(): void {
    this.editor.invalidate();
  }

  public handleInput(data: string): void {
    const state = this.service.getState();
    this.workspace.syncState(state);
    this.syncModalState(state);
    if (this.captureHistoryPaste(data)) return;
    // Legacy terminals can deliver a quick Esc + letter as one Meta sequence.
    if (!this.controls && state.modal.kind === "none" && !this.workspace.historyVisible && !this.workspace.inspector
      && data.length === 2 && data.startsWith("\x1b") && controlActions.some((item) => item.key === data[1])) {
      this.handleInput("\x1b");
      this.handleInput(data.slice(1));
      return;
    }
    if (this.controls) {
      this.handleControlsInput(data);
      this.tui.requestRender(true);
      return;
    }
    const mouse = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(data);
    if (mouse) {
      const button = Number(mouse[1]);
      const x = Number(mouse[2]);
      const y = Number(mouse[3]);
      const bounds = this.workspaceBounds;
      if (state.modal.kind === "none" && mouse[4] === "M" && (button & 64) !== 0 && (button & 3) < 2
        && x >= bounds.left && x < bounds.left + bounds.width && y >= bounds.top && y < bounds.top + bounds.height) {
        this.workspace.scroll((button & 1) === 0 ? -3 : 3, state);
        this.tui.requestRender(true);
      }
      return;
    }
    if (state.modal.kind === "model_loading") {
      if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) void this.service.dispatch({ type: "cancel" });
      else if (matchesKey(data, "q")) this.controls = { kind: "quit" };
      this.tui.requestRender();
      return;
    }
    if (this.workspace.historyVisible && (matchesKey(data, Key.f2) || bindingMatches(data, "models"))) return;
    if ((state.modal.kind === "model_picker" || state.modal.kind === "model_error") && matchesKey(data, Key.ctrl("c"))) {
      void this.service.dispatch({ type: "close_modal" }); this.tui.requestRender(true); return;
    }
    if (bindingMatches(data, "help") || ((state.modal.kind !== "none" || this.paneFocus !== "editor") && matchesKey(data, "h"))) {
      if (state.modal.kind !== "none") this.savedModals.set(state.modal.createdAt, { offset: this.modalScrollOffset, selected: this.selection?.getSelectedItem()?.value });
      void this.service.dispatch({ type: state.modal.kind === "help" ? "close_modal" : "open_help" });
      this.tui.requestRender(true);
      return;
    }
    if (matchesKey(data, Key.ctrl("c"))) {
      this.handleCtrlC();
      return;
    }

    if (matchesKey(data, Key.escape)) {
      if (state.modal.kind !== "none") {
        this.modalScrollOffset = 0;
        this.lastModalKey = undefined;
        void this.service.dispatch({ type: "close_modal" });
        this.tui.requestRender(true);
      } else if (this.workspace.close()) {
        this.tui.requestRender(true);
      } else if (this.paneFocus === "editor" && this.editor.isShowingAutocomplete()) {
        this.editor.handleInput(data);
        this.tui.requestRender();
      } else {
        this.controls = { kind: "menu", selected: 0 };
        this.transientHint = undefined;
        this.tui.requestRender(true);
      }
      return;
    }

    if (state.modal.kind === "none" && this.workspace.historyVisible) {
      this.workspace.handleInput(data, state);
      this.tui.requestRender(true);
      return;
    }
    if (bindingMatches(data, "history")) {
      if (state.modal.kind === "none" && !this.workspace.inspector) this.openHistory(state);
      this.tui.requestRender(true);
      return;
    }
    if (bindingMatches(data, "models")) {
      void this.service.dispatch({ type: "open_models", role: "A" });
      this.tui.requestRender(true); return;
    }
    if (matchesKey(data, Key.f2) && state.modal.kind !== "none") {
      this.showActivity = !this.showActivity; this.tui.requestRender(true); return;
    }
    if (state.modal.kind !== "none") {
      if (this.handleModalInput(data, state, widthSafePageSize(this.terminal.rows))) this.tui.requestRender();
      return;
    }
    if (matchesKey(data, Key.f2)) {
      this.showActivity = !this.showActivity;
      if (!this.showActivity && this.paneFocus === "activity") this.paneFocus = "editor";
      this.tui.requestRender(true);
      return;
    }
    if (matchesKey(data, Key.f6)) {
      this.cyclePaneFocus(1);
      this.tui.requestRender(true);
      return;
    }

    if (matchesKey(data, Key.shift("f6"))) {
      this.cyclePaneFocus(-1);
      this.tui.requestRender(true);
      return;
    }

    if (this.paneFocus !== "editor") {
      if (matchesKey(data, Key.tab)) {
        this.cyclePaneFocus(1);
        this.tui.requestRender(true);
        return;
      }
      data = browsingInput(data);
    }

    if ((this.paneFocus === "editor" || this.paneFocus === "transcript") && this.workspace.scrollInput(data, state)) {
      this.tui.requestRender(true);
      return;
    }

    if (this.paneFocus !== "editor") {
      if (this.handlePaneInput(data, state)) {
        this.tui.requestRender(true);
        return;
      }
      return;
    }

    if (matchesKey(data, Key.alt("up")) && this.historyDraft === undefined) {
      this.openPromptHistory();
    } else if (this.historyDraft !== undefined && (matchesKey(data, Key.up) || matchesKey(data, Key.down))) {
      this.editor.handleInput(data);
      if (matchesKey(data, Key.down) && this.editor.getText() === "") {
        this.editor.setText(this.historyDraft);
        this.historyDraft = undefined;
      }
    } else {
      this.historyDraft = undefined;
      this.editor.handleInput(data);
    }
    this.tui.requestRender();
  }

  public render(width: number): string[] {
    const state = this.service.getState();
    this.workspace.syncState(state);
    if (!["running", "cancelling"].includes(state.operation.kind) && this.transientHint?.startsWith("Cancelling")) this.transientHint = undefined;
    this.syncModalState(state);
    this.editor.focused =
      this.focused && !this.controls && state.modal.kind === "none" && this.paneFocus === "editor";

    const headerLines = [padLine(`pi-dual  ${safeDisplayText(state.status.cwd)} | ${state.status.phaseLabel}`, width)];
    const footerLines = this.controls
      ? [padLine(this.controls.kind === "menu" ? "Controls | Letter or Up/Down + Enter | Esc back" : "Quit? y confirm | n or Esc back", width), padLine("Your draft is preserved while this menu is open.", width)]
      : renderFooter(state, width, this.transientHint, this.paneFocus);
    const editorLines = this.renderEditor(width, Math.max(1, this.terminal.rows - 6));
    const available = Math.max(0, this.terminal.rows - headerLines.length - footerLines.length - editorLines.length);
    const panelHeight = Math.min(width >= 100 && this.terminal.rows >= 30 ? 10 : width >= 80 && this.terminal.rows >= 24 ? 7 : 3, available);
    const bodyHeight = Math.max(0, available - panelHeight);
    const diagnosticsHeight = this.showActivity && !this.controls && state.modal.kind === "none" ? Math.min(8, Math.max(0, bodyHeight - 4)) : 0;
    const narrativeHeight = bodyHeight - diagnosticsHeight;
    this.workspaceBounds = { left: 2, top: headerLines.length + 2, width: Math.max(0, width - 2), height: Math.max(0, narrativeHeight - 2) };
    this.modalViewport = { width, height: bodyHeight };
    const mainLines = bodyHeight === 0 ? [] : this.controls ? this.renderControls(width, bodyHeight)
      : state.modal.kind !== "none" ? this.renderModalBody(state, width, bodyHeight)
      : [...this.workspace.render(state, width, narrativeHeight), ...(diagnosticsHeight ? frame(`Activity${this.paneFocus === "activity" ? " [focus]" : ""}`, selectPanelViewport(renderActivity(state, width - 2), diagnosticsHeight, "bottom", this.activityScrollOffset).lines, width, diagnosticsHeight) : [])];
    const view = this.workspace.viewStatus(state, this.controls ? "controls" : narrativeHeight < 6 ? "compact" : false);
    const panel = renderCurrentActivity(state, width, panelHeight, performance.now(), view);
    const lines = normalizeScreen([...headerLines, ...fitBody(mainLines, width, bodyHeight), ...panel, ...editorLines, ...footerLines], width, this.terminal.rows);

    return lines;
  }

  private renderEditor(width: number, height: number): string[] {
    const focused = this.editor.focused;
    // Measure Pi's cursor row while a body view owns focus, then omit the hardware marker.
    this.editor.focused = true;
    try {
      const lines = editorViewport(this.editor.render(width), height);
      return focused ? lines : lines.map((line) => line.replaceAll(CURSOR_MARKER, ""));
    } finally { this.editor.focused = focused; }
  }

  private openHistory(state: InteractiveUiState): void {
    // Pi cancels visible and pending completion when the provider is reattached.
    this.editor.setAutocompleteProvider(this.autocompleteProvider);
    this.workspace.openHistory(state);
  }

  private captureHistoryPaste(data: string): boolean {
    const start = "\x1b[200~";
    const end = "\x1b[201~";
    if (!this.historyPaste && this.workspace.historyVisible
      && (data.includes(start) || (data.length > 1 && start.startsWith(data)))) this.historyPaste = true;
    if (!this.historyPaste) return false;
    const chunk = this.historyPasteTail + data;
    if (chunk.includes(end)) { this.historyPaste = false; this.historyPasteTail = ""; }
    else this.historyPasteTail = chunk.slice(-(end.length - 1));
    return true;
  }

  private openPromptHistory(): void {
    this.paneFocus = "editor";
    if (this.historyDraft !== undefined) return;
    this.historyDraft = this.editor.getExpandedText();
    this.editor.setText("");
    this.editor.handleInput("\x1b[A");
    if (!this.editor.getText()) {
      this.editor.setText(this.historyDraft);
      this.historyDraft = undefined;
    }
  }

  private handleControlsInput(data: string): void {
    if (data.includes("\x1b[200~")) this.controlsPaste = true;
    if (this.controlsPaste) {
      if (data.includes("\x1b[201~")) this.controlsPaste = false;
      return;
    }
    const controls = this.controls;
    if (!controls) return;
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.controls = undefined;
      if (matchesKey(data, Key.ctrl("c")) && ["running", "cancelling"].includes(this.service.getState().operation.kind)) this.handleCtrlC();
      return;
    }
    if (controls.kind === "quit") {
      if (matchesKey(data, "y")) {
        this.controls = undefined;
        void this.service.dispatch({ type: "quit" });
      } else if (matchesKey(data, "n")) this.controls = undefined;
      return;
    }
    if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
      controls.selected = (controls.selected + (matchesKey(data, Key.up) ? -1 : 1) + controlActions.length) % controlActions.length;
      return;
    }
    const choice = matchesKey(data, Key.enter) ? controlActions[controls.selected]
      : controlActions.find((item) => matchesKey(data, item.key));
    if (!choice) return;
    this.controls = undefined;
    this.runControl(choice.action);
  }

  private runControl(action: ControlAction): void {
    switch (action) {
      case "help": void this.service.dispatch({ type: "open_help" }); break;
      case "models": void this.service.dispatch({ type: "open_models", role: "A" }); break;
      case "activity":
        this.showActivity = !this.showActivity;
        if (!this.showActivity && this.paneFocus === "activity") this.paneFocus = "editor";
        break;
      case "workspace": this.workspace.focusWorkspace(); break;
      case "history": this.openHistory(this.service.getState()); break;
      case "editor": this.paneFocus = "editor"; break;
      case "prompts": this.openPromptHistory(); break;
      case "latest": this.workspace.followLatest(this.service.getState()); break;
      case "newline": this.paneFocus = "editor"; this.historyDraft = undefined; this.editor.insertTextAtCursor("\n"); break;
      case "cancel": void this.service.dispatch({ type: "cancel" }); break;
      case "quit": this.controls = { kind: "quit" }; break;
      default: { const exhaustive: never = action; return exhaustive; }
    }
  }

  private renderControls(width: number, height: number): string[] {
    if (this.controls?.kind === "quit") {
      return frame("Quit pi-dual?", ["Running work will be cancelled before exit.", "Unsubmitted draft text will be lost on exit.", "", "y confirm | n or Esc back"], width, height);
    }
    const selected = this.controls?.kind === "menu" ? this.controls.selected : 0;
    if (width >= 80 && height < controlActions.length + 4) {
      const columnWidth = Math.floor((width - 2) / 2);
      const rows: string[] = [];
      for (let index = 0; index < controlActions.length; index += 2) {
        const label = (offset: number) => {
          const item = controlActions[offset];
          return item ? `${offset === selected ? ">" : " "} ${item.key}  ${item.label}` : "";
        };
        rows.push(padLine(label(index), columnWidth) + label(index + 1));
      }
      rows.push(controlActions[selected]?.description ?? "", "Letter or Up/Down + Enter | Esc back");
      return frame("Controls", rows, width, height);
    }
    const count = Math.max(1, height - 4);
    const start = Math.max(0, Math.min(selected - count + 1, controlActions.length - count));
    const body = controlActions.slice(start, start + count).map((item, index) =>
      `${start + index === selected ? ">" : " "} ${item.key}  ${item.label} - ${item.description}`);
    return frame("Controls", [...body, "", `Letter or Up/Down + Enter | Esc back | ${start + 1}-${Math.min(controlActions.length, start + count)} of ${controlActions.length}`], width, height);
  }

  private handleCtrlC(): void {
    const state = this.service.getState();
    if (["running", "cancelling"].includes(state.operation.kind)) {
      void this.service.dispatch({ type: "cancel" });
      this.transientHint = "Cancelling work. Your draft and completed file changes are preserved.";
      this.tui.requestRender(true);
      return;
    }
    if (state.modal.kind !== "none") {
      void this.service.dispatch({ type: "close_modal" });
      this.lastCtrlCAt = 0;
      this.tui.requestRender(true);
      return;
    }
    if (this.workspace.historyVisible) {
      this.workspace.close();
      this.lastCtrlCAt = 0;
      this.tui.requestRender(true);
      return;
    }
    const now = Date.now();
    if (this.editor.getText()) {
      this.editor.setText("");
      this.transientHint = "Editor cleared. Press Ctrl+C again on an empty editor to exit.";
      this.lastCtrlCAt = now;
      this.tui.requestRender(true);
      return;
    }

    if (now - this.lastCtrlCAt < 1200) {
      void this.service.dispatch({ type: "quit" });
      return;
    }

    this.lastCtrlCAt = now;
    this.transientHint = "Press Ctrl+C again to exit.";
    this.tui.requestRender(true);
  }

  private cyclePaneFocus(direction: 1 | -1): void {
    this.workspace.cycle(direction, this.showActivity);
    this.transientHint = undefined;
  }

  private syncModalState(state: InteractiveUiState): void {
    if (state.modal.kind === "none") {
      this.lastModalKey = undefined;
      this.modalScrollOffset = 0;
      this.selection = undefined;
      this.modelPicker = undefined; this.modelPickerKey = undefined;
      return;
    }

    const contentKey = `${state.modal.kind}:${state.modal.createdAt}:${state.modal.content}`;
    if (state.modal.kind === "model_picker" && this.modelPickerKey !== `${state.modal.createdAt}:${state.modal.catalog.role}`) {
      this.modelPickerKey = `${state.modal.createdAt}:${state.modal.catalog.role}`;
      this.modelPicker = new ModelPicker(state.modal.catalog);
    }
    const modalKey = `${contentKey}:${this.terminal.columns}:${this.terminal.rows}`;
    if (modalKey !== this.lastModalKey) {
      const sameModal = this.lastModalKey?.startsWith(`${contentKey}:`);
      const selected = sameModal ? this.selection?.getSelectedItem()?.value : this.savedModals.get(state.modal.createdAt)?.selected;
      this.lastModalKey = modalKey;
      if (!sameModal) this.modalScrollOffset = this.savedModals.get(state.modal.createdAt)?.offset ?? 0;
      const choices = state.modal.choices;
      this.selection = choices?.length ? new SelectList(choices, Math.max(1, Math.min(10, this.terminal.rows - 8)), EDITOR_THEME.selectList) : undefined;
      if (selected && choices) this.selection?.setSelectedIndex(Math.max(0, choices.findIndex((choice) => choice.value === selected)));
      if (this.selection) this.selection.onSelect = (item) => { void this.service.dispatch({ type: "select_choice", value: item.value }); };
    }
  }

  private renderModalBody(state: InteractiveUiState, width: number, height: number): string[] {
    const modal = state.modal;
    if (modal.kind === "none") return [];
    if (this.controls) return this.renderControls(width, height);
    if (modal.kind === "model_picker") return this.modelPicker?.render(width, Math.min(19, height), ["running", "cancelling"].includes(this.service.getState().operation.kind), Boolean(this.service.getState().pendingPlan)) ?? [];
    if (modal.kind === "model_loading") {
      const elapsed = Math.max(0, Math.floor((Date.now() - modal.startedAt) / 1000));
      const spinner = process.env.TERM === "dumb" ? "*" : ["|", "/", "-", "\\"][elapsed % 4];
      const content = modal.cancelling && modal.progress.phase !== "restoring" ? "Cancelling… waiting for LM Studio before restoring the previous model." : modal.content;
      const body = ["", ...wrapBlock(`${spinner} ${content}`, width - 4), "", `${elapsed}s elapsed`, "Your conversation and draft are preserved.", "", modal.cancelling ? "Restoring safely. Please wait. | q quit with confirmation" : "Esc cancel | q quit with confirmation"];
      return frame(modal.title, body, width, Math.min(height, body.length + 2), modal.role);
    }
    if (modal.kind === "model_error") {
      const errorHeight = Math.min(height, 15);
      const choices = this.selection?.render(width - 2) ?? [];
      const message = wrapBlock(modal.content, width - 4).slice(0, Math.max(1, errorHeight - choices.length - 5));
      return frame(modal.title, [...message, "", ...choices, "", "↑/↓ choose | Enter select | Esc back"], width, errorHeight);
    }
    if (this.selection && modal.kind !== "history") return [padLine(modal.title, width), ...modal.content.split("\n").slice(0, 2).map((line) => padLine(line, width)), padLine("Up/Down choose | Enter apply | Esc close | Ctrl+C cancel", width), ...this.selection.render(width)].slice(0, height);
    return renderModal(modal.kind === "help" ? { ...modal, content: contextualHelp(this.workspace.context) + "\n\n" + modal.content } : modal, width, height, this.modalScrollOffset);
  }

  private handleModalInput(
    data: string,
    state: InteractiveUiState,
    pageSize: number
  ): boolean {
    if (state.modal.kind === "none") {
      return false;
    }

    if (state.modal.kind === "model_picker") {
      const action = this.modelPicker?.handleInput(data, ["running", "cancelling"].includes(state.operation.kind));
      if (action) void this.service.dispatch(action);
      return true;
    }

    data = browsingInput(data);
    if (this.selection && (state.modal.kind !== "history" || matchesKey(data, Key.enter))) {
      this.selection.handleInput(data);
      return true;
    }
    const maxOffset = getModalMaxScrollOffset(
      state.modal.kind === "help" ? { ...state.modal, content: contextualHelp(this.workspace.context) + "\n\n" + state.modal.content } : state.modal,
      this.modalViewport.width,
      this.modalViewport.height
    );

    if (maxOffset <= 0) {
      return false;
    }

    const previous = this.modalScrollOffset;
    if (matchesKey(data, Key.up)) {
      this.modalScrollOffset = Math.max(0, this.modalScrollOffset - 1);
    } else if (matchesKey(data, Key.down)) {
      this.modalScrollOffset = Math.min(maxOffset, this.modalScrollOffset + 1);
    } else if (matchesKey(data, Key.pageUp)) {
      this.modalScrollOffset = Math.max(0, this.modalScrollOffset - pageSize);
    } else if (matchesKey(data, Key.pageDown)) {
      this.modalScrollOffset = Math.min(maxOffset, this.modalScrollOffset + pageSize);
    } else if (matchesKey(data, Key.home)) {
      this.modalScrollOffset = 0;
    } else if (matchesKey(data, Key.end)) {
      this.modalScrollOffset = maxOffset;
    }

    return previous !== this.modalScrollOffset;
  }

  private handlePaneInput(data: string, state: InteractiveUiState): boolean {
    if (this.paneFocus !== "activity") return this.workspace.handleInput(data, state);
    const next = getNextScrollOffset(data, this.activityScrollOffset, Math.max(0, renderActivity(state, this.terminal.columns - 2).length - 4), widthSafePageSize(this.terminal.rows), "bottom");
    if (next !== undefined) this.activityScrollOffset = next;
    return true;
  }

}

function renderFooter(
  state: InteractiveUiState,
  width: number,
  transientHint: string | undefined,
  paneFocus: PaneFocus
): string[] {
  if (width < 80) {
    const context = state.modal.kind === "model_loading" ? "Esc cancel | q quit"
      : state.modal.kind !== "none" ? "Esc back | h help"
      : paneFocus === "editor" ? "Enter submit | Esc controls" : "Esc controls | h help";
    const controls = ["running", "cancelling"].includes(state.operation.kind) ? "Ctrl+C cancel | /quit exits" : "Ctrl+C clears draft; repeat exits";
    return [padLine(context, width), padLine(controls, width)];
  }
  if (state.modal.kind !== "none") {
    return [padLine(state.modal.kind === "model_picker" ? "Esc back | h help | a/b agent | Arrows choose | Enter apply"
      : state.modal.kind === "model_loading" ? "Esc cancel | q quit with confirmation"
      : state.modal.choices?.length && state.modal.kind !== "history" ? "Esc back | h help | Up/Down choose | Enter apply"
      : "Esc back | h help | Up/Down scroll | u/d page | g/l edges", width),
      padLine("Your draft is preserved while browsing.", width)];
  }
  const baseHint = footerBindings(paneFocus);
  const statusHint = transientHint ?? state.lastError?.message ?? state.notification?.message ??
    (paneFocus === "editor" ? "Esc then: w workspace | r history | l latest | n newline | x cancel"
      : paneFocus === "transcript" ? "u/d page | g beginning | l follow | Space fold | Left/Right expand/collapse"
      : paneFocus === "inspector" || paneFocus === "activity" ? "Up/Down scroll | u/d page | g/l edges | Esc back"
      : "u/d page | g beginning | l latest | Esc back");
  return [padLine(baseHint, width), padLine(safeDisplayText(statusHint), width)];
}

function renderActivity(state: InteractiveUiState, width: number): string[] {
  const lines: string[] = [];

  if (state.pendingPlan) {
    lines.push(...wrapBlock(renderPendingPlan(state.pendingPlan.plan, state.pendingPlan.nextActionHint), width));
    lines.push("");
  }

  for (const runtime of orderRuntimesForActivity(state.status)) {
    const history = state.activity.history[runtime.role];
    lines.push(paintRole(`${roleLabel(runtime.role)}: ${runtime.modelDisplay}`, runtime.role));
    lines.push(`  session ${runtime.sessionId}`);
    lines.push(`  health ${runtime.healthy ? "ok" : "down"}`);
    lines.push(...wrapBlock(`  summary ${renderRuntimeActivitySummary(history).join(", ")}`, width));
    lines.push("  recent");
    if (history?.recent.length) {
      for (const item of history.recent) {
        const prefix =
          item.status === "active" ? "  * " : item.status === "failed" ? "  ! " : "  - ";
        lines.push(...wrapBlock(`${prefix}${roleLabel(runtime.role)} [${item.status}] ${item.text}`, width).map((line) => paintRole(line, runtime.role)));
      }
    } else if (runtime.currentActivity) {
      lines.push(...wrapBlock(`  * ${runtime.currentActivity}`, width));
    } else {
      lines.push("  - no recent tool activity");
    }
    lines.push("");
  }

  if (lines.length === 0) {
    lines.push("No active workflow state.");
  }

  return lines;
}

export interface PanelViewport {
  lines: string[];
  startLine: number;
  endLine: number;
  totalLines: number;
  maxOffset: number;
  scrollOffset: number;
}

export function selectPanelViewport(
  bodyLines: string[],
  height: number,
  align: PanelAlign,
  scrollOffset = 0
): PanelViewport {
  const visibleHeight = Math.max(1, height - 2);
  const totalLines = bodyLines.length;
  const maxOffset = Math.max(0, totalLines - visibleHeight);
  const clampedOffset = Math.max(0, Math.min(scrollOffset, maxOffset));
  const startLine =
    align === "top"
      ? clampedOffset
      : Math.max(0, totalLines - visibleHeight - clampedOffset);
  const endLine = Math.min(totalLines, startLine + visibleHeight);

  return {
    lines: bodyLines.slice(startLine, endLine),
    startLine: totalLines === 0 ? 0 : startLine + 1,
    endLine,
    totalLines,
    maxOffset,
    scrollOffset: clampedOffset
  };
}

function renderModal(
  modal: UiModalState,
  width: number,
  height: number,
  scrollOffset: number
): string[] {
  if (modal.kind === "none") {
    return [];
  }

  const modalWidth = Math.max(1, width);
  const modalHeight = Math.max(1, height);
  const innerWidth = Math.max(1, modalWidth - 2);
  const wrapped = wrapBlock(modal.content, innerWidth);
  const bodyHeight = Math.max(1, modalHeight - 3);
  const maxOffset = Math.max(0, wrapped.length - bodyHeight);
  const clampedOffset = Math.max(0, Math.min(scrollOffset, maxOffset));
  const body = wrapped.slice(clampedOffset, clampedOffset + bodyHeight);
  const footerText =
    maxOffset > 0
      ? `${modal.choices?.length ? "Enter switch | " : ""}Scroll ${clampedOffset + 1}-${Math.min(wrapped.length, clampedOffset + body.length)} of ${wrapped.length} | Up/Down u/d page g/l edges | Esc close`
      : modal.choices?.length ? "Enter switch session | Esc close" : "Esc close";
  const lines = [
    `+${truncateToWidth(` ${modal.title} `, innerWidth, "...", true)}+`,
    ...body.map((line) => `|${padLine(line, innerWidth)}|`),
    `|${padLine(footerText, innerWidth)}|`
  ];
  lines.push(`+${"-".repeat(innerWidth)}+`);
  return lines;
}

function getModalMaxScrollOffset(
  modal: UiModalState,
  width: number,
  height: number
): number {
  if (modal.kind === "none") {
    return 0;
  }

  const modalWidth = Math.max(1, width);
  const modalHeight = Math.max(1, height);
  const innerWidth = Math.max(1, modalWidth - 2);
  const bodyHeight = Math.max(1, modalHeight - 3);
  const wrapped = wrapBlock(modal.content, innerWidth);
  return Math.max(0, wrapped.length - bodyHeight);
}

function widthSafePageSize(rows: number): number {
  return Math.max(3, Math.floor(rows * 0.3));
}

export function getNextScrollOffset(
  data: string,
  currentOffset: number,
  maxOffset: number,
  pageSize: number,
  align: PanelAlign
): number | undefined {
  const towardStart =
    align === "top"
      ? {
          line: Math.max(0, currentOffset - 1),
          page: Math.max(0, currentOffset - pageSize),
          edge: 0
        }
      : {
          line: Math.min(maxOffset, currentOffset + 1),
          page: Math.min(maxOffset, currentOffset + pageSize),
          edge: maxOffset
        };
  const towardEnd =
    align === "top"
      ? {
          line: Math.min(maxOffset, currentOffset + 1),
          page: Math.min(maxOffset, currentOffset + pageSize),
          edge: maxOffset
        }
      : {
          line: Math.max(0, currentOffset - 1),
          page: Math.max(0, currentOffset - pageSize),
          edge: 0
        };

  if (matchesKey(data, Key.up)) {
    return towardStart.line;
  }
  if (matchesKey(data, Key.down)) {
    return towardEnd.line;
  }
  if (matchesKey(data, Key.pageUp)) {
    return towardStart.page;
  }
  if (matchesKey(data, Key.pageDown)) {
    return towardEnd.page;
  }
  if (matchesKey(data, Key.home)) {
    return towardStart.edge;
  }
  if (matchesKey(data, Key.end)) {
    return towardEnd.edge;
  }
  return undefined;
}

function normalizeScreen(lines: string[], width: number, height: number): string[] {
  const next = lines.slice(0, height).map((line) => padLine(line, width));
  while (next.length < height) {
    next.push(" ".repeat(width));
  }
  return next;
}

function wrapBlock(text: string, width: number): string[] {
  if (width <= 1) {
    return [text.slice(0, width)];
  }

  return safeDisplayText(text)
    .split("\n")
    .flatMap((line) => {
      const wrapped = wrapTextWithAnsi(line, width);
      return wrapped.length > 0 ? wrapped : [""];
    });
}

function padLine(text: string, width: number): string {
  return truncateToWidth(text.replace(/[\r\n\t]/g, " "), width, "...", true);
}

function orderRuntimesForActivity(
  status: InteractiveUiState["status"]
): InteractiveUiState["status"]["runtimes"] {
  return [...status.runtimes].sort((left, right) => {
    if (left.role === status.activeRole) {
      return -1;
    }
    if (right.role === status.activeRole) {
      return 1;
    }
    return left.role.localeCompare(right.role);
  });
}

/** Bound only the rendered editor viewport; Pi still owns the full draft and cursor. */
function editorViewport(lines: string[], height: number): string[] {
  if (lines.length <= height) return lines;
  const cursor = lines.findIndex((line) => line.includes(CURSOR_MARKER));
  const start = Math.max(0, Math.min(lines.length - height, cursor < 0 ? 0 : cursor - Math.floor(height / 2)));
  return lines.slice(start, start + height);
}

function fitBody(lines: string[], width: number, height: number): string[] {
  return Array.from({ length: height }, (_, index) => padLine(lines[index] ?? "", width));
}
