import {
  Editor,
  TUI,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type EditorTheme,
  type Focusable,
  type Terminal
} from "@mariozechner/pi-tui";

import {
  INTERACTIVE_COMMAND_HINT,
  INTERACTIVE_TUI_KEY_HINT
} from "../interactive/compat.js";
import type { InteractiveCoordinatorService } from "../interactive/service.js";
import { renderConversationEntry, renderPendingPlan } from "../interactive/presentation.js";
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

export class CoordinatorTuiApp implements Component, Focusable {
  public focused = false;

  private readonly editor: Editor;
  private lastCtrlCAt = 0;
  private lastModalKey: string | undefined;
  private modalScrollOffset = 0;
  private transientHint: string | undefined;
  private submitting = false;

  public constructor(
    private readonly tui: TUI,
    private readonly terminal: Terminal,
    private readonly service: InteractiveCoordinatorService,
    private readonly options: CoordinatorTuiAppOptions
  ) {
    this.editor = new Editor(this.tui, EDITOR_THEME, {
      paddingX: 1,
      autocompleteMaxVisible: 8
    });
    this.editor.onSubmit = (text) => {
      if (!text.trim() || this.submitting) {
        return;
      }
      this.submitting = true;
      this.editor.disableSubmit = true;
      this.transientHint = undefined;
      void this.service
        .dispatch({
          type: "submit_input",
          input: text
        })
        .finally(() => {
          this.editor.setText("");
          this.editor.disableSubmit = false;
          this.submitting = false;
          if (this.service.getState().shouldExit) {
            this.options.onExit();
          }
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
    if (data === "\u0003") {
      this.handleCtrlC();
      return;
    }

    if (data === "\u001b") {
      if (state.modal.kind !== "none") {
        this.modalScrollOffset = 0;
        this.lastModalKey = undefined;
        void this.service.dispatch({ type: "close_modal" });
        this.tui.requestRender(true);
      } else if (this.transientHint) {
        this.transientHint = undefined;
        this.tui.requestRender();
      }
      return;
    }

    if (state.modal.kind !== "none") {
      if (this.handleModalInput(data, state, widthSafePageSize(this.terminal.rows))) {
        this.tui.requestRender(true);
      }
      return;
    }

    this.editor.handleInput(data);
    this.tui.requestRender();
  }

  public render(width: number): string[] {
    const state = this.service.getState();
    this.editor.focused = this.focused && state.modal.kind === "none";
    this.syncModalState(state);

    const headerLines = renderHeader(state, width);
    const footerLines = renderFooter(state, width, this.transientHint);
    const editorLines = this.editor.render(width);
    const availableMainHeight = Math.max(
      8,
      this.terminal.rows - headerLines.length - footerLines.length - editorLines.length
    );
    const mainLines =
      width >= 100
        ? renderSplitMain(state, width, availableMainHeight)
        : renderStackedMain(state, width, availableMainHeight);

    let lines = [...headerLines, ...mainLines, ...editorLines, ...footerLines];
    lines = normalizeScreen(lines, width, this.terminal.rows);

    if (state.modal.kind !== "none") {
      lines = overlayModal(
        lines,
        renderModal(state.modal, width, this.terminal.rows, this.modalScrollOffset)
      );
    }

    return lines;
  }

  private handleCtrlC(): void {
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
      this.options.onExit();
      return;
    }

    this.lastCtrlCAt = now;
    this.transientHint = "Press Ctrl+C again to exit.";
    this.tui.requestRender(true);
  }

  private syncModalState(state: InteractiveUiState): void {
    if (state.modal.kind === "none") {
      this.lastModalKey = undefined;
      this.modalScrollOffset = 0;
      return;
    }

    const modalKey = `${state.modal.kind}:${state.modal.createdAt}`;
    if (modalKey !== this.lastModalKey) {
      this.lastModalKey = modalKey;
      this.modalScrollOffset = 0;
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

    const maxOffset = getModalMaxScrollOffset(
      state.modal,
      this.terminal.columns,
      this.terminal.rows
    );

    if (maxOffset <= 0) {
      return false;
    }

    const previous = this.modalScrollOffset;
    if (data === "\u001b[A" || data === "\u001bOA") {
      this.modalScrollOffset = Math.max(0, this.modalScrollOffset - 1);
    } else if (data === "\u001b[B" || data === "\u001bOB") {
      this.modalScrollOffset = Math.min(maxOffset, this.modalScrollOffset + 1);
    } else if (data === "\u001b[5~") {
      this.modalScrollOffset = Math.max(0, this.modalScrollOffset - pageSize);
    } else if (data === "\u001b[6~") {
      this.modalScrollOffset = Math.min(maxOffset, this.modalScrollOffset + pageSize);
    } else if (data === "\u001b[H" || data === "\u001bOH") {
      this.modalScrollOffset = 0;
    } else if (data === "\u001b[F" || data === "\u001bOF") {
      this.modalScrollOffset = maxOffset;
    }

    return previous !== this.modalScrollOffset;
  }
}

function renderHeader(state: InteractiveUiState, width: number): string[] {
  const status = state.status;
  const workflow = [
    status.activeWorkflowId ? `workflow ${status.activeWorkflowId}` : "workflow idle",
    status.currentIteration ? `iter ${status.currentIteration}` : undefined,
    status.workflowStatus ? status.workflowStatus : undefined
  ]
    .filter(Boolean)
    .join(" | ");

  const runtimeHealth = status.runtimes
    .map((runtime) => `${runtime.role}:${runtime.healthy ? "ok" : "down"}`)
    .join("  ");
  const badges = [
    `phase ${status.phaseLabel}`,
    `active ${status.activeRoleLabel}`,
    state.pendingPlan ? "plan ready" : undefined,
    `repairs ${status.repairCount}/${status.maxReviewRounds}`
  ]
    .filter(Boolean)
    .join("  ");

  return [
    padLine(`pi-dual coordinator  ${badges}`, width),
    padLine(
      `${workflow}  ${status.activeModelDisplay}  ${runtimeHealth}`.trim(),
      width
    ),
    padLine(
      `cwd ${status.cwd}  session root ${status.sessionRoot}  mode ${status.conversationMode}`,
      width
    )
  ];
}

function renderFooter(
  state: InteractiveUiState,
  width: number,
  transientHint?: string
): string[] {
  const baseHint =
    transientHint ??
    `${INTERACTIVE_TUI_KEY_HINT} | ${INTERACTIVE_COMMAND_HINT}`;
  const statusHint =
    state.notification?.message ??
    state.lastError?.message ??
    state.status.nextActionHint ??
    "TTY mode uses the shared interactive coordinator service.";

  return [padLine(baseHint, width), padLine(statusHint, width)];
}

function renderSplitMain(
  state: InteractiveUiState,
  width: number,
  height: number
): string[] {
  const rightWidth = Math.max(30, Math.floor(width * 0.34));
  const leftWidth = width - rightWidth - 1;
  const transcriptPanel = renderPanel(
    "Transcript",
    renderTranscript(state, leftWidth - 2),
    leftWidth,
    height
  );
  const activityPanel = renderPanel(
    "Activity",
    renderActivity(state, rightWidth - 2),
    rightWidth,
    height
  );

  return transcriptPanel.map((line, index) => {
    const right = activityPanel[index] ?? " ".repeat(rightWidth);
    return `${line} ${right}`;
  });
}

function renderStackedMain(
  state: InteractiveUiState,
  width: number,
  height: number
): string[] {
  const transcriptHeight = Math.max(6, Math.floor(height * 0.65));
  const activityHeight = Math.max(4, height - transcriptHeight);
  return [
    ...renderPanel("Transcript", renderTranscript(state, width - 2), width, transcriptHeight),
    ...renderPanel("Activity", renderActivity(state, width - 2), width, activityHeight)
  ];
}

function renderTranscript(state: InteractiveUiState, width: number): string[] {
  const lines: string[] = [];
  for (const entry of state.conversation) {
    const label = conversationLabel(entry.kind);
    lines.push(...wrapBlock(`[${label}] ${renderConversationEntry(entry)}`, width));
    lines.push("");
  }

  if (state.liveStream?.text) {
    lines.push(...wrapBlock(`[Live ${state.liveStream.role}] ${state.liveStream.text}`, width));
    lines.push("");
  }

  if (lines.length === 0) {
    lines.push("No transcript yet. Send a message or use a slash command.");
  }

  return lines;
}

function renderActivity(state: InteractiveUiState, width: number): string[] {
  const lines: string[] = [];
  const active = state.activity.active;
  if (active) {
    lines.push(`Now: ${active.label}${active.target ? ` ${active.target}` : ""}`);
    if (active.reason) {
      lines.push(...wrapBlock(`Why: ${active.reason}`, width));
    }
    lines.push("");
  }

  if (state.pendingPlan) {
    lines.push(...wrapBlock(renderPendingPlan(state.pendingPlan.plan, state.pendingPlan.nextActionHint), width));
    lines.push("");
  }

  for (const runtime of state.status.runtimes) {
    lines.push(`Agent ${runtime.role}: ${runtime.modelDisplay}`);
    lines.push(`  session ${runtime.sessionId}`);
    lines.push(`  health ${runtime.healthy ? "ok" : "down"}`);
    if (runtime.currentActivity) {
      lines.push(...wrapBlock(`  ${runtime.currentActivity}`, width));
    }
    if (runtime.currentReason) {
      lines.push(...wrapBlock(`  reason ${runtime.currentReason}`, width));
    }
    lines.push("");
  }

  if (lines.length === 0) {
    lines.push("No active workflow state.");
  }

  return lines;
}

function renderPanel(
  title: string,
  bodyLines: string[],
  width: number,
  height: number
): string[] {
  if (width < 4 || height < 3) {
    return normalizeScreen(bodyLines, width, height);
  }

  const innerWidth = width - 2;
  const header = truncateToWidth(` ${title} `, innerWidth, "...", true);
  const visibleBody = bodyLines.slice(Math.max(0, bodyLines.length - Math.max(1, height - 2)));
  const lines = [
    `+${header}+`,
    ...visibleBody.map((line) => `|${padLine(line, innerWidth)}|`)
  ];

  while (lines.length < height - 1) {
    lines.push(`|${" ".repeat(innerWidth)}|`);
  }
  lines.push(`+${"-".repeat(innerWidth)}+`);
  return lines.slice(0, height);
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

  const modalWidth = Math.max(40, Math.min(width - 8, Math.floor(width * 0.7)));
  const modalHeight = Math.max(8, Math.min(height - 4, Math.floor(height * 0.7)));
  const innerWidth = Math.max(10, modalWidth - 2);
  const wrapped = wrapBlock(modal.content, innerWidth);
  const bodyHeight = Math.max(1, modalHeight - 3);
  const maxOffset = Math.max(0, wrapped.length - bodyHeight);
  const clampedOffset = Math.max(0, Math.min(scrollOffset, maxOffset));
  const body = wrapped.slice(clampedOffset, clampedOffset + bodyHeight);
  const footerText =
    maxOffset > 0
      ? `Scroll ${clampedOffset + 1}-${Math.min(wrapped.length, clampedOffset + body.length)} of ${wrapped.length} | Up/Down PgUp/PgDn Home/End | Esc close`
      : "Esc close";
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

  const modalWidth = Math.max(40, Math.min(width - 8, Math.floor(width * 0.7)));
  const modalHeight = Math.max(8, Math.min(height - 4, Math.floor(height * 0.7)));
  const innerWidth = Math.max(10, modalWidth - 2);
  const bodyHeight = Math.max(1, modalHeight - 3);
  const wrapped = wrapBlock(modal.content, innerWidth);
  return Math.max(0, wrapped.length - bodyHeight);
}

function widthSafePageSize(rows: number): number {
  return Math.max(3, Math.floor(rows * 0.3));
}

function overlayModal(baseLines: string[], modalLines: string[]): string[] {
  if (modalLines.length === 0 || baseLines.length === 0) {
    return baseLines;
  }

  const width = visibleWidth(baseLines[0] ?? "");
  const overlayWidth = visibleWidth(modalLines[0] ?? "");
  const rowOffset = Math.max(0, Math.floor((baseLines.length - modalLines.length) / 2));
  const colOffset = Math.max(0, Math.floor((width - overlayWidth) / 2));
  const next = [...baseLines];

  for (let row = 0; row < modalLines.length; row += 1) {
    const baseRow = rowOffset + row;
    if (baseRow >= next.length) {
      break;
    }
    const prefix = next[baseRow]?.slice(0, colOffset) ?? "";
    const suffixWidth = Math.max(0, width - colOffset - overlayWidth);
    next[baseRow] = `${padLine(prefix, colOffset)}${padLine(modalLines[row] ?? "", overlayWidth)}${" ".repeat(suffixWidth)}`;
  }

  return next;
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

  return text
    .split("\n")
    .flatMap((line) => {
      const wrapped = wrapTextWithAnsi(line, width);
      return wrapped.length > 0 ? wrapped : [""];
    });
}

function padLine(text: string, width: number): string {
  return truncateToWidth(text, width, "...", true);
}

function conversationLabel(kind: InteractiveUiState["conversation"][number]["kind"]): string {
  switch (kind) {
    case "operator_message":
      return "Operator";
    case "assistant_planning_response":
      return "Agent A";
    case "workflow_summary":
      return "Workflow";
    case "plan_ready":
      return "Plan";
    case "approval_discard":
      return "System";
    case "runtime_session":
      return "Runtime";
    case "error":
      return "Error";
  }
}
