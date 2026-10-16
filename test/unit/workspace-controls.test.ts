import { TUI, visibleWidth } from "@mariozechner/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { CoordinatorTuiApp } from "../../src/app/tui/app.js";
import { HeadlessInteractiveCoordinatorService } from "../../src/app/interactive/service.js";
import { MemoryTerminal } from "../helpers/terminal.js";
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
  const terminal = new MemoryTerminal(); const tui = new TUI(terminal);
  const app = new CoordinatorTuiApp(tui, terminal, service, { onExit() {} }); app.focused = true;
  return { app, service, terminal, coordinator, status, emit };
}
const strip = (text: string) => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
describe("selected workspace through shared history service", () => {
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
      expect(lines.join("\n")).toContain("F1 help");
    }
    expect(app.render(80).join("\n")).toContain("precious draft");
    expect(app.render(80).join("\n")).toContain("Active: A - Senior");
    expect(app.render(80).join("\n")).toContain("B - Junior");
    app.handleInput("\x1b");
    expect(app.render(80).join("\n")).toContain("file-0");
    expect(coordinator.replaceRuntime).not.toHaveBeenCalled(); expect(coordinator.submitUserInput).not.toHaveBeenCalled(); expect(coordinator.discardPendingPlan).not.toHaveBeenCalled();
    await service.dispose();
  });
  it("opens the narrow history control and folds one turn, run and tool independently", async () => {
    const { app, service, emit } = await setup();
    emit("ui.turn_started", { objective: "Next operator turn" }, { operatorTurnId: "next-turn" });
    app.handleInput("\x1b[17~"); app.handleInput("\x1b[17~");
    expect(app.render(80).join("\n")).toContain("History / 1 past turns [focus]");
    app.handleInput("\r"); app.handleInput(" "); app.handleInput("\x1b[B"); app.handleInput(" "); app.handleInput("\x1b[B"); app.handleInput("\r"); await settle();
    expect(app.render(80).join("\n")).toContain("READ-ONLY INSPECTOR");
    app.handleInput("\x1b"); expect(app.render(80).join("\n")).toContain("HISTORY [focus]");
    app.handleInput("\x1b[F"); expect(app.render(80).join("\n")).toContain("CURRENT TURN");
    await service.dispose();
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
    workspace.inspect(tool.id); await settle(); workspace.handleInput("3", service.getState(), false); await settle();
    workspace.render(service.getState(), 80, 17);
    for (let i = 0; i < 25; i++) { workspace.handleInput("\x1b[6~", service.getState(), false); await settle(); }
    const lines = workspace.render(service.getState(), 80, 17).join("\n");
    expect(lines).toMatch(/retained line (1[2-9]\d|[23]\d\d)/);
    workspace.close(); workspace.focus = "editor"; expect(workspace.handleInput("3", service.getState(), false)).toBe(false);
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
        expect(lines.find((line) => line.includes("CURRENT TURN"))).toContain(accent);
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
  const { CURSOR_MARKER } = await import("@mariozechner/pi-tui");
  const { app, service } = await setup();
  app.handleInput("界 é 😀");
  expect(app.render(80).join("\n")).toContain(CURSOR_MARKER);
  app.handleInput("\x1b[17~");
  expect(app.render(80).join("\n")).not.toContain(CURSOR_MARKER);
  app.handleInput("\x1b");
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
  workspace.handleInput("\x1b[H", state, false);
  workspace.render({ ...state, liveStream: { role: "B", sessionId: "s", startedAt: new Date().toISOString(), text: "New prose while the run is still active" } }, 80, 17);
  expect(workspace.pointer(state)).toContain("1 unread");
  workspace.handleInput("\x1b[F", state, false);
  expect(workspace.pointer(state)).not.toContain("unread");
  await service.dispose();
});
