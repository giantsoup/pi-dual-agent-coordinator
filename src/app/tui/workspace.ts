import { bindingMatches, browsingInput, inspectorTabs } from "./bindings.js";
import { Key, matchesKey, visibleWidth, truncateToWidth, wrapTextWithAnsi, Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";
import type { InteractiveCoordinatorService } from "../interactive/service.js";
import type { InteractiveUiState } from "../../types/ui.js";
import type { HistoryDetail, HistoryRecord, TranscriptBlock } from "../../types/history.js";
import { roleLabel } from "../../types/history.js";
import { safeDisplayText, visibleProse } from "../../security/display-text.js";
import { compareTranscriptTime } from "../interactive/transcript.js";

export type WorkspaceFocus = "editor" | "transcript" | "history" | "activity" | "inspector";
type HistoryTurn = Extract<HistoryRecord, { kind: "turn" }>;
type HistoryTarget = { kind: "live" } | { kind: "turn"; id: HistoryTurn["id"] };
type HistoryPane = { kind: "closed" } | { kind: "open"; candidate: HistoryTarget; origin: "editor" | "transcript" | "activity"; start: number; unavailable: boolean };
type InspectorState = { id: string; section: HistoryDetail["section"]; offset: number; visualOffset: number; jumpToEnd: boolean; wrapWidth: number; detail?: HistoryDetail | undefined; loading: boolean; generation: number; origin: WorkspaceFocus };
const plain = (text: string) => text;
const theme: MarkdownTheme = { heading: (text) => `\x1b[1m${text}\x1b[22m`, link: plain, linkUrl: plain, code: plain, codeBlock: plain, codeBlockBorder: plain, quote: plain, quoteBorder: plain, hr: plain, listBullet: plain, bold: plain, italic: plain, strikethrough: plain, underline: plain };
const pad = (text: string, width: number) => truncateToWidth(text.replace(/[\r\n\t]/g, " "), Math.max(0, width), "…", true);
function wrap(text: string, width: number): string[] { return safeDisplayText(text).split("\n").flatMap((line) => wrapTextWithAnsi(line, Math.max(1, width))); }
function useColor(): boolean { return process.env.NO_COLOR === undefined && process.env.TERM !== "dumb"; }
function paintDefault(text: string): string { return useColor() ? `\x1b[39;49m${text}\x1b[0m` : text; }
export function paintRole(text: string, role?: "A" | "B"): string {
  if (!useColor() || !role) return text;
  // Standard cyan/amber accents use the terminal's background, as does the prose.
  return `\x1b[${role === "A" ? "36" : "33"};49m${text}\x1b[0m`;
}
export function liveIdentity(state: InteractiveUiState): { text: string; role?: "A" | "B"; phase: string } {
  if (state.operation.kind === "cancelling") return { text: "Cancelling", phase: "Waiting for runtime cleanup" };
  if (state.operation.kind !== "running") {
    const current = state.history.records.find((record) => record.id === state.history.currentTurnId);
    return { text: state.pendingPlan ? "Waiting for approval" : "Idle", phase: (state.pendingPlan ? "Plan ready" : state.operation.kind === "idle" ? current?.outcome.kind ?? "idle" : state.operation.kind).replaceAll("_", " ") };
  }
  const currentRun = [...state.history.records].reverse().find((record) => record.kind === "run" && record.outcome.kind === "running" && record.parentId === state.history.currentTurnId);
  if (currentRun?.kind === "run") return { text: `Active: ${roleLabel(currentRun.role)}`, role: currentRun.role, phase: currentRun.phase };
  return { text: "Working", phase: state.status.phaseLabel };
}
function children(records: HistoryRecord[], id: string): HistoryRecord[] { return records.filter((record) => record.kind !== "turn" && record.parentId === id); }
export function recordSummary(record: HistoryRecord, records: HistoryRecord[]): string {
  const runs = record.kind === "turn" ? children(records, record.id) : [];
  const tools = record.kind === "turn" ? runs.flatMap((run) => children(records, run.id)) : children(records, record.id);
  const failures = [...runs, ...tools].filter((item) => item.outcome.kind === "failed").length;
  const label = record.kind === "turn" ? `${tools.length} calls / ${runs.length} runs` : record.kind === "run" ? `${tools.length} calls` : "";
  return `${failures ? `! ${failures} failed / ` : ""}${label}`;
}
export function toolGroupSummary(calls: Extract<HistoryRecord, { kind: "tool" }>[]): string {
  const count = calls.length;
  const states = ["failed", "timed_out", "cancelled", "interrupted", "running"] as const;
  const outcomes = states.flatMap((kind) => {
    const total = calls.filter((call) => call.outcome.kind === kind).length;
    return total ? [`${total} ${kind.replaceAll("_", " ")}`] : [];
  });
  const completed = calls.filter((call) => call.outcome.kind === "completed").length;
  if (completed && calls.some((call) => call.outcome.kind === "running")) outcomes.push(`${completed} done`);
  if (!outcomes.length && calls.every((call) => call.toolName === "bash")) return `Ran ${count} command${count === 1 ? "" : "s"}`;
  const categories = new Map<string, number>();
  for (const call of calls) {
    const category = call.toolName === "bash" ? "command" : call.toolName === "grep" || call.toolName === "find" ? "search" : call.toolName === "ls" ? "listing" : ["read", "edit", "write"].includes(call.toolName) ? call.toolName : "other";
    categories.set(category, (categories.get(category) ?? 0) + 1);
  }
  return [`${count} tool call${count === 1 ? "" : "s"}`, ...outcomes, ...[...categories].map(([name, total]) => `${total} ${name}${total === 1 || name === "other" ? "" : name === "search" ? "es" : "s"}`)].join(" · ");
}

/** Presentation only: IDs, folds, focus and bounded detail ranges. Never binds runtimes. */
export class CurrentWorkspace {
  public focus: WorkspaceFocus = "editor";
  private history: HistoryPane = { kind: "closed" };
  public get historyVisible(): boolean { return this.history.kind === "open"; }
  public inspector: InspectorState | undefined;
  private workspaceSelection: string | undefined;
  private viewedTurnId: string | undefined;
  private readonly expanded = new Set<string>();
  private readonly expandedRuns = new Set<string>();
  private readonly collapsedTurns = new Set<string>();
  private following = true;
  private readRevision = 0;
  private unread = 0;
  private streamAtRead: { key: string; length: number } | undefined;
  private generation = 0;
  private resetId: string | undefined;
  private height = 10;
  private width = 80;
  private viewportStart = 0;
  private viewportHeight = 1;
  private viewportTotal = 0;
  private manualScroll = false;
  private scrollAnchor: { id: string; offset: number } | undefined;
  private displayedBlocks: TranscriptBlock[] = [];
  private pausedBlocks: TranscriptBlock[] | undefined;
  private readonly clocks = new Map<string, { start: number; elapsed: number }>();
  private readonly proseCache = new Map<string, { width: number; content: string; lines: string[] }>();
  private transcriptLoadKey: string | undefined;
  public constructor(private readonly service: InteractiveCoordinatorService, private readonly requestRender: () => void) {}

  public close(): boolean {
    if (this.inspector) { this.focus = this.inspector.origin; this.inspector = undefined; this.generation++; return true; }
    if (this.history.kind === "open") { this.focus = this.history.origin; this.history = { kind: "closed" }; return true; }
    return false;
  }
  public get context(): string { return this.inspector ? `inspector / ${this.inspector.section}` : this.historyVisible ? "history" : this.focus === "transcript" ? "workspace records" : this.focus; }
  public cycle(direction: 1 | -1, activity: boolean): void {
    if (this.historyVisible) return;
    const order: WorkspaceFocus[] = this.inspector ? ["editor", "inspector", ...(activity ? ["activity" as const] : [])]
      : activity ? ["editor", "transcript", "activity"] : ["editor", "transcript"];
    this.focus = order[(order.indexOf(this.focus) + direction + order.length) % order.length] ?? "editor";
  }
  private closeInspector(): void { this.inspector = undefined; this.generation++; }
  public focusWorkspace(): void {
    this.closeInspector();
    this.close();
    this.focus = "transcript";
  }
  public openHistory(state: InteractiveUiState): void {
    this.syncState(state);
    if (this.historyVisible || this.inspector) return;
    const origin = this.focus === "transcript" || this.focus === "activity" ? this.focus : "editor";
    this.generation++;
    this.history = { kind: "open", candidate: this.viewedTurnId && this.viewedTurnId !== state.history.currentTurnId
      ? { kind: "turn", id: this.viewedTurnId } : { kind: "live" }, origin, start: 0, unavailable: false };
    this.focus = "history";
  }
  public followLatest(state: InteractiveUiState): void {
    this.closeInspector();
    if (this.historyVisible) { this.close(); this.focus = "transcript"; }
    this.current(state);
  }
  private rows(state: InteractiveUiState): HistoryRecord[] {
    const records = state.history.records;
    const turnId = this.viewedTurnId ?? state.history.currentTurnId;
    if (turnId && this.collapsedTurns.has(turnId)) return [];
    const runs = new Set(children(records, turnId ?? "").map((run) => run.id));
    // Insertion order follows events, including B resuming after an A check-in.
    return records.filter((record) => record.kind === "run" ? runs.has(record.id)
      : record.kind === "tool" && runs.has(record.parentId) && this.expandedRuns.has(record.parentId));
  }
  private select(records: HistoryRecord[], id: string | undefined): HistoryRecord | undefined { return records.find((record) => record.id === id) ?? records.at(-1); }
  private current(state: InteractiveUiState): void {
    this.following = true; this.unread = 0; this.readRevision = state.history.revision;
    this.manualScroll = false;
    this.pausedBlocks = undefined; this.scrollAnchor = undefined;
    this.viewedTurnId = undefined; this.history = { kind: "closed" };
    this.captureRead(state);
    this.workspaceSelection = this.rows(state).at(-1)?.id ?? state.history.currentTurnId;
  }
  private captureRead(state: InteractiveUiState): void {
    this.readRevision = state.history.revision;
    const stream = state.liveStream;
    this.streamAtRead = stream ? { key: `${stream.role}:${stream.sessionId}:${stream.startedAt}`, length: stream.text.length } : undefined;
  }
  private browse(state: InteractiveUiState): void {
    if (this.following) {
      if (!this.historyVisible) this.captureRead(state);
      this.following = false; this.viewedTurnId = state.history.currentTurnId;
    }
  }
  public scroll(lines: number, state: InteractiveUiState): void {
    if (this.inspector) {
      for (let i = 0; i < Math.abs(lines); i++) this.inspectorInput(lines < 0 ? "\x1b[A" : "\x1b[B");
      return;
    }
    if (this.historyVisible) { this.moveHistory(lines, state); return; }
    this.browse(state);
    if (!this.manualScroll) this.pausedBlocks = this.displayedBlocks;
    this.manualScroll = true;
    this.scrollAnchor = undefined;
    this.viewportStart = Math.max(0, Math.min(Math.max(0, this.viewportTotal - this.viewportHeight), this.viewportStart + lines));
  }
  public scrollInput(data: string, state: InteractiveUiState): boolean {
    if (this.historyVisible || this.inspector) return false;
    if (bindingMatches(data, "scrollUp")) this.scroll(-this.viewportHeight, state);
    else if (bindingMatches(data, "scrollDown")) this.scroll(this.viewportHeight, state);
    else if (bindingMatches(data, "scrollLineUp")) this.scroll(-1, state);
    else if (bindingMatches(data, "scrollLineDown")) this.scroll(1, state);
    else if (!this.following && bindingMatches(data, "latest")) this.current(state);
    else return false;
    return true;
  }
  public handleInput(data: string, state: InteractiveUiState): boolean {
    this.syncState(state);
    if (this.historyVisible) return this.historyInput(data, state);
    data = browsingInput(data);
    if (this.inspector && this.focus === "inspector") return this.inspectorInput(data);
    if (this.focus !== "transcript") return false;
    if (this.scrollInput(data, state)) return true;
    if (bindingMatches(data, "latest")) { this.current(state); return true; }
    const records = this.rows(state);
    const selected = this.workspaceSelection === (this.viewedTurnId ?? state.history.currentTurnId)
      ? state.history.records.find((record) => record.id === this.workspaceSelection) : this.select(records, this.workspaceSelection);
    if (!selected) return true;
    this.workspaceSelection = selected.id;
    const index = records.indexOf(selected);
    let next = index;
    if (matchesKey(data, Key.up)) next--;
    else if (matchesKey(data, Key.down)) next++;
    else if (matchesKey(data, Key.home)) next = 0;
    else if (bindingMatches(data, "inspect")) { this.browse(state); this.inspect(selected.id); return true; }
    else if (bindingMatches(data, "fold") || bindingMatches(data, "expand")) {
      this.manualScroll = false;
      if (selected.kind === "turn") {
        if (bindingMatches(data, "fold") && !this.collapsedTurns.has(selected.id)) this.collapsedTurns.add(selected.id); else this.collapsedTurns.delete(selected.id);
      } else if (selected.kind === "run") {
        if (bindingMatches(data, "fold") && this.expandedRuns.has(selected.id)) this.expandedRuns.delete(selected.id); else this.expandedRuns.add(selected.id);
      } else if (bindingMatches(data, "fold") && this.expanded.has(selected.id)) this.expanded.delete(selected.id); else this.expanded.add(selected.id);
      this.browse(state); return true;
    } else if (bindingMatches(data, "collapse")) {
      this.manualScroll = false;
      if (selected.kind === "turn") this.collapsedTurns.add(selected.id);
      else if (selected.kind === "run" && this.expandedRuns.has(selected.id)) this.expandedRuns.delete(selected.id);
      else if (!this.expanded.delete(selected.id)) this.workspaceSelection = selected.parentId;
      this.browse(state); return true;
    } else return true;
    const target = records[Math.max(0, Math.min(records.length - 1, next))];
    if (target) {
      this.browse(state);
      this.manualScroll = false;
      this.workspaceSelection = target.id;
    }
    return true;
  }
  private historyTurns(state: InteractiveUiState): HistoryTurn[] {
    return state.history.records.filter((record): record is HistoryTurn => record.kind === "turn" && record.id !== state.history.currentTurnId);
  }
  private historyIndex(state: InteractiveUiState): number {
    const pane = this.history;
    if (pane.kind === "closed") return 0;
    const turns = this.historyTurns(state);
    const candidate = pane.candidate;
    return candidate.kind === "live" ? turns.length : turns.findIndex((turn) => turn.id === candidate.id);
  }
  private historyPageSize(): number { return Math.max(1, Math.floor((this.height - 5) / 3)); }
  private moveHistory(lines: number, state: InteractiveUiState): void {
    if (this.history.kind === "closed") return;
    const turns = this.historyTurns(state);
    const index = Math.max(0, Math.min(turns.length, this.historyIndex(state) + lines));
    const turn = turns[index];
    this.history.candidate = turn ? { kind: "turn", id: turn.id } : { kind: "live" };
    this.history.unavailable = false;
  }
  private historyInput(data: string, state: InteractiveUiState): boolean {
    if (matchesKey(data, Key.escape) || bindingMatches(data, "history")) { this.close(); return true; }
    if (matchesKey(data, "l")) { this.followLatest(state); return true; }
    data = browsingInput(data);
    if (bindingMatches(data, "inspect")) this.chooseHistory(state);
    else if (matchesKey(data, Key.up)) this.moveHistory(-1, state);
    else if (matchesKey(data, Key.down)) this.moveHistory(1, state);
    else if (matchesKey(data, Key.pageUp)) this.moveHistory(-this.historyPageSize(), state);
    else if (matchesKey(data, Key.pageDown)) this.moveHistory(this.historyPageSize(), state);
    else if (matchesKey(data, Key.home)) this.moveHistory(-Infinity, state);
    else if (matchesKey(data, Key.end)) this.moveHistory(Infinity, state);
    return true;
  }
  private chooseHistory(state: InteractiveUiState): void {
    const pane = this.history;
    if (pane.kind === "closed") return;
    const candidate = pane.candidate;
    if (candidate.kind === "turn" && !this.historyTurns(state).some((turn) => turn.id === candidate.id)) {
      pane.candidate = { kind: "live" }; pane.unavailable = true;
      return;
    }
    this.closeInspector();
    if (candidate.kind === "live") this.current(state);
    else {
      this.browse(state);
      this.viewedTurnId = candidate.id;
      this.manualScroll = false; this.viewportStart = 0; this.scrollAnchor = undefined;
      this.pausedBlocks = undefined; this.displayedBlocks = [];
      this.workspaceSelection = this.rows(state)[0]?.id ?? candidate.id;
      this.history = { kind: "closed" };
    }
    this.focus = "transcript";
  }
  public inspect(id: string): void {
    this.inspector = { id, section: "summary", offset: 0, visualOffset: 0, jumpToEnd: false, wrapWidth: this.width - 2, loading: true, generation: ++this.generation, origin: this.focus };
    this.focus = "inspector";
    void this.loadDetail();
  }
  private async loadDetail(): Promise<void> {
    const view = this.inspector;
    if (!view) return;
    const generation = ++this.generation; view.generation = generation; view.loading = true;
    try {
      const detail = await this.service.loadHistoryDetail?.(view.id, view.section, view.offset, 120);
      if (this.inspector === view && generation === this.generation) {
        view.detail = detail; view.offset = detail?.offset ?? view.offset; view.loading = false;
        if (view.jumpToEnd && detail) {
          view.jumpToEnd = false; view.offset = Math.max(0, detail.totalLines - 120); view.visualOffset = Number.MAX_SAFE_INTEGER;
          if (view.offset !== detail.offset) { view.detail = undefined; void this.loadDetail(); }
        }
      }
    } catch (error) {
      if (this.inspector === view && generation === this.generation) { view.detail = { recordId: view.id, section: view.section, offset: 0, lines: [], totalLines: 0, reason: safeDisplayText(error instanceof Error ? error.message : "Detail unavailable") }; view.loading = false; }
    }
    this.requestRender();
  }
  private inspectorInput(data: string): boolean {
    const view = this.inspector;
    if (!view) return false;
    const tab = inspectorTabs.find((tab) => tab.key === data)?.section;
    if (tab) { view.section = tab; view.offset = 0; view.visualOffset = 0; view.detail = undefined; void this.loadDetail(); return true; }
    const page = Math.max(1, this.height - 9);
    const wrapped = view.detail?.lines.flatMap((line) => wrap(line, this.width - 2)) ?? [];
    let next = view.visualOffset;
    if (matchesKey(data, Key.up)) next--;
    else if (matchesKey(data, Key.down)) next++;
    else if (matchesKey(data, Key.pageUp)) next -= page;
    else if (matchesKey(data, Key.pageDown)) next += page;
    else if (matchesKey(data, Key.home)) { view.offset = 0; view.visualOffset = 0; view.detail = undefined; void this.loadDetail(); return true; }
    else if (matchesKey(data, Key.end)) { if (!view.detail) { view.jumpToEnd = true; return true; } view.offset = Math.max(0, (view.detail?.totalLines ?? 1) - 120); view.visualOffset = Number.MAX_SAFE_INTEGER; view.detail = undefined; void this.loadDetail(); return true; }
    else return true;
    if (next >= wrapped.length && view.detail && view.offset + view.detail.lines.length < view.detail.totalLines) {
      view.offset += view.detail.lines.length; view.visualOffset = 0; view.detail = undefined; void this.loadDetail();
    } else if (next < 0 && view.offset > 0) {
      view.offset = Math.max(0, view.offset - 120); view.visualOffset = Number.MAX_SAFE_INTEGER; view.detail = undefined; void this.loadDetail();
    } else view.visualOffset = Math.max(0, Math.min(Math.max(0, wrapped.length - 1), next));
    return true;
  }
  private duration(record: HistoryRecord): string {
    if (record.outcome.kind === "interrupted" && record.outcome.endedAt === null) return "duration unknown";
    if (record.outcome.kind !== "running") return `${Math.max(0, Math.round((Date.parse(record.outcome.endedAt ?? record.timestamp) - Date.parse(record.timestamp)) / 1000))}s`;
    let clock = this.clocks.get(record.id);
    if (!clock) { clock = { start: performance.now(), elapsed: Math.max(0, Date.now() - Date.parse(record.timestamp)) }; this.clocks.set(record.id, clock); }
    return `${Math.floor((clock.elapsed + performance.now() - clock.start) / 1000)}s elapsed`;
  }
  public syncState(state: InteractiveUiState): void {
    if (state.history.resetId === this.resetId) return;
    this.resetId = state.history.resetId;
    this.closeInspector();
    this.focus = "editor";
    this.current(state);
  }
  public render(state: InteractiveUiState, width: number, height: number): string[] {
    this.height = height; this.width = width;
    this.syncState(state);
    if (!this.following || this.historyVisible || this.inspector || state.modal.kind !== "none") {
      const stream = state.liveStream;
      const newProse = stream && (this.streamAtRead?.key !== `${stream.role}:${stream.sessionId}:${stream.startedAt}` || stream.text.length > this.streamAtRead.length) ? 1 : 0;
      this.unread = Math.max(this.unread, state.history.revision - this.readRevision + newProse);
    } else { this.captureRead(state); this.unread = 0; }
    if (this.inspector) return this.renderInspector(state, width, height);
    if (this.historyVisible) return this.renderHistoryPane(state, width, height);
    const turns = state.history.records.filter((record) => record.kind === "turn");
    const current = state.history.records.find((record) => record.id === (this.viewedTurnId ?? state.history.currentTurnId));
    const viewingCurrent = !this.viewedTurnId || this.viewedTurnId === state.history.currentTurnId;
    const live = liveIdentity(state);
    const turnNumber = current ? turns.findIndex((turn) => turn.id === current.id) + 1 : undefined;
    const title = `${viewingCurrent ? "CURRENT REQUEST" : "HISTORY REQUEST"}${turnNumber ? ` ${turnNumber}` : ""} | ${viewingCurrent ? live.phase : current?.outcome.kind ?? "unavailable"}${this.focus === "transcript" ? " [focus]" : ""}`;
    const bodyWidth = Math.max(1, width - 4);
    const rows = this.rows(state);
    if (this.following) this.workspaceSelection = rows.at(-1)?.id ?? current?.id;
    const selected = this.workspaceSelection === current?.id ? current : this.select(rows, this.workspaceSelection);
    const progress = current?.kind === "turn" ? current.execution : undefined;
    const checkIn = progress?.checkIn;
    const checkStopped = current?.outcome.kind !== "running" && (checkIn?.kind === "scheduled" || checkIn?.kind === "checking");
    const checkLabel = checkStopped ? "checks stopped" : checkIn?.kind === "scheduled" ? `A check at ${checkIn.afterTurn}`
      : checkIn?.kind === "checking" ? `A checking turn ${checkIn.afterTurn}`
      : checkIn?.kind === "final_review" ? "final review" : "check stopped";
    const progressLine = progress ? `B turns: ${progress.completedTurns} successful / ${checkLabel}` : undefined;
    const response = current?.kind === "turn" ? current.responseProgress : undefined;
    const statusLines = [
      ...(response && response.attempt > 1 ? [response.label, ...(response.state !== "succeeded" && response.reason ? [response.reason] : [])] : []),
      ...(progressLine ? [progressLine] : []),
      `\x1b[1;4m>> ${viewingCurrent ? live.phase.toUpperCase() : selected?.title ?? "Retained records"} / ${viewingCurrent ? state.pendingPlan ? "waiting approval" : state.operation.kind === "running" || state.operation.kind === "cancelling" ? state.operation.kind : current?.outcome.kind ?? state.operation.kind : current?.outcome.kind}\x1b[0m`
    ];
    const heading = [current && this.workspaceSelection === current.id ? `> Operator turn: ${current.title} / ${recordSummary(current, state.history.records)}` : current?.title ?? (state.history.resetId ? "New conversation. Send a request to Agent A." : "Send a request to Agent A, or use /help."), ""];
    const contentBudget = Math.max(0, height - 3 - statusLines.length - heading.length);
    const body: (string | HistoryRecord)[] = [];
    const recordSpans: { id: string; start: number; end: number }[] = [];
    let selectedLine = 0;
    const latestRun = children(state.history.records, current?.id ?? "").at(-1);
    const loadKey = `${state.history.resetId}:${current?.id}:${state.history.revision}`;
    if (current && loadKey !== this.transcriptLoadKey) {
      this.transcriptLoadKey = loadKey;
      void this.service.loadTranscript?.(current.id).then(() => {
        if (this.transcriptLoadKey === loadKey) this.requestRender();
      }).catch(() => {});
    }
    let blocks = current ? this.service.getTranscript?.(current.id) ?? [] : [];
    if (viewingCurrent && state.liveStream && latestRun?.kind === "run" && !blocks.some((block) => block.runId === latestRun.id && block.kind === "response")) {
      const text = visibleProse(state.liveStream.text);
      if (text) blocks = [...blocks, { kind: "response", id: `${latestRun.id}:stream`, runId: latestRun.id, timestamp: "~", sequence: Number.MAX_SAFE_INTEGER, text }];
    }
    if (this.manualScroll && this.pausedBlocks) blocks = this.pausedBlocks;
    this.displayedBlocks = blocks;
    const turnRuns = state.history.records.filter((record): record is Extract<HistoryRecord, { kind: "run" }> => record.kind === "run" && record.parentId === current?.id);
    const timeline = [
      ...turnRuns.map((run) => ({ kind: "heading" as const, id: run.id, runId: run.id, timestamp: run.timestamp, sequence: run.sequence })),
      ...blocks
    ].sort(compareTranscriptTime);
    const addRecord = (record: HistoryRecord) => {
      if (selected?.id === record.id) selectedLine = body.length;
      const start = body.length;
      body.push(record);
      if (this.expanded.has(record.id) && record.kind === "tool") body.push(...wrap(record.preview ? `Preview (up to 120 chars): ${record.preview}` : "Preview unavailable; Enter inspects retained output.", bodyWidth).slice(0, 2));
      recordSpans.push({ id: record.id, start, end: body.length });
    };
    let previousRunId: string | undefined;
    if (!current || !this.collapsedTurns.has(current.id)) for (const block of timeline) {
      const run = turnRuns.find((record) => record.id === block.runId);
      if (!run) continue;
      if (block.kind === "heading") { addRecord(run); previousRunId = run.id; continue; }
      const start = body.length;
      if (previousRunId !== run.id) body.push("", paintRole(`${roleLabel(run.role)} | ${run.phase} continued`, run.role));
      previousRunId = run.id;
      if (block.kind === "response") {
        const bounded = block.text.slice(-24000);
        const cached = this.proseCache.get(block.id);
        const lines = cached?.width === bodyWidth && cached.content === bounded ? cached.lines : new Markdown(bounded, 0, 0, theme).render(bodyWidth);
        this.proseCache.set(block.id, { width: bodyWidth, content: bounded, lines });
        body.push("", ...lines, ...(bounded !== block.text ? ["Recent response preview; Enter on run for full output."] : []), "");
      } else {
        const calls = state.history.records.filter((record): record is Extract<HistoryRecord, { kind: "tool" }> => record.kind === "tool" && block.callIds.includes(record.id));
        if (calls.length) body.push(paintRole(pad(`  ${this.expandedRuns.has(run.id) ? "-" : "+"} ${toolGroupSummary(calls)}`, bodyWidth), run.role));
        if (this.expandedRuns.has(run.id)) calls.forEach(addRecord);
      }
      recordSpans.push({ id: block.id, start, end: body.length });
    }
    for (const key of this.proseCache.keys()) if (!blocks.some((block) => block.id === key)) this.proseCache.delete(key);
    const maxStart = Math.max(0, body.length - contentBudget);
    this.viewportHeight = Math.max(1, contentBudget);
    this.viewportTotal = body.length;
    if (this.manualScroll && this.scrollAnchor) {
      const anchor = this.scrollAnchor;
      const start = recordSpans.find((span) => span.id === anchor.id)?.start;
      if (start !== undefined) this.viewportStart = start + anchor.offset;
    }
    this.viewportStart = Math.min(maxStart, this.manualScroll ? this.viewportStart : this.following ? maxStart : Math.max(0, selectedLine - Math.floor(contentBudget / 2)));
    if (this.manualScroll) {
      const record = recordSpans.find((span) => span.start <= this.viewportStart && span.end > this.viewportStart);
      this.scrollAnchor = record ? { id: record.id, offset: this.viewportStart - record.start } : undefined;
    }
    const visible = body.slice(this.viewportStart, this.viewportStart + contentBudget).map((row) => {
      if (typeof row === "string") return row;
      const label = `${selected?.id === row.id ? ">" : " "} ${(row.kind === "run" ? this.expandedRuns.has(row.id) : this.expanded.has(row.id)) ? "-" : "+"} ${row.kind === "tool" ? "  " : ""}${row.kind === "turn" ? "" : roleLabel(row.role)} [${row.outcome.kind}] ${row.title} / ${this.duration(row)} ${recordSummary(row, state.history.records)}`;
      return paintRole(pad(label, bodyWidth), row.kind === "turn" ? undefined : row.role);
    });
    while (visible.length < contentBudget) visible.push("");
    const below = Math.max(0, body.length - this.viewportStart - contentBudget);
    const position = `↑ ${this.viewportStart} / ↓ ${below}`;
    visible.push(...statusLines, `${position} | ${this.following ? "Following" : "Paused"} | Wheel scroll | ${!viewingCurrent ? "New prompts use current conversation" : this.focus === "transcript" ? "u/d page | l follow" : "Esc controls"}`);
    const frameRole = live.role ?? (latestRun?.kind === "run" ? latestRun.role : undefined);
    return frame(title, [...heading, ...visible], width, height, viewingCurrent ? frameRole : undefined);
  }
  public pointer(state: InteractiveUiState): string {
    const live = liveIdentity(state);
    const run = [...state.history.records].reverse().find((record) => record.kind === "run" && record.outcome.kind === "running");
    const tool = run ? children(state.history.records, run.id).find((record) => record.outcome.kind === "running") : undefined;
    const activity = state.operation.kind === "running" ? tool ? `${tool.title} / running, no final exit status` : run ? "No tool currently running" : "Preparing next role run" : state.pendingPlan ? "/approve to execute" : `Last result: ${live.phase}`;
    const returnHint = state.modal.kind !== "none" || this.inspector ? "Esc back" : this.historyVisible ? "l current" : "Esc then l current";
    const unread = this.unread ? ` | ${this.unread} unread, ${returnHint}` : "";
    return `${live.text} / ${live.phase}${unread}${run && state.operation.kind === "running" ? ` / ${this.duration(run)}` : ""} / ${activity}`;
  }
  private renderHistoryPane(state: InteractiveUiState, width: number, height: number): string[] {
    const pane = this.history;
    if (pane.kind === "closed") return [];
    const turns = this.historyTurns(state);
    const index = this.historyIndex(state);
    const selected = index < 0 ? turns.length : index;
    const budget = this.historyPageSize();
    pane.start = Math.max(0, Math.min(pane.start, turns.length + 1 - budget));
    if (selected < pane.start) pane.start = selected;
    if (selected >= pane.start + budget) pane.start = selected - budget + 1;
    const allTurns = state.history.records.filter((record) => record.kind === "turn");
    const current = allTurns.find((turn) => turn.id === state.history.currentTurnId);
    const rows: string[] = [];
    for (let i = pane.start; i < Math.min(turns.length + 1, pane.start + budget); i++) {
      const turn = turns[i];
      rows.push(`${i === selected ? ">" : " "} ${turn ? `Request ${allTurns.indexOf(turn) + 1} [${turn.outcome.kind}]` : current ? `Current request [${current.outcome.kind}]` : "Current conversation · empty"}`,
        `  ${safeDisplayText(turn?.title ?? current?.title ?? "Return to live output")}`,
        `  ${turn ? recordSummary(turn, state.history.records) : "Live output · new prompts continue here"}`);
    }
    while (rows.length < budget * 3) rows.push("");
    rows.push(index < 0 || pane.unavailable ? "Request unavailable. Choose again; Enter confirms Current." : state.history.warnings[0] ?? "Selection changes the display only.",
      `${selected + 1}/${turns.length + 1} | Arrows/u/d/g/End highlight | Enter choose | l current`);
    return frame("Request history | Esc/F4 back | h help", rows, width, height);
  }
  private renderInspector(state: InteractiveUiState, width: number, height: number): string[] {
    const view = this.inspector;
    if (!view) return [];
    const record = state.history.records.find((item) => item.id === view.id);
    const role = record && record.kind !== "turn" ? record.role : undefined;
    const breadcrumb = `${role ? roleLabel(role) + " / " : ""}${record?.kind ?? "record"} / ${record?.title ?? view.id}`;
    const detail = view.detail;
    const innerWidth = Math.max(1, width - 2);
    if (detail && view.wrapWidth !== innerWidth && view.visualOffset !== Number.MAX_SAFE_INTEGER) {
      let remaining = view.visualOffset;
      let sourceIndex = 0;
      let cells = 0;
      for (const [index, line] of detail.lines.entries()) {
        const oldRows = wrap(line, view.wrapWidth);
        if (remaining < oldRows.length) { sourceIndex = index; cells = oldRows.slice(0, remaining).reduce((total, row) => total + visibleWidth(row), 0); break; }
        remaining -= oldRows.length;
      }
      const prefixRows = detail.lines.slice(0, sourceIndex).reduce((total, line) => total + wrap(line, innerWidth).length, 0);
      let rowIndex = 0;
      for (const row of wrap(detail.lines[sourceIndex] ?? "", innerWidth)) {
        if (cells < visibleWidth(row)) break;
        cells -= visibleWidth(row); rowIndex++;
      }
      view.visualOffset = prefixRows + rowIndex;
    }
    view.wrapWidth = innerWidth;
    const wrapped = detail?.lines.flatMap((line) => wrap(line, width - 2)) ?? [];
    if (detail) view.visualOffset = Math.min(view.visualOffset, Math.max(0, wrapped.length - Math.max(1, height - 9)));
    let sourceLine = view.offset;
    let remainingRows = view.visualOffset;
    for (const line of detail?.lines ?? []) {
      const count = wrap(line, innerWidth).length;
      if (remainingRows < count) break;
      remainingRows -= count; sourceLine++;
    }
    const body = [pad(breadcrumb, width - 2), pad(inspectorTabs.map((tab) => `${tab.key} ${tab.label}`).join(" | "), width - 2),
      pad(`${view.section} / ${record?.outcome.kind ?? "unknown"} / line ${sourceLine + 1} of ${detail?.totalLines ?? "?"}`, width - 2),
      ...(detail?.reason ? wrap(detail.reason, width - 2).slice(0, 3) : []),
      ...(view.loading && !detail ? ["Loading retained detail…"] : wrapped.slice(view.visualOffset, view.visualOffset + Math.max(1, height - 9)) ?? ["Output unavailable"]),
      "Esc back | h help | Up/Down scroll | u/d page | g/l edges"];
    return frame(`READ-ONLY INSPECTOR${this.focus === "inspector" ? " [focus]" : ""}`, body, width, height, role);
  }
}
export function frame(title: string, body: string[], width: number, height: number, role?: "A" | "B"): string[] {
  const inner = Math.max(0, width - 2);
  const border = paintRole("|", role);
  const bodyLine = (line: string) => `${border}${paintDefault(pad(line, inner))}${border}`;
  const lines = [paintRole(`+\x1b[1m${pad(` ${title} `, inner)}\x1b[22m+`, role),
    ...body.slice(0, Math.max(0, height - 2)).map(bodyLine)];
  while (lines.length < height - 1) lines.push(bodyLine(""));
  lines.push(paintRole(`+${"-".repeat(inner)}+`, role));
  return lines.slice(0, height).map((line) => visibleWidth(line) > width ? pad(line, width) : line);
}
