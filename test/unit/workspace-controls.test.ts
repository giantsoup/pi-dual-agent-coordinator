import { TuiMainScreen, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { CoordinatorTuiApp } from "../../src/app/tui/app.js";
import { HeadlessInteractiveCoordinatorService } from "../../src/app/interactive/service.js";
import { MemoryTerminal } from "../helpers/terminal.js";
import type { HistoryRecord } from "../../src/types/history.js";
import type { NormalizedTelemetryEvent } from "../../src/types/telemetry.js";
import type { CoordinatorStatusSnapshot } from "../../src/types/status.js";
import { CurrentWorkspace, liveIdentity } from "../../src/app/tui/workspace.js";
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 5));
async function setup() {
  let listener: (event: NormalizedTelemetryEvent) => void = () => {};
  const status: CoordinatorStatusSnapshot = { operation: { kind: "running" }, cwd: "/fixture/界/é/😀", conversationMode: "planning", phase: "execution", phaseLabel: "Execution", activeRole: "B", activeRoleLabel: "Agent B", activeModelDisplay: "fixture", sessionRoot: "memory", repairCount: 0, maxReviewRounds: 3, runtimes: [], metrics: {} };
  const mutation = vi.fn(async () => {});
  const coordinator = { start: async () => {}, dispose: async () => {}, getStatus: () => status, submitUserInput: vi.fn(async () => ({ mode: "planning" as const, userResponse: "answer" })),
    approvePendingPlan: async () => ({ mode: "planning" as const, userResponse: "answer" }), discardPendingPlan: vi.fn(), getSessions: () => [], getLastHandoff: async () => ({}),
    subscribeEvents: (fn: typeof listener) => { listener = fn; return () => {}; }, subscribeRuntimeUiEvents: () => () => {}, replaceRuntime: mutation,
    getRunArchive: async () => [{ type: "message", id: "result", timestamp: "now", parentId: null, message: { role: "toolResult", toolCallId: "call-0", content: [{ type: "text", text: Array.from({ length: 400 }, (_, i) => `retained line ${i} 界 é 😀`).join("\n") }] } }] };
  const service = new HeadlessInteractiveCoordinatorService(coordinator); await service.start();
  const emit = (type: string, details: Record<string, unknown>, extra: Partial<NormalizedTelemetryEvent> = {}) => listener({ eventType: type, details, operatorTurnId: "turn", runId: "run", role: "B", sessionId: "s", requestId: "r", timestamp: "2026-10-16T12:00:00Z", ...extra });
  emit("ui.turn_started", { objective: "Inspect tools" }); emit("runtime.run_started", { provenance: "coordinator_handoff" });
  for (let i = 0; i < 12; i++) { emit("pi.tool_execution_start", { toolName: "read", toolCallId: `call-${i}`, toolArgs: { path: `file-${i}` } }); emit("pi.tool_execution_end", { toolName: "read", toolCallId: `call-${i}`, isError: i === 4 }); }
  const terminal = new MemoryTerminal(); const tui = new TuiMainScreen(terminal);
  const app = new CoordinatorTuiApp(tui, terminal, service, { onExit() {} }); app.focused = true;
  // These control tests exercise individual calls after explicitly expanding their group.
  app.render(80); app.handleInput("\x1bw"); app.handleInput("\x1b[H"); app.handleInput("\x1b[C"); app.handleInput("\x1bl"); app.handleInput("\x1be");
  return { app, service, terminal, coordinator, status, emit };
}
const strip = (text: string) => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
describe("selected workspace through shared history service", () => {
  it("keeps following the newest output when a response exceeds the preview budget", async () => {
    const { app, service } = await setup();
    try {
      const getState = service.getState.bind(service);
      vi.spyOn(service, "getState").mockImplementation(() => ({ ...getState(), liveStream: { role: "B", sessionId: "s", startedAt: "now", text: "earlier output\n".repeat(2500) + "NEWEST_RESPONSE_TAIL" } }));
      const screen = strip(app.render(80).join("\n"));
      expect(screen).toContain("NEWEST_RESPONSE_TAIL");
      expect(screen).toContain("Recent response preview");
      expect(screen).toContain("Following");
    } finally { await service.dispose(); }
  });
  it.each([[80, 24], [120, 40]])("scrolls records and prose while preserving the draft at %sx%s", async (width, height) => {
    const { app, service, terminal, coordinator } = await setup();
    try {
      terminal.columns = width; terminal.rows = height;
      const getState = service.getState.bind(service);
      let liveStream = { role: "B" as const, sessionId: "s", startedAt: "now", text: Array.from({ length: 60 }, (_, i) => `PROSE[${i}]`).join("\n") };
      vi.spyOn(service, "getState").mockImplementation(() => ({ ...getState(), liveStream }));
      app.handleInput("draft stays here");
      const screen = () => strip(app.render(width).join("\n"));
      const position = () => Number(screen().match(/↑ (\d+)/)?.[1]);
      expect(screen()).toContain("PROSE[59]");
      expect(screen()).toContain("Wheel scroll");
      expect(screen()).toContain("Esc controls");
      const bottom = position();
      app.handleInput("\x1b[5~");
      expect(position()).toBeLessThan(bottom);
      expect(screen()).toContain("Paused");
      const page = position();
      app.handleInput("\x1b[1;2A"); expect(position()).toBe(page - 1);
      app.handleInput("\x1b[1;2B"); expect(position()).toBe(page);
      app.handleInput("\x1b[6~"); expect(position()).toBe(bottom);
      app.handleInput("\x1b[5~");
      const paused = screen();
      liveStream = { ...liveStream, text: liveStream.text + "\nPROSE[60]" };
      expect(position()).toBe(page);
      expect(screen()).not.toContain("PROSE[60]");
      app.handleInput("\x1bOP"); app.render(width); app.handleInput("\x1b");
      expect(position()).toBe(page);
      expect(screen()).toContain("draft stays here");
      for (let i = 0; i < 20; i++) { app.handleInput("\x1b[5~"); app.render(width); }
      expect(position()).toBe(0);
      expect(screen()).toContain("read file-0");
      expect(screen()).not.toContain("PROSE[60]");
      app.handleInput("\x1b[F");
      expect(screen()).toContain("PROSE[60]");
      expect(screen()).toContain("Following");
      expect(screen()).toContain("CURRENT REQUEST");
      expect(screen()).toContain("draft stays here");
      expect(paused).not.toContain("PROSE[59]");
      expect(coordinator.submitUserInput).not.toHaveBeenCalled();
      expect(coordinator.replaceRuntime).not.toHaveBeenCalled();
      const lines = app.render(width);
      expect(lines).toHaveLength(height);
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
    } finally { await service.dispose(); }
  });
  it.each([[80, 24], [120, 40]])("uses portable controls for workspace, history, activity and inspector at %sx%s", async (width, height) => {
    const { app, service, terminal, coordinator } = await setup();
    try {
      terminal.columns = width; terminal.rows = height;
      app.render(width); app.handleInput("draft");
      app.handleInput("\x1b"); app.handleInput("w");
      const screen = () => strip(app.render(width).join("\n"));
      expect(screen()).toContain("[focus]");
      app.handleInput("u"); expect(screen()).toContain("Paused");
      app.handleInput("d"); app.handleInput("l"); expect(screen()).toContain("Following");
      app.handleInput("g"); app.handleInput("\x1b[B"); app.handleInput("\r"); await settle();
      expect(screen()).toContain("READ-ONLY INSPECTOR");
      app.handleInput("3"); await settle(); app.handleInput("d");
      const beforeHelp = screen();
      app.handleInput("h"); app.render(width); app.handleInput("\x1b");
      expect(screen()).toBe(beforeHelp);
      app.handleInput("l"); await settle();
      expect(screen()).toContain("retained line 399");
      app.handleInput("g"); await settle();
      expect(screen()).toContain("retained line 0");
      app.handleInput("\t");
      app.handleInput("\x1b"); app.handleInput("\x1b"); app.handleInput("r");
      expect(screen()).toContain("Request history");
      app.handleInput("\x1b");
      app.handleInput("\x1b"); app.handleInput("a");
      expect(screen()).toContain("Activity");
      app.handleInput("\x1b"); app.handleInput("a");
      expect(screen()).not.toContain("+ Activity");
      app.handleInput("\x1b"); app.handleInput("l");
      expect(screen()).toContain("Following");
      expect(screen()).toContain("draft");
      expect(coordinator.submitUserInput).not.toHaveBeenCalled();
      expect(coordinator.replaceRuntime).not.toHaveBeenCalled();
    } finally { await service.dispose(); }
  });
  it("anchors paused prose when new calls arrive and the live preview rolls over", async () => {
    const { service, emit } = await setup();
    try {
      const workspace = new CurrentWorkspace(service, () => {});
      const stream = { role: "B" as const, sessionId: "s", startedAt: "now", text: Array.from({ length: 70 }, (_, i) => `ANCHOR[${i}]`).join("\n") };
      let state = { ...service.getState(), liveStream: stream };
      const screen = () => strip(workspace.render(state, 80, 17).join("\n"));
      const prose = () => screen().split("\n").filter((line) => line.includes("ANCHOR["));
      screen(); workspace.scroll(-10, state);
      const before = prose();
      expect(before.length).toBeGreaterThan(0);
      emit("pi.tool_execution_start", { toolName: "read", toolCallId: "new-call", toolArgs: { path: "arrived-while-paused" } });
      state = { ...service.getState(), liveStream: { ...stream, text: Array.from({ length: 140 }, (_, i) => `ANCHOR[${i}]`).join("\n") } };
      expect(prose()).toEqual(before);
      expect(screen()).toContain("Paused");
      workspace.scrollInput("\x1b[F", state);
      expect(screen()).toContain("ANCHOR[139]");
      expect(screen()).toContain("Following");
    } finally { await service.dispose(); }
  });
  it.each([[80, 24], [120, 40]])("routes wheel events only over the request pane at %sx%s", async (width, height) => {
    const { app, service, terminal, emit } = await setup();
    try {
      for (let i = 12; i < 40; i++) emit("pi.tool_execution_start", { toolName: "read", toolCallId: `call-${i}`, toolArgs: { path: `file-${i}` } });
      terminal.columns = width; terminal.rows = height;
      app.handleInput("mouse draft");
      const screen = () => strip(app.render(width).join("\n"));
      const position = () => Number(screen().match(/↑ (\d+)/)?.[1]);
      const bottom = position();
      expect(bottom).toBeGreaterThan(0);
      app.handleInput("\x1b[<64;50;8M");
      expect(position()).toBe(Math.max(0, bottom - 3));
      app.handleInput("\x1b[<65;50;8M");
      expect(position()).toBe(bottom);
      app.handleInput(`\x1b[<64;50;${height}M`);
      app.handleInput("\x1b[<64;50;1M");
      app.handleInput("\x1b[<0;50;8M");
      app.handleInput("\x1b[<64;50;8m");
      expect(position()).toBe(bottom);
      app.handleInput("\x1bOP"); app.render(width);
      app.handleInput("\x1b[<64;50;8M"); app.handleInput("\x1b");
      expect(position()).toBe(bottom);
      expect(screen()).toContain("mouse draft");
      expect(screen()).not.toContain("<64;");
    } finally { await service.dispose(); }
  });
  it("scrolls inspector output under the pointer without moving editor focus", async () => {
    const { app, service } = await setup();
    try {
      app.render(80); app.handleInput("inspector draft");
      app.handleInput("\x1b[17~"); app.handleInput("\x1b[H"); app.handleInput("\x1b[B"); app.handleInput("\r");
      await settle(); app.handleInput("3"); await settle();
      app.handleInput("\x1b[17~");
      expect(strip(app.render(80).join("\n"))).toContain("line 1 of 400");
      app.handleInput("\x1b[<65;20;8M");
      const screen = strip(app.render(80).join("\n"));
      expect(screen).toContain("line 4 of 400");
      expect(screen).not.toContain("INSPECTOR [focus]");
      app.handleInput("!");
      expect(app.render(80).join("\n")).toContain("inspector draft!");
    } finally { await service.dispose(); }
  });
  it("distinguishes requests from supervised B turns and keeps live activity after the tools", async () => {
    const { app, service, emit } = await setup();
    try {
      emit("workflow.execution_progress", { workflowId: "workflow", handoffId: "handoff", iteration: 1,
        completedTurns: 9, checkIn: { kind: "scheduled", afterTurn: 10 } });
      emit("pi.tool_execution_start", { toolName: "bash", toolCallId: "active", toolArgs: { command: "verify-current-work" } });
      const lines = strip(app.render(80).join("\n")).split("\n");
      expect(lines.join("\n")).toContain("CURRENT REQUEST 1");
      expect(lines.join("\n")).toContain("B turns: 9 successful / A check at 10");
      const tool = lines.findIndex((line) => line.includes("[running] bash verify-current-work"));
      const active = lines.findIndex((line) => line.includes("Active: B - Junior"));
      expect(tool).toBeGreaterThan(-1);
      expect(active).toBeGreaterThan(tool);
      expect(lines.slice(active + 1).join("\n")).not.toContain("[completed]");
    } finally { await service.dispose(); }
  });
  it.each([[80, 24], [120, 40]])("keeps check-ins before resumed tools and activity last at %sx%s", async (width, height) => {
    const { app, service, terminal, emit } = await setup();
    try {
      terminal.columns = width; terminal.rows = height;
      emit("runtime.run_started", { provenance: "coordinator_check_in" }, { runId: "check", role: "A" });
      emit("runtime.run_finished", { outcome: "completed" }, { runId: "check", role: "A" });
      emit("pi.tool_execution_start", { toolName: "read", toolCallId: "resumed", toolArgs: { path: "after-check.txt" } });
      emit("workflow.execution_progress", { workflowId: "workflow", handoffId: "handoff", iteration: 1,
        completedTurns: 10, checkIn: { kind: "scheduled", afterTurn: 20 } });
      const lines = strip(app.render(width).join("\n")).split("\n");
      const check = lines.findIndex((line) => line.includes("[completed] Check-in"));
      const resumed = lines.findIndex((line) => line.includes("[running] read after-check.txt"));
      const active = lines.findIndex((line) => line.includes("Active: B - Junior"));
      expect(check).toBeGreaterThan(-1);
      expect(resumed).toBeGreaterThan(check);
      expect(active).toBeGreaterThan(resumed);
      expect(lines.join("\n")).toContain("B turns: 10 successful / A check at 20");
      expect(lines).toHaveLength(height);
      app.handleInput("\x1bOQ"); // F2 opens the optional activity panel.
      const activity = strip(app.render(width).join("\n")).split("\n");
      expect(activity.findIndex((line) => line.includes("Active: B - Junior"))).toBeGreaterThan(activity.findIndex((line) => line.includes("Activity")));
      expect(activity.some((line) => line.includes("Now:"))).toBe(true);
      expect(activity.slice(activity.findIndex((line) => line.includes("Now:")) + 1).join("\n")).not.toContain("[completed]");
      expect(activity.join("\n")).toContain("B turns: 10 successful / A check at 20");
    } finally { await service.dispose(); }
  });
  it("preserves draft, historical selection and inspector range through F1 and resize without runtime mutations", async () => {
    const { app, service, terminal, coordinator, emit } = await setup();
    app.handleInput("precious draft"); app.handleInput("\x1b[17~"); app.handleInput("\x1b[H"); app.handleInput("\x1b[B"); app.handleInput("\r");
    await settle(); app.handleInput("3"); await settle(); app.handleInput("\x1b[6~");
    const before = strip(app.render(80).join("\n"));
    expect(before).toContain("READ-ONLY INSPECTOR"); expect(before).toContain("retained line");
    app.handleInput("\x1bOP"); expect(service.getState().modal.kind).toBe("help"); app.render(80);
    app.handleInput("\x1b");
    expect(strip(app.render(80).join("\n"))).toBe(before);
    emit("runtime.run_started", { provenance: "coordinator_review" }, { runId: "review", role: "A" });
    for (const [columns, rows] of [[120,40],[80,24],[97,28],[40,12],[80,24]]) {
      terminal.columns = columns ?? 80; terminal.rows = rows ?? 24;
      const lines = app.render(terminal.columns); expect(lines).toHaveLength(terminal.rows);
      expect(lines.every((line) => visibleWidth(line) <= terminal.columns)).toBe(true);
      expect(lines.join("\n")).toContain("h help");
    }
    expect(app.render(80).join("\n")).toContain("precious draft");
    expect(app.render(80).join("\n")).toContain("Active: A - Senior");
    expect(app.render(80).join("\n")).toContain("B - Junior");
    app.handleInput("\x1b");
    expect(app.render(80).join("\n")).toContain("file-0");
    expect(coordinator.replaceRuntime).not.toHaveBeenCalled(); expect(coordinator.submitUserInput).not.toHaveBeenCalled(); expect(coordinator.discardPendingPlan).not.toHaveBeenCalled();
    await service.dispose();
  });
  it("chooses a past request and keeps run and tool inspection in the transcript", async () => {
    const { app, service, emit } = await setup();
    try {
      emit("ui.turn_started", { objective: "Next operator turn" }, { operatorTurnId: "next-turn" });
      app.render(80); app.handleInput("\x1bOS"); app.handleInput("g"); app.handleInput("\r");
      expect(app.render(80).join("\n")).toContain("HISTORY REQUEST 1");
      app.handleInput("\x1b[H"); app.handleInput(" ");
      expect(app.render(80).join("\n")).not.toContain("file-0");
      app.handleInput(" "); app.handleInput("\x1b[B"); app.handleInput(" "); app.handleInput("\r"); await settle();
      expect(app.render(80).join("\n")).toContain("READ-ONLY INSPECTOR");
      app.handleInput("\x1b"); app.handleInput("\x1bOS"); app.handleInput("l");
      expect(app.render(80).join("\n")).toContain("CURRENT REQUEST 2");
    } finally { await service.dispose(); }
  });
  it.each(["idle", "completed", "failed", "cancelled", "timed_out", "cancelling"] as const)("never calls cached activeRole running in %s", async (kind) => {
    const { service } = await setup();
    const state = { ...service.getState(), operation: { kind } };
    expect(liveIdentity(state).text).toBe(kind === "cancelling" ? "Cancelling" : "Idle");
    await service.dispose();
  });
  it("loads further output ranges and keeps printable shortcuts scoped to inspection", async () => {
    const { service } = await setup();
    const workspace = new CurrentWorkspace(service, () => {}); workspace.focus = "transcript";
    const tool = service.getState().history.records.find((record) => record.kind === "tool"); if (!tool) throw new Error("tool");
    workspace.inspect(tool.id); await settle(); workspace.handleInput("3", service.getState()); await settle();
    workspace.render(service.getState(), 80, 17);
    for (let i = 0; i < 25; i++) { workspace.handleInput("\x1b[6~", service.getState()); await settle(); }
    const lines = workspace.render(service.getState(), 80, 17).join("\n");
    expect(lines).toMatch(/retained line (1[2-9]\d|[23]\d\d)/);
    workspace.close(); workspace.focus = "editor"; expect(workspace.handleInput("3", service.getState())).toBe(false);
    await service.dispose();
  });
});

