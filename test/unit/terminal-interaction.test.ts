import { TUI, visibleWidth } from "@mariozechner/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { HeadlessInteractiveCoordinatorService } from "../../src/app/interactive/service.js";
import { CoordinatorTuiApp } from "../../src/app/tui/app.js";
import { MemoryTerminal } from "../helpers/terminal.js";
import { createInitialInteractiveUiState } from "../../src/app/interactive/store.js";
import type { CoordinatorStatusSnapshot } from "../../src/types/status.js";

const status: CoordinatorStatusSnapshot = { cwd: "/tmp/terminal", conversationMode: "planning", phase: "planning", phaseLabel: "Planning",
  activeRole: "A", activeRoleLabel: "Agent A", activeModelDisplay: "fixture", sessionRoot: "(memory)", repairCount: 0, maxReviewRounds: 3, runtimes: [], metrics: {} };
async function setup(fail = false) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const coordinator = { start: async () => {}, dispose: async () => {}, getStatus: () => status,
    submitUserInput: vi.fn(async () => { await gate; if (fail) throw new Error("provider failed"); return { mode: "planning" as const, userResponse: "Completed answer" }; }),
    approvePendingPlan: async () => ({ mode: "planning" as const, userResponse: "Approved" }), discardPendingPlan() {},
    getSessions: () => [], getLastHandoff: async () => ({}), subscribeEvents: () => () => {}, subscribeRuntimeUiEvents: () => () => {}, replaceRuntime: async () => {},
    cancelActive: vi.fn(async () => { release(); }) };
  const service = new HeadlessInteractiveCoordinatorService(coordinator);
  await service.start();
  const terminal = new MemoryTerminal();
  const tui = new TUI(terminal);
  const app = new CoordinatorTuiApp(tui, terminal, service, { onExit() {} }); app.focused = true;
  return { app, terminal, service, coordinator, release };
}
function text(app: CoordinatorTuiApp, width = 80): string { return app.render(width).join("\n"); }
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

