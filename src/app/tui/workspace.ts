import { bindingMatches, inspectorTabs } from "./bindings.js";
import { Key, matchesKey, visibleWidth, truncateToWidth, wrapTextWithAnsi, Markdown, type MarkdownTheme } from "@mariozechner/pi-tui";
import type { InteractiveCoordinatorService } from "../interactive/service.js";
import type { InteractiveUiState } from "../../types/ui.js";
import type { HistoryDetail, HistoryRecord } from "../../types/history.js";
import { roleLabel } from "../../types/history.js";
import { safeDisplayText, visibleProse } from "../../security/display-text.js";

export type WorkspaceFocus = "editor" | "transcript" | "history" | "activity" | "inspector";
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

/** Presentation only: IDs, folds, focus and bounded detail ranges. Never binds runtimes. */
export class CurrentWorkspace {
  public focus: WorkspaceFocus = "editor";
  public historyOpen = false;
  public inspector: InspectorState | undefined;
  private historySelection: string | undefined;
  private workspaceSelection: string | undefined;
  private viewedTurnId: string | undefined;
  private readonly expanded = new Set<string>();
  private readonly collapsedRuns = new Set<string>();
  private readonly collapsedTurns = new Set<string>();
  private following = true;
  private readRevision = 0;
  private unread = 0;
  private streamAtRead: { key: string; length: number } | undefined;
  private generation = 0;
  private height = 10;
  private width = 80;
  private readonly clocks = new Map<string, { start: number; elapsed: number }>();
  private readonly proseCache = new Map<string, { width: number; content: string; lines: string[] }>();
  private readonly runProse = new Map<string, string>();
  private readonly pendingProse = new Set<string>();
  public constructor(private readonly service: InteractiveCoordinatorService, private readonly requestRender: () => void) {}