it.each(["xterm", "xterm-256color", "xterm-ghostty"])("uses the default %s palette without colored body fills", async (term) => {
  const { paintRole } = await import("../../src/app/tui/workspace.js");
  try {
    vi.stubEnv("NO_COLOR", undefined); vi.stubEnv("TERM", term);
    expect(paintRole("A - Senior", "A")).toBe("\x1b[36;49mA - Senior\x1b[0m");
    expect(paintRole("B - Junior", "B")).toBe("\x1b[33;49mB - Junior\x1b[0m");
    vi.stubEnv("TERM", "dumb"); expect(paintRole("A - Senior [completed]", "A")).toBe("A - Senior [completed]");
    vi.stubEnv("TERM", term);
    vi.stubEnv("NO_COLOR", "1"); expect(paintRole("B - Junior [failed]", "B")).toBe("B - Junior [failed]");
  } finally { vi.unstubAllEnvs(); }
});

it.each(["A", "B"] as const)("keeps %s workspace and inspector prose on terminal defaults", async (role) => {
  vi.stubEnv("NO_COLOR", undefined); vi.stubEnv("TERM", "xterm-ghostty");
  const { app, service, emit } = await setup();
  try {
    emit("runtime.run_started", { provenance: role === "A" ? "coordinator_review" : "coordinator_handoff" }, { runId: "color-run", role });
    const accent = `\x1b[${role === "A" ? "36" : "33"};49m`;
    for (const background of [undefined, "0;0", "0;15"]) {
      vi.stubEnv("COLORFGBG", background);
      for (const width of [80, 120]) {
        const lines = app.render(width);
        expect(lines.join("\n")).toContain(`Active: ${role === "A" ? "A - Senior" : "B - Junior"}`);
        expect(lines.find((line) => line.includes("CURRENT REQUEST"))).toContain(accent);
        expect(lines.find((line) => line.includes("Inspect tools"))).toContain("\x1b[39;49mInspect tools");
        expect(lines.join("\n")).not.toMatch(/\x1b\[(?:[^m]*;)?(?:4[0-8]|10[0-7])(?:;|m)/);
        expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
      }
    }
    app.handleInput("\x1b[17~"); app.handleInput("\r"); await settle();
    const inspector = app.render(80);
    expect(inspector.join("\n")).toContain("READ-ONLY INSPECTOR");
    expect(inspector.find((line) => line.includes(`${role === "A" ? "A - Senior" : "B - Junior"} / run`))).toContain("\x1b[39;49m");
  } finally { await service.dispose(); vi.unstubAllEnvs(); }
});

it("propagates Pi's IME cursor marker only to the focused composer", async () => {
  const { CURSOR_MARKER } = await import("@earendil-works/pi-tui");
  const { app, service } = await setup();
  app.handleInput("界 é 😀");
  expect(app.render(80).join("\n")).toContain(CURSOR_MARKER);
  app.handleInput("\x1b[17~");
  expect(app.render(80).join("\n")).not.toContain(CURSOR_MARKER);
  app.handleInput("\x1b"); app.handleInput("e");
  expect(app.render(80).join("\n")).toContain(CURSOR_MARKER);
  await service.dispose();
});

it("moves from a closed run to its operator-turn parent and folds only that turn", async () => {
  const { app, service } = await setup();
  app.handleInput("\x1b[17~"); app.handleInput("\x1b[H");
  app.handleInput("\x1b[D"); app.handleInput("\x1b[D");
  expect(app.render(80).join("\n")).toContain("> Operator turn: Inspect tools");
  app.handleInput(" ");
  expect(app.render(80).join("\n")).not.toContain("file-0");
  app.handleInput("\r"); await settle();
  expect(app.render(80).join("\n")).toContain("Operator turn");
  await service.dispose();
});

it("shows unread prose while following is paused before a role run completes", async () => {
  const { service } = await setup();
  const workspace = new CurrentWorkspace(service, () => {}); workspace.focus = "transcript";
  const state = service.getState(); workspace.render(state, 80, 17);
  workspace.handleInput("\x1b[H", state);
  workspace.render({ ...state, liveStream: { role: "B", sessionId: "s", startedAt: new Date().toISOString(), text: "New prose while the run is still active" } }, 80, 17);
  expect(workspace.pointer(state)).toContain("1 unread");
  workspace.handleInput("\x1b[F", state);
  expect(workspace.pointer(state)).not.toContain("unread");
  await service.dispose();
});

const chooserState = (state: ReturnType<HeadlessInteractiveCoordinatorService["getState"]>, count = 18) => {
  const timestamp = "2026-10-19T12:00:00Z";
  const outcomes = ["completed", "failed", "cancelled", "interrupted", "timed_out"] as const;
  const turns = Array.from({ length: count }, (_, index) => ({ kind: "turn" as const, id: `past-${index}`, title: `Past ${index} 界 😀 é ${"long title ".repeat(20)}`,
    timestamp, requestIds: [], outcome: { kind: outcomes[index % outcomes.length] ?? "completed", endedAt: timestamp } }));
  return { ...state, history: { ...state.history, records: [...turns, ...state.history.records], warnings: ["Some archives are unavailable."] } };
};

it.each([[80,24], [103,30], [104,30], [105,30], [120,40], [180,50]])("gives the closed request the entire body at %sx%s", async (width, height) => {
  const { service } = await setup();
  try {
    const workspace = new CurrentWorkspace(service, () => {});
    const state = chooserState(service.getState());
    const lines = workspace.render(state, width, height);
    expect(lines).toHaveLength(height);
    expect(lines.every((line) => visibleWidth(line) === width)).toBe(true);
    expect(strip(lines[0] ?? "")).toMatch(/^\+ CURRENT REQUEST/);
    expect(strip(lines.join("\n"))).not.toMatch(/HISTORY|History \/|Request history/);
    workspace.cycle(1, true); expect(workspace.focus).toBe("transcript");
    workspace.cycle(1, true); expect(workspace.focus).toBe("activity");
    workspace.cycle(1, true); expect(workspace.focus).toBe("editor");
  } finally { await service.dispose(); }
});

it("keeps highlights provisional, clamps navigation, and selects Current only on confirmation", async () => {
  const { service } = await setup();
  try {
    const workspace = new CurrentWorkspace(service, () => {});
    const state = chooserState(service.getState());
    const screen = () => strip(workspace.render(state, 120, 30).join("\n"));
    const before = screen();
    workspace.openHistory(state); workspace.openHistory(state);
    workspace.handleInput("g", state); workspace.handleInput("\x1b[A", state);
    expect(screen()).toContain("> Request 1 [completed]");
    workspace.handleInput("d", state); expect(screen()).toContain("> Request 9");
    workspace.handleInput("u", state); expect(screen()).toContain("> Request 1");
    workspace.close(); expect(screen()).toBe(before); expect(workspace.focus).toBe("editor");
    workspace.openHistory(state); workspace.handleInput("g", state); workspace.handleInput("\r", state);
    expect(screen()).toContain("HISTORY REQUEST 1"); expect(screen()).toContain("Paused");
    expect(screen()).toContain("New prompts use current conversation");
    workspace.openHistory(state); expect(screen()).toContain("> Request 1");
    workspace.handleInput("\x1b[F", state); workspace.handleInput("\x1b[B", state);
    expect(screen()).toContain("> Current request");
    workspace.close(); expect(screen()).toContain("HISTORY REQUEST 1");
    workspace.openHistory(state); workspace.handleInput("l", state);
    expect(workspace.historyVisible).toBe(false); expect(screen()).toContain("CURRENT REQUEST"); expect(screen()).toContain("Following");
    const empty = { ...state, history: { ...state.history, currentTurnId: undefined } };
    workspace.openHistory(empty);
    expect(strip(workspace.render(empty, 80, 17).join("\n"))).toContain("> Current conversation · empty");
    workspace.handleInput("\r", empty);
    expect(strip(workspace.render(empty, 80, 17).join("\n"))).toContain("Send a request");
    expect(workspace.historyVisible).toBe(false);
  } finally { await service.dispose(); }
});

it("keeps candidate IDs through progress and requires a new confirmation for a missing request", async () => {
  const { service } = await setup();
  try {
    const workspace = new CurrentWorkspace(service, () => {});
    let state = chooserState(service.getState());
    workspace.render(state, 80, 17); workspace.openHistory(state); workspace.handleInput("g", state); workspace.handleInput("\x1b[B", state);
    state = { ...state, history: { ...state.history, revision: state.history.revision + 1, records: state.history.records.filter((record) => record.id !== "past-0") } };
    expect(strip(workspace.render(state, 80, 17).join("\n"))).toContain("Past 1");
    workspace.handleInput("\r", state);
    expect(strip(workspace.render(state, 80, 17).join("\n"))).toContain("HISTORY REQUEST 1");
    workspace.openHistory(state);
    state = { ...state, history: { ...state.history, records: state.history.records.filter((record) => record.id !== "past-1") } };
    workspace.handleInput("\r", state);
    expect(workspace.historyVisible).toBe(true);
    expect(strip(workspace.render(state, 80, 17).join("\n"))).toContain("Request unavailable");
    workspace.handleInput("\r", state);
    expect(workspace.historyVisible).toBe(false);
    expect(strip(workspace.render(state, 80, 17).join("\n"))).toContain("CURRENT REQUEST");
    workspace.openHistory(state);
    state = { ...state, history: { ...state.history, resetId: "new-conversation", currentTurnId: undefined } };
    workspace.render(state, 80, 17);
    expect(workspace.historyVisible).toBe(false); expect(workspace.focus).toBe("editor");
  } finally { await service.dispose(); }
});

it("preserves paused anchors and folds on dismissal and never reads covered output", async () => {
  const { service } = await setup();
  try {
    const workspace = new CurrentWorkspace(service, () => {});
    const state = { ...service.getState(), liveStream: { role: "B" as const, sessionId: "s", startedAt: "now", text: Array.from({ length: 60 }, (_, i) => `COVERED[${i}]`).join("\n") } };
    const screen = (current = state) => strip(workspace.render(current, 80, 17).join("\n"));
    screen(); workspace.scroll(-7, state); workspace.focus = "transcript";
    const paused = screen();
    workspace.openHistory(state); workspace.handleInput("g", state); workspace.close();
    expect(workspace.focus).toBe("transcript"); expect(screen()).toBe(paused);
    workspace.handleInput("g", state);
    const folded = screen(); expect(folded).not.toContain("file-0");
    workspace.openHistory(state); workspace.close(); expect(screen()).toBe(folded);
    workspace.handleInput(" ", state);
    workspace.followLatest(state); screen(); workspace.openHistory(state);
    const updated = { ...state, history: { ...state.history, revision: state.history.revision + 2 }, liveStream: { ...state.liveStream, text: state.liveStream.text + "\nhidden" } };
    screen(updated); expect(workspace.pointer(updated)).toContain("3 unread");
    workspace.handleInput("g", updated); workspace.handleInput("\x1b[F", updated);
    screen(updated); expect(workspace.pointer(updated)).toContain("3 unread");
    workspace.close(); screen(updated); expect(workspace.pointer(updated)).not.toContain("unread");
    workspace.scroll(-1, updated); workspace.openHistory(updated);
    const later = { ...updated, history: { ...updated.history, revision: updated.history.revision + 1 } };
    screen(later); workspace.close(); screen(later);
    expect(workspace.pointer(later)).toContain("1 unread");
  } finally { await service.dispose(); }
});

it("invalidates deferred inspector loads after navigation and conversation reset", async () => {
  const { service } = await setup();
  try {
    let release: (detail: Awaited<ReturnType<typeof service.loadHistoryDetail>>) => void = () => {};
    vi.spyOn(service, "loadHistoryDetail").mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const workspace = new CurrentWorkspace(service, () => {});
    let state = chooserState(service.getState());
    workspace.render(state, 80, 17); workspace.focusWorkspace(); workspace.inspect("run");
    workspace.close(); workspace.openHistory(state); workspace.handleInput("g", state); workspace.handleInput("\r", state);
    release({ recordId: "run", section: "summary", offset: 0, lines: ["STALE DETAIL"], totalLines: 1 }); await settle();
    expect(workspace.inspector).toBeUndefined();
    expect(strip(workspace.render(state, 80, 17).join("\n"))).toContain("HISTORY REQUEST 1");
    workspace.inspect("run"); state = { ...state, history: { ...state.history, resetId: "reset" } };
    workspace.render(state, 80, 17); release({ recordId: "run", section: "summary", offset: 0, lines: ["STALE DETAIL"], totalLines: 1 }); await settle();
    expect(workspace.inspector).toBeUndefined(); expect(workspace.focus).toBe("editor");
    expect(strip(workspace.render(state, 80, 17).join("\n"))).not.toContain("STALE DETAIL");
  } finally { await service.dispose(); }
});

it.each([[80,24], [120,40]])("routes wheel to the visible chooser after editor/activity resize at %sx%s", async (width, height) => {
  const { app, service, terminal } = await setup();
  try {
    const state = chooserState(service.getState(), 25);
    vi.spyOn(service, "getState").mockReturnValue(state);
    terminal.columns = width; terminal.rows = height;
    app.handleInput("\x1b[200~first\nsecond\nthird\x1b[201~"); app.handleInput("\x1bOQ");
    const screen = () => strip(app.render(terminal.columns).join("\n"));
    const before = screen();
    app.handleInput("\x1bOS"); screen();
    app.handleInput("\x1b[<64;5;3M");
    expect(screen()).toContain("> Request 23");
    const candidate = screen().match(/> Request \d+/)?.[0];
    for (const input of [`\x1b[<64;5;${height}M`, "\x1b[<64;5;2M", "\x1b[<64;1;3M"]) app.handleInput(input);
    expect(screen().match(/> Request \d+/)?.[0]).toBe(candidate);
    terminal.columns = width === 80 ? 120 : 80; terminal.rows = width === 80 ? 40 : 24;
    expect(screen().match(/> Request \d+/)?.[0]).toBe(candidate);
    app.handleInput("\x1b[<64;5;3M"); expect(screen()).toContain("> Request 20");
    app.handleInput("\x1bOS"); terminal.columns = width; terminal.rows = height;
    expect(screen()).toBe(before);
  } finally { await service.dispose(); }
});

it("keeps Current live across a new request and renders every retained outcome", async () => {
  const { service } = await setup();
  try {
    const workspace = new CurrentWorkspace(service, () => {});
    const timestamp = "2026-10-19T12:00:00Z";
    const outcomes: HistoryRecord["outcome"][] = [
      { kind: "running", startedAt: timestamp }, { kind: "waiting_approval", endedAt: timestamp },
      ...(["completed", "failed", "cancelled", "timed_out", "interrupted"] as const).map((kind) => ({ kind, endedAt: timestamp }))
    ];
    let state = service.getState();
    state = { ...state, history: { ...state.history, records: [...outcomes.map((outcome, i) => ({ kind: "turn" as const, id: `outcome-${i}`, title: `Outcome ${i}`, requestIds: [], timestamp, outcome })), ...state.history.records] } };
    workspace.render(state, 80, 17); workspace.openHistory(state); workspace.handleInput("g", state);
    for (const outcome of outcomes) {
      expect(strip(workspace.render(state, 80, 17).join("\n"))).toContain(`[${outcome.kind}]`);
      workspace.handleInput("\x1b[B", state);
    }
    workspace.handleInput("\x1b[F", state);
    state = { ...state, history: { ...state.history, currentTurnId: "next", revision: state.history.revision + 1, records: [...state.history.records,
      { kind: "turn", id: "next", title: "New live request", requestIds: [], timestamp, outcome: { kind: "running", startedAt: timestamp } }] } };
    const open = strip(workspace.render(state, 80, 17).join("\n"));
    expect(open).toContain("> Current request [running]"); expect(open).toContain("New live request");
    workspace.handleInput("\r", state);
    expect(strip(workspace.render(state, 80, 17).join("\n"))).toContain("New live request");
    expect(workspace.historyVisible).toBe(false);
  } finally { await service.dispose(); }
});


it("does not acknowledge live output covered by contextual help", async () => {
  const { service } = await setup();
  try {
    const workspace = new CurrentWorkspace(service, () => {});
    const state = service.getState(); workspace.render(state, 80, 17);
    await service.dispatch({ type: "open_help" });
    const covered = { ...service.getState(), history: { ...state.history, revision: state.history.revision + 1 } };
    workspace.render(covered, 80, 17); expect(workspace.pointer(covered)).toContain("1 unread");
    workspace.render(covered, 120, 30); expect(workspace.pointer(covered)).toContain("1 unread");
    await service.dispatch({ type: "close_modal" });
    const visible = { ...service.getState(), history: covered.history };
    workspace.render(visible, 80, 17); expect(workspace.pointer(visible)).not.toContain("unread");
  } finally { await service.dispose(); }
});

it("restores editor focus and footer on the first frame after history resets", async () => {
  const { CURSOR_MARKER } = await import("@earendil-works/pi-tui");
  const { app, service, emit } = await setup();
  try {
    app.render(80); app.handleInput("saved draft"); app.handleInput("\x1bOS"); app.render(80);
    emit("ui.conversation_reset", {}, { sessionId: "new-conversation" });
    const first = app.render(80).join("\n");
    expect(first).not.toContain("+ Request history");
    expect(first).toContain(CURSOR_MARKER); expect(first).toContain("Enter submit");
    expect(first).toContain("saved draft");
  } finally { await service.dispose(); }
});

it("keeps the visible read baseline when history opens after hidden modal activity", async () => {
  const { service } = await setup();
  try {
    const workspace = new CurrentWorkspace(service, () => {});
    const original = service.getState(); workspace.render(original, 80, 17);
    await service.dispatch({ type: "open_help" });
    const covered = { ...service.getState(), history: { ...original.history, revision: original.history.revision + 2 } };
    workspace.render(covered, 80, 17); expect(workspace.pointer(covered)).toContain("2 unread");
    await service.dispatch({ type: "close_modal" });
    const beforeRender = { ...service.getState(), history: covered.history };
    workspace.openHistory(beforeRender);
    const updated = { ...beforeRender, history: { ...beforeRender.history, revision: original.history.revision + 5 } };
    workspace.render(updated, 80, 17); expect(workspace.pointer(updated)).toContain("5 unread");
  } finally { await service.dispose(); }
});

it("keeps unread activity readable at 80 columns while long tool activity is live", async () => {
  const { app, service, emit } = await setup();
  try {
    app.render(80); app.handleInput("ab"); app.handleInput("\x1b[D"); app.handleInput("\x1bOS");
    emit("pi.tool_execution_start", { toolName: "read", toolCallId: "long-live-call", toolArgs: { path: "long-active-path/".repeat(20) } });
    const lines = strip(app.render(80).join("\n")).split("\n");
    const live = lines.find((line) => line.startsWith("Active: B - Junior"));
    expect(live).toContain("unread, l current"); expect(live).not.toContain("Esc then l");
    app.handleInput("l"); expect(strip(app.render(80).join("\n"))).toContain("Following");
    app.handleInput("\x1be"); app.handleInput("X");
    expect(stripTerminalSequences(app.render(80).join("\n"))).toContain("aXb");
  } finally { await service.dispose(); }
});