describe("real Pi editor and terminal components", () => {
  it.each([false, true])("preserves a new draft after completion or failure: %s", async (fail) => {
    const { app, service, coordinator, release } = await setup(fail);
    app.handleInput("task"); app.handleInput("\r");
    expect(coordinator.submitUserInput).toHaveBeenCalledOnce();
    app.handleInput("draft survives"); app.handleInput("\r");
    expect(coordinator.submitUserInput).toHaveBeenCalledOnce();
    expect(text(app)).toContain("draft survives");
    release(); await settle();
    expect(text(app)).toContain("draft survives");
    expect(service.getState().operation.kind).toBe(fail ? "failed" : "completed");
    await service.dispose();
  });

  it("Ctrl+C cancels active work without clearing the draft, including Kitty keys", async () => {
    const { app, service, coordinator } = await setup();
    app.handleInput("task"); app.handleInput("\r"); app.handleInput("precious draft");
    app.handleInput("\u001b[99;5u"); await settle();
    expect(coordinator.cancelActive).toHaveBeenCalledOnce();
    expect(text(app)).toContain("precious draft");
    await service.dispose();
  });

  it("bounds wide Unicode, fenced code, multiline paste, and repeated resizes", async () => {
    const { app, terminal, service } = await setup();
    app.handleInput("\u001b[200~first 界 😀\nsecond\nthird\nfourth\nfifth\nsixth\nseventh\u001b[201~");
    for (const [columns, rows] of [[80,24],[120,40],[40,12],[80,24],[120,40]]) {
      if (columns === undefined || rows === undefined) throw new Error("size");
      terminal.columns = columns; terminal.rows = rows;
      const lines = app.render(columns);
      expect(lines).toHaveLength(rows);
      expect(lines.every((line) => visibleWidth(line) <= columns)).toBe(true);
      expect(lines.join("\n")).toContain(columns < 80 ? "Compact terminal" : "Enter submit");
    }
    expect(text(app,120)).toContain("seventh");
    await service.dispose();
  });

  it("keeps Tab for completion and browsing panes, and restores the draft after history", async () => {
    const { app, service, release } = await setup();
    app.handleInput("old prompt"); app.handleInput("\r"); release(); await settle();
    app.handleInput("current draft"); app.handleInput("\x1b"); app.handleInput("p");
    expect(text(app)).toContain("old prompt");
    app.handleInput("\u001b[B");
    expect(text(app)).toContain("current draft");
    app.handleInput("\x1b"); app.handleInput("w"); expect(text(app)).toContain("[focus]");
    app.handleInput("\u001b"); app.handleInput("\u0003");
    app.handleInput("/sta"); app.handleInput("\t"); await settle(); app.handleInput("\t"); await settle();
    expect(text(app)).toContain("/status");
    await service.dispose();
  });

  it.each(["separate", "combined", "kitty"])("inserts a newline at the draft cursor with %s keys", async (encoding) => {
    const { app, service, coordinator, release } = await setup();
    try {
      release();
      app.handleInput("abc"); app.handleInput("\x1b[D");
      if (encoding === "combined") app.handleInput("\x1bn");
      else {
        app.handleInput(encoding === "kitty" ? "\x1b[27u" : "\x1b");
        expect(text(app)).toContain("Controls");
        app.handleInput(encoding === "kitty" ? "\x1b[110u" : "n");
      }
      expect(coordinator.submitUserInput).not.toHaveBeenCalled();
      app.handleInput("X"); app.handleInput("\r"); await settle();
      expect(coordinator.submitUserInput).toHaveBeenCalledWith("ab\nXc");
    } finally { await service.dispose(); }
  });

  it("preserves the cursor when the menu closes and never steals printable editor keys", async () => {
    const { app, service, coordinator, release } = await setup();
    try {
      release();
      app.handleInput("ab"); app.handleInput("\x1b[D");
      app.handleInput("\x1b"); app.handleInput("\x1b");
      for (const key of "hmawreplnxqudg") app.handleInput(key);
      app.handleInput("\r"); await settle();
      expect(coordinator.submitUserInput).toHaveBeenCalledWith("ahmawreplnxqudgb");
      expect(service.getState().shouldExit).toBe(false);
    } finally { await service.dispose(); }
  });

  it("keeps the menu open through updates and resizing, and scrolls choices with arrows", async () => {
    const { app, service, terminal } = await setup();
    try {
      app.handleInput("saved draft"); app.handleInput("\x1b");
      await service.dispatch({ type: "cancel" });
      for (const [columns = 80, rows = 24] of [[80, 24], [120, 40], [40, 12], [80, 24]]) {
        terminal.columns = columns; terminal.rows = rows;
        const lines = app.render(columns);
        expect(lines).toHaveLength(rows);
        expect(lines.every((line) => visibleWidth(line) <= columns)).toBe(true);
        expect(lines.join("\n")).toContain("Controls");
        expect(lines.join("\n")).toContain("saved draft");
      }
      terminal.columns = 40; terminal.rows = 12;
      app.handleInput("\x1b[A");
      expect(text(app, 40)).toContain("> q  Quit");
      app.handleInput("\r");
      expect(text(app, 40)).toContain("Quit pi-dual?");
      app.handleInput("\r");
      expect(service.getState().shouldExit).toBe(false);
      app.handleInput("n");
      expect(text(app, 40)).toContain("saved draft");
    } finally { await service.dispose(); }
  });

  it("ignores pasted commands in menus and confirms quit explicitly", async () => {
    const { app, service } = await setup();
    try {
      app.handleInput("saved draft"); app.handleInput("\x1b");
      app.handleInput("\x1b[200~qyx\x1b[201~");
      expect(text(app)).toContain("Controls");
      app.handleInput("q");
      app.handleInput("\x1b[200~"); app.handleInput("y"); app.handleInput("\x1b[201~");
      expect(service.getState().shouldExit).toBe(false);
      app.handleInput("\x1b");
      expect(text(app)).toContain("saved draft");
      app.handleInput("\x1b"); app.handleInput("q"); app.handleInput("y"); await settle();
      expect(service.getState().shouldExit).toBe(true);
    } finally { await service.dispose(); }
  });

  it.each(["x", "\x03"])("cancels active work from the menu with %j without clearing or submitting the draft", async (cancelKey) => {
    const { app, service, coordinator } = await setup();
    try {
      app.handleInput("task"); app.handleInput("\r"); app.handleInput("precious draft");
      app.handleInput("\x1b"); app.handleInput(cancelKey); await settle();
      expect(coordinator.cancelActive).toHaveBeenCalledOnce();
      expect(coordinator.submitUserInput).toHaveBeenCalledOnce();
      expect(text(app)).toContain("precious draft");
    } finally { await service.dispose(); }
  });

  it("opens help with arrows, keeps the draft through completion dismissal, and handles empty prompt history", async () => {
    const { app, service } = await setup();
    try {
      app.handleInput("draft"); app.handleInput("\x1b"); app.handleInput("p");
      expect(text(app)).toContain("draft");
      app.handleInput("\x1b"); app.handleInput("\r");
      expect(service.getState().modal.kind).toBe("help");
      app.handleInput("\x1b"); app.handleInput("\x03");
      app.handleInput("/"); await settle();
      app.handleInput("\x1b");
      expect(text(app)).not.toContain("Letter or Up/Down");
      app.handleInput("\x1b");
      expect(text(app)).toContain("Letter or Up/Down");
      app.handleInput("e");
      expect(service.getState().shouldExit).toBe(false);
    } finally { await service.dispose(); }
  });

  it("does not claim that a rejected command stopped active work", async () => {
    const { app, service, release } = await setup();
    app.handleInput("task"); app.handleInput("\r");
    await service.dispatch({type:"submit_input",input:"/not-a-command"});
    expect(service.getState().lastError?.nextStep).toContain("/status");
    expect(service.getState().operation.kind).toBe("running");
    release(); await settle(); await service.dispose();
  });

  it("lets Escape dismiss Pi completion", async () => {
    const { app, service } = await setup();
    app.handleInput("/"); await settle();
    expect(text(app)).toContain("Show commands");
    app.handleInput("\u001b");
    expect(text(app)).not.toContain("Show commands");
    await service.dispose();
  });

  it("navigates multiline history without skipping newer entries or losing a draft", async () => {
    const { app, service, release } = await setup();
    release();
    app.handleInput("\u001b[200~older first\nolder second\u001b[201~"); app.handleInput("\r"); await settle();
    app.handleInput("most recent"); app.handleInput("\r"); await settle();
    app.handleInput("current draft"); app.handleInput("\x1b"); app.handleInput("p");
    app.handleInput("\u001b[A"); app.handleInput("\u001b[A");
    app.handleInput("\u001b[B"); app.handleInput("\u001b[B");
    // Submitting proves which editor value was selected, independently of the transcript.
    app.handleInput("\r"); await settle();
    expect(service.getState().conversation.filter((entry) => entry.kind === "operator_message").at(-1)).toMatchObject({ text: "most recent" });
    app.handleInput("draft again"); app.handleInput("\x1b"); app.handleInput("p"); app.handleInput("\u001b[B");
    app.handleInput("\r"); await settle();
    expect(service.getState().conversation.filter((entry) => entry.kind === "operator_message").at(-1)).toMatchObject({ text: "draft again" });
    await service.dispose();
  });

  it("keeps a record anchor when another operator turn becomes current", () => {
    let state = createInitialInteractiveUiState(status);
    const at = new Date().toISOString();
    state.history = { currentTurnId: "turn", revision: 1, warnings: [], records: [
      { kind: "turn", id: "turn", title: "Original task", requestIds: [], timestamp: at, outcome: { kind: "running", startedAt: at } },
      ...Array.from({length: 30}, (_, index) => ({ kind: "run" as const, id: `run-${index}`, parentId: "turn", role: "A" as const, sessionId: "session", phase: "Planning", title: `record ${index}`, timestamp: at, outcome: { kind: "completed" as const, endedAt: at } }))
    ] };
    const terminal = new MemoryTerminal();
    const tui = new TUI(terminal);
    const app = new CoordinatorTuiApp(tui, terminal, { start:async()=>{},dispose:async()=>{},dispatch:async()=>{},getState:()=>state,subscribeState:()=>()=>{},subscribeUiEvents:()=>()=>{} },{onExit(){}});
    app.render(80); app.handleInput("\u001b[17~"); app.handleInput("\u001b[A");
    const before = app.render(80).find((line) => line.includes("> + A - Senior"));
    state = { ...state, history: { ...state.history, revision: 2, currentTurnId: "new", records: [...state.history.records, { kind: "turn", id: "new", title: "New output", requestIds: [], timestamp: at, outcome: { kind: "running", startedAt: at } }] } };
    expect(before).toBeDefined();
    expect(app.render(80).find((line) => line.includes("> + A - Senior"))).toBe(before);
    app.handleInput("\u001b[F"); expect(text(app)).toContain("New output");
  });
});