  public close(): boolean {
    if (this.inspector) { this.focus = this.inspector.origin; this.inspector = undefined; this.generation++; return true; }
    if (this.historyOpen) { this.historyOpen = false; this.focus = "history"; return true; }
    return false;
  }
  public get context(): string { return this.inspector ? `inspector / ${this.inspector.section}` : this.historyOpen || this.focus === "history" ? "history" : this.focus === "transcript" ? "workspace records" : this.focus; }
  public cycle(direction: 1 | -1, activity: boolean): void {
    const order: WorkspaceFocus[] = this.inspector ? ["editor", "inspector", ...(activity ? ["activity" as const] : [])]
      : this.historyOpen ? ["editor", "history", ...(activity ? ["activity" as const] : [])]
      : activity ? ["editor", "transcript", "history", "activity"] : ["editor", "transcript", "history"];
    this.focus = order[(order.indexOf(this.focus) + direction + order.length) % order.length] ?? "editor";
    if (this.focus === "history") {
      const state = this.service.getState();
      this.historySelection ??= this.historyRows(state).at(-1)?.id;
      this.browse(state);
    }
  }
  private rows(state: InteractiveUiState): HistoryRecord[] {
    const records = state.history.records;
    const turnId = this.viewedTurnId ?? state.history.currentTurnId;
    const result: HistoryRecord[] = [];
    if (turnId && this.collapsedTurns.has(turnId)) return result;
    for (const run of children(records, turnId ?? "")) {
      result.push(run);
      if (!this.collapsedRuns.has(run.id)) result.push(...children(records, run.id));
    }
    return result;
  }
  private select(records: HistoryRecord[], id: string | undefined): HistoryRecord | undefined { return records.find((record) => record.id === id) ?? records.at(-1); }
  private current(state: InteractiveUiState): void {
    this.following = true; this.unread = 0; this.readRevision = state.history.revision;
    this.viewedTurnId = undefined; this.historyOpen = false;
    this.workspaceSelection = this.rows(state).at(-1)?.id ?? state.history.currentTurnId;
  }
  private browse(state: InteractiveUiState): void { if (this.following) { this.readRevision = state.history.revision; this.following = false; this.viewedTurnId = state.history.currentTurnId;
      const stream = state.liveStream;
      this.streamAtRead = stream ? { key: `${stream.role}:${stream.sessionId}:${stream.startedAt}`, length: stream.text.length } : undefined; } }
  public handleInput(data: string, state: InteractiveUiState, wide: boolean): boolean {
    if (this.inspector && this.focus === "inspector") return this.inspectorInput(data);
    if (this.focus !== "transcript" && this.focus !== "history") return false;
    if (bindingMatches(data, "latest")) { this.current(state); return true; }
    if (this.focus === "history" && !wide && !this.historyOpen) {
      if (bindingMatches(data, "inspect")) { this.historyOpen = true; this.browse(state); return true; }
      return true;
    }
    const history = this.focus === "history";
    const records = history ? this.historyRows(state) : this.rows(state);
    const selected = !history && this.workspaceSelection === (this.viewedTurnId ?? state.history.currentTurnId) ? state.history.records.find((record) => record.id === this.workspaceSelection) : this.select(records, history ? this.historySelection : this.workspaceSelection);
    if (!selected) return true;
    if (history) this.historySelection = selected.id; else this.workspaceSelection = selected.id;
    const index = records.indexOf(selected);
    let next = index;
    if (matchesKey(data, Key.up)) next--;
    else if (matchesKey(data, Key.down)) next++;
    else if (matchesKey(data, Key.pageUp)) next -= Math.max(1, this.height - 5);
    else if (matchesKey(data, Key.pageDown)) next += Math.max(1, this.height - 5);
    else if (matchesKey(data, Key.home)) next = 0;
    else if (bindingMatches(data, "inspect")) { this.browse(state); this.inspect(selected.id); return true; }
    else if (bindingMatches(data, "fold") || bindingMatches(data, "expand")) {
      if (selected.kind === "turn" && !history) {
        if (bindingMatches(data, "fold") && !this.collapsedTurns.has(selected.id)) this.collapsedTurns.add(selected.id); else this.collapsedTurns.delete(selected.id);
      } else if (selected.kind === "run" && !history) {
        if (bindingMatches(data, "fold") && !this.collapsedRuns.has(selected.id)) this.collapsedRuns.add(selected.id); else this.collapsedRuns.delete(selected.id);
      } else if (bindingMatches(data, "fold") && this.expanded.has(selected.id)) this.expanded.delete(selected.id); else this.expanded.add(selected.id);
      this.browse(state); return true;
    } else if (bindingMatches(data, "collapse")) {
      if (!history && selected.kind === "turn") this.collapsedTurns.add(selected.id);
      else if (!history && selected.kind === "run" && !this.collapsedRuns.has(selected.id)) this.collapsedRuns.add(selected.id);
      else if (!this.expanded.delete(selected.id) && selected.kind !== "turn") { if (history) this.historySelection = selected.parentId; else this.workspaceSelection = selected.parentId; }
      this.browse(state); return true;
    } else return true; // Printable inspector/history keys never leak into the composer.
    const target = records[Math.max(0, Math.min(records.length - 1, next))];
    if (target) {
      this.browse(state);
      if (history) { this.historySelection = target.id; if (target.kind === "turn") this.viewedTurnId = target.id; }
      else this.workspaceSelection = target.id;
    }
    return true;
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
  public render(state: InteractiveUiState, width: number, height: number): string[] {
    this.height = height; this.width = width;
    if (!this.following) {
      const stream = state.liveStream;
      const newProse = stream && (this.streamAtRead?.key !== `${stream.role}:${stream.sessionId}:${stream.startedAt}` || stream.text.length > this.streamAtRead.length) ? 1 : 0;
      this.unread = Math.max(this.unread, state.history.revision - this.readRevision + newProse);
    }
    else this.readRevision = state.history.revision;
    const wide = width >= 104 && height >= 14;
    const railWidth = wide ? Math.min(28, Math.floor(width * .22)) : 0;
    if (this.inspector) return this.renderInspector(state, width, height);
    const turns = state.history.records.filter((record) => record.kind === "turn");
    if (this.historyOpen && !wide) return frame(`HISTORY${this.focus === "history" ? " [focus]" : ""} / ${turns.filter((turn) => turn.id !== state.history.currentTurnId).length} past turns`, this.renderHistory(state, width - 2, height - 2), width, height);
    const currentWidth = wide ? width - railWidth - 1 : width;
    const mainHeight = height - (wide ? 0 : 1);
    const current = state.history.records.find((record) => record.id === (this.viewedTurnId ?? state.history.currentTurnId));
    const live = liveIdentity(state);
    const turnNumber = current ? turns.findIndex((turn) => turn.id === current.id) + 1 : undefined;
    const title = `${this.viewedTurnId ? "HISTORY TURN" : "CURRENT TURN"}${turnNumber ? ` ${turnNumber}` : ""} | ${this.viewedTurnId ? current?.outcome.kind ?? "unavailable" : live.text}${this.focus === "transcript" ? " [focus]" : ""}`;
    const bodyWidth = Math.max(1, currentWidth - 4);
    const rows = this.rows(state);
    if (this.following) this.workspaceSelection = rows.at(-1)?.id ?? current?.id;
    const selected = this.workspaceSelection === current?.id ? current : this.select(rows, this.workspaceSelection);
    const maxRows = Math.max(1, mainHeight - 8);
    const selectedIndex = selected ? rows.indexOf(selected) : 0;
    const start = Math.max(0, selectedIndex - Math.floor(maxRows / 2));
    const body = [current && this.workspaceSelection === current.id ? `> Operator turn: ${current.title} / ${recordSummary(current, state.history.records)}` : current?.title ?? "Send a request to Agent A, or use /help.",
      `\x1b[1;4m>> ${this.viewedTurnId ? selected?.title ?? "Retained records" : live.phase.toUpperCase()} / ${this.viewedTurnId ? current?.outcome.kind : state.pendingPlan ? "waiting approval" : state.operation.kind === "running" || state.operation.kind === "cancelling" ? state.operation.kind : current?.outcome.kind ?? state.operation.kind}\x1b[0m`,
      ...(!this.viewedTurnId ? [this.pointer(state)] : []), ""];
    for (const record of rows.slice(start, start + maxRows)) {
      const marker = selected?.id === record.id ? ">" : " ";
      const label = `${marker} ${this.expanded.has(record.id) ? "-" : "+"} ${record.kind === "tool" ? "  " : ""}${record.kind === "turn" ? "" : roleLabel(record.role)} [${record.outcome.kind}] ${record.title} / ${this.duration(record)} ${recordSummary(record, state.history.records)}`;
      body.push(paintRole(pad(label, bodyWidth), record.kind === "turn" ? undefined : record.role));
      if (this.expanded.has(record.id) && record.kind === "tool") body.push(...wrap(record.preview ? `Preview (up to 120 chars): ${record.preview}` : "Preview unavailable; Enter inspects retained output.", bodyWidth).slice(0, 2));
    }
    const latestRun = children(state.history.records, current?.id ?? "").at(-1);
    if (latestRun?.kind === "run") {
      const cacheKey = `${latestRun.id}:${latestRun.outcome.kind}`;
      if (!this.runProse.has(cacheKey) && !this.pendingProse.has(cacheKey) && latestRun.outcome.kind !== "running") {
        this.pendingProse.add(cacheKey);
        void this.service.loadHistoryDetail?.(latestRun.id, "output", 0, 60).then((detail) => {
          this.runProse.set(cacheKey, detail.lines.join("\n").split("\n\nCalls:")[0] ?? "");
          this.pendingProse.delete(cacheKey);
          // Only the displayed turn's prose is cached; old turns load on demand.
          if (this.runProse.size > 8) this.runProse.delete(this.runProse.keys().next().value ?? "");
          this.requestRender();
        }).catch(() => this.pendingProse.delete(cacheKey));
      }
      const prose = !this.viewedTurnId && state.liveStream ? visibleProse(state.liveStream.text) : this.runProse.get(cacheKey);
      if (prose) {
        const key = `${latestRun.id}:${bodyWidth}`;
        const cached = this.proseCache.get(key);
        const boundedProse = prose.slice(-24000).split("\n").slice(-80).join("\n");
        const lines = cached?.content === prose ? cached.lines : new Markdown(boundedProse, 0, 0, theme).render(bodyWidth);
        this.proseCache.clear(); this.proseCache.set(key, { width: bodyWidth, content: prose, lines });
        body.push("", ...lines.slice(-Math.max(1, mainHeight - body.length - 3)));
      }
    }
    const frameRole = live.role ?? (latestRun?.kind === "run" ? latestRun.role : undefined);
    const main = frame(title, body, currentWidth, mainHeight, this.viewedTurnId ? undefined : frameRole);
    if (!wide) return [pad(`History / ${turns.filter((turn) => turn.id !== state.history.currentTurnId).length} past turns${this.focus === "history" ? " [focus]" : ""} | F6 then Enter opens | ${this.unread} unread | End current`, width), ...main];
    const history = frame(`HISTORY${this.focus === "history" ? " [focus]" : ""}`, this.renderHistory(state, railWidth - 2, height - 2), railWidth, height);
    return history.map((line, index) => `${line} ${main[index] ?? " ".repeat(currentWidth)}`);
  }
  public pointer(state: InteractiveUiState): string {
    const live = liveIdentity(state);
    const run = [...state.history.records].reverse().find((record) => record.kind === "run" && record.outcome.kind === "running");
    const tool = run ? children(state.history.records, run.id).find((record) => record.outcome.kind === "running") : undefined;
    const activity = state.operation.kind === "running" ? tool ? `${tool.title} / running, no final exit status` : run ? "No tool currently running" : "Preparing next role run" : state.pendingPlan ? "/approve to execute" : `Last result: ${live.phase}`;
    return `${live.text} / ${live.phase}${run && state.operation.kind === "running" ? ` / ${this.duration(run)}` : ""} / ${activity}${this.unread ? ` | ${this.unread} unread, End current` : ""}`;
  }
  private historyRows(state: InteractiveUiState): HistoryRecord[] {
    return state.history.records.filter((record) => record.kind === "turn" && record.id !== state.history.currentTurnId).flatMap((turn) => [turn,
      ...(this.expanded.has(turn.id) ? children(state.history.records, turn.id).flatMap((run) => [run, ...(this.expanded.has(run.id) ? children(state.history.records, run.id) : [])]) : [])]);
  }
  private renderHistory(state: InteractiveUiState, width: number, height: number): string[] {
    const rows = this.historyRows(state);
    const turns = state.history.records.filter((record) => record.kind === "turn");
    const selected = this.select(rows, this.historySelection);
    const index = selected ? rows.findIndex((row) => row.id === selected.id) : 0;
    const budget = Math.max(1, Math.floor((height - 2) / 3));
    const start = Math.max(0, index - Math.floor(budget / 2));
    if (!rows.length) return ["No previous turns.", "Current calls are in", "the workspace."];
    return [...rows.slice(start, start + budget).flatMap((record) => {
      const label = record.kind === "turn" ? `Turn ${turns.findIndex((turn) => turn.id === record.id) + 1}` : `${record.kind === "tool" ? "  " : " "}${roleLabel(record.role)} ${record.title}`;
      return [pad(`${record.id === selected?.id ? ">" : " "} ${this.expanded.has(record.id) ? "-" : "+"} ${label} [${record.outcome.kind}]`, width),
        pad(`  ${record.title}`, width), pad(`  ${recordSummary(record, state.history.records)}`, width)];
    }), pad(`${this.unread} unread | End current`, width), ...state.history.warnings.slice(0, 1).flatMap((warning) => wrap(warning, width))];
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
      "Esc back | F1 help | Up/Down PgUp/PgDn scroll"];
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
