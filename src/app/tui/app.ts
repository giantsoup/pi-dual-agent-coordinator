import { roleLabel } from "../../types/history.js";
import { CurrentWorkspace, liveIdentity, paintRole, type WorkspaceFocus, frame } from "./workspace.js";
import { bindingMatches, contextualHelp, footerBindings } from "./bindings.js";
import { safeDisplayText } from "../../security/display-text.js";
import {
  Editor,
  SelectList,
  CombinedAutocompleteProvider,
  matchesKey,
  Key,
  TUI,
  truncateToWidth,
  wrapTextWithAnsi,
  type Component,
  type EditorTheme,
  type Focusable,
  type Terminal
} from "@mariozechner/pi-tui";

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
  private historyRailVisible = false;
  private overlay: ReturnType<TUI["showOverlay"]> | undefined;
  private historyDraft: string | undefined;
  private selection: SelectList | undefined;
  private modalViewport = { width: 1, height: 1 };

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
    this.editor.setAutocompleteProvider(new CombinedAutocompleteProvider(REPL_COMPLETION_COMMANDS, this.service.getState().status.cwd));
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
    if (bindingMatches(data, "help")) {
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
      } else if (this.paneFocus !== "editor") {
        this.paneFocus = "editor";
        this.tui.requestRender(true);
      } else if (this.transientHint) {
        this.transientHint = undefined;
        this.tui.requestRender();
      } else {
        this.editor.handleInput(data);
        this.tui.requestRender();
      }
      return;
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
      if (this.handlePaneInput(data, state)) {
        this.tui.requestRender(true);
        return;
      }
      return;
    }

    if (matchesKey(data, Key.alt("up")) && this.historyDraft === undefined) {
      this.historyDraft = this.editor.getExpandedText();
      this.editor.setText("");
      this.editor.handleInput("\u001b[A");
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
    if (!["running", "cancelling"].includes(state.operation.kind) && this.transientHint?.startsWith("Cancelling")) this.transientHint = undefined;
    this.syncModalState(state);
    this.editor.focused =
      this.focused && state.modal.kind === "none" && this.paneFocus === "editor";

    const live = liveIdentity(state);
    const headerLines = [padLine(`pi-dual  ${safeDisplayText(state.status.cwd)} | ${state.status.phaseLabel}`, width),
      paintRole(padLine(this.workspace.pointer(state), width), live.role)];
    const footerLines = renderFooter(state, width, this.transientHint, this.paneFocus);
    const editorLines = this.editor.render(width);
    const availableMainHeight = Math.max(1, this.terminal.rows - headerLines.length - footerLines.length - editorLines.length);
    const activityHeight = this.showActivity ? Math.min(8, Math.max(3, Math.floor(availableMainHeight * .27))) : 0;
    const bodyHeight = Math.max(1, availableMainHeight - activityHeight);
    this.historyRailVisible = width >= 104 && bodyHeight >= 14;
    const mainLines = [...this.workspace.render(state, width, bodyHeight), ...(this.showActivity ? frame(`Activity${this.paneFocus === "activity" ? " [focus]" : ""}`, selectPanelViewport(renderActivity(state, width - 2), activityHeight, "top", this.activityScrollOffset).lines, width, activityHeight) : [])];

    let lines = [...headerLines, ...mainLines, ...editorLines, ...footerLines];
    lines = normalizeScreen(lines, width, this.terminal.rows);

    if (width < 80 || this.terminal.rows < 24) {
      lines = normalizeScreen([
        padLine("Compact terminal. Resize to at least 80x24. /quit exits; Ctrl+C cancels.", width),
        ...mainLines.slice(0, Math.max(0, this.terminal.rows - editorLines.length - 3)),
        ...editorLines,
        ...footerLines
      ], width, this.terminal.rows);
    }

    return lines;
  }

  private handleCtrlC(): void {
    if (["running", "cancelling"].includes(this.service.getState().operation.kind)) {
      void this.service.dispatch({ type: "cancel" });
      this.transientHint = "Cancelling work. Your draft and completed file changes are preserved.";
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
      if (this.overlay) { this.overlay.hide(); this.overlay = undefined; this.tui.setFocus(this); }
      return;
    }

    const contentKey = `${state.modal.kind}:${state.modal.createdAt}:${state.modal.content}`;
    const modalKey = `${contentKey}:${this.terminal.columns}:${this.terminal.rows}`;
    if (modalKey !== this.lastModalKey) {
      const sameModal = this.lastModalKey?.startsWith(`${contentKey}:`);
      const selected = sameModal ? this.selection?.getSelectedItem()?.value : this.savedModals.get(state.modal.createdAt)?.selected;
      this.lastModalKey = modalKey;
      if (!sameModal) this.modalScrollOffset = this.savedModals.get(state.modal.createdAt)?.offset ?? 0;
      this.overlay?.hide();
      const choices = state.modal.choices;
      this.selection = choices?.length ? new SelectList(choices, Math.max(1, Math.min(10, this.terminal.rows - 8)), EDITOR_THEME.selectList) : undefined;
      if (selected && choices) this.selection?.setSelectedIndex(Math.max(0, choices.findIndex((choice) => choice.value === selected)));
      if (this.selection) this.selection.onSelect = (item) => { void this.service.dispatch({ type: "select_choice", value: item.value }); };
      this.overlay = this.tui.showOverlay({
        render: (width) => {
          this.modalViewport = { width, height: Math.max(3, this.terminal.rows - this.editor.render(this.terminal.columns).length - 4) };
          const modal = this.service.getState().modal;
          if (modal.kind === "none") return [];
          if (this.selection && modal.kind !== "history") return [padLine(modal.title, width), ...modal.content.split("\n").slice(0, 2).map((line) => padLine(line, width)), padLine("Up/Down choose | Enter apply | Esc close | Ctrl+C cancel", width), ...this.selection.render(width)].slice(0, this.modalViewport.height);
          return renderModal(modal.kind === "help" ? { ...modal, content: contextualHelp(this.workspace.context) + "\n\n" + modal.content } : modal, width, this.modalViewport.height, this.modalScrollOffset);
        },
        invalidate() {},
        handleInput: (data) => this.handleInput(data)
      }, { width: "100%", row: 2, maxHeight: Math.max(3, this.terminal.rows - this.editor.render(this.terminal.columns).length - 4), margin: { top: 2, bottom: this.editor.render(this.terminal.columns).length + 2, left: 0, right: 0 } });
    }
  }

  private handleModalInput(
    data: string,
    state: InteractiveUiState,
    pageSize: number
  ): boolean {
    if (state.modal.kind === "none") {
      return false;
    }

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
    if (this.paneFocus !== "activity") return this.workspace.handleInput(data, state, this.historyRailVisible);
    const next = getNextScrollOffset(data, this.activityScrollOffset, Math.max(0, renderActivity(state, this.terminal.columns - 2).length - 4), widthSafePageSize(this.terminal.rows), "top");
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
  const baseHint = footerBindings(paneFocus);
  const statusHint = transientHint ?? state.lastError?.message ?? state.notification?.message ??
    (paneFocus === "editor" ? "Enter submit | Tab complete | Shift+Enter newline | /help commands" : "Arrows select | PgUp/PgDn page | End current/follow | Esc back | Ctrl+C cancel");
  return [padLine(baseHint, width), padLine(safeDisplayText(statusHint), width)];
}

function renderActivity(state: InteractiveUiState, width: number): string[] {
  const lines: string[] = [];
  const summary = selectPrimaryActivitySummary(state);
  if (summary) {
    lines.push(`Now: ${summary.activity}`);
    if (summary.reason) {
      lines.push(...wrapBlock(`Why: ${summary.reason}`, width));
    }
    lines.push("");
  }

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
      ? `${modal.choices?.length ? "Enter switch | " : ""}Scroll ${clampedOffset + 1}-${Math.min(wrapped.length, clampedOffset + body.length)} of ${wrapped.length} | Up/Down PgUp/PgDn Home/End | Esc close`
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

function selectPrimaryActivitySummary(
  state: InteractiveUiState
): { activity: string; reason?: string | undefined } | undefined {
  const active = state.activity.active;
  if (active) {
    return {
      activity: `${active.label}${active.target ? ` ${active.target}` : ""}`,
      reason: active.reason
    };
  }

  if (state.status.coordinatorActivity) {
    return {
      activity: state.status.coordinatorActivity,
      reason: state.status.coordinatorReason
    };
  }

  if (state.status.currentActivity) {
    return {
      activity: state.status.currentActivity,
      reason: state.status.currentReason
    };
  }

  return undefined;
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
