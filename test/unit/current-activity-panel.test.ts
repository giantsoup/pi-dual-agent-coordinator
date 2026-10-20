import { TuiMainScreen, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { renderCurrentActivity } from "../../src/app/tui/current-activity.js";
import { initialCurrentActivity } from "../../src/app/interactive/current-activity.js";
import { createInitialInteractiveUiState } from "../../src/app/interactive/store.js";
import { CoordinatorTuiApp } from "../../src/app/tui/app.js";
import type { InteractiveCoordinatorService } from "../../src/app/interactive/service.js";
import { MemoryTerminal } from "../helpers/terminal.js";
import type { CoordinatorStatusSnapshot } from "../../src/types/status.js";

const status: CoordinatorStatusSnapshot = { cwd: "/fixture", conversationMode: "planning", phase: "execution", phaseLabel: "Execution", activeRole: "B", activeRoleLabel: "Agent B", activeModelDisplay: "fixture", sessionRoot: "memory", repairCount: 0, maxReviewRounds: 3, runtimes: [], metrics: {} };
const view = { unread: 3, following: false, hidden: true, returnHint: "Esc then l current" };
function setup() {
  const state = createInitialInteractiveUiState(status);
  state.currentActivity = { ...initialCurrentActivity(), action: { kind: "tool_execution", callId: "call", toolName: "bash", label: "running", target: "npm test / 界 é 😀 ".repeat(15), additionalCalls: 1 },
    owner: { kind: "runtime", role: "B", sessionId: "B", runId: "run", turnId: "turn" }, phase: "Execution", model: "Local fixture", startedAt: 0, lastEventAt: 9000,
    recent: [1, 2, 3].map((id) => ({ id: String(id), text: `read result-${id} / completed` })) };
  return state;
}

describe("pinned current activity", () => {
  it.each([[120, 10], [80, 7], [40, 3], [40, 1]])("retains a terminal failure reason at %s columns and %s rows", (width, height) => {
    const state = setup();
    state.currentActivity.action = { kind: "terminal", outcome: "failed", failure: { role: "B", reason: "LM Studio response stalled: no upstream data for 120 seconds." } };
    const lines = renderCurrentActivity(state, width, height, 10000, { unread: 0, following: true, hidden: false, returnHint: "" });
    const screen = stripTerminalSequences(lines.join("\n"));
    expect(screen).toContain("LM Studio response stalled");
    expect(screen).toMatch(/Agent B|B failed/);
    expect(lines.length).toBeLessThanOrEqual(height);
    expect(lines.every(line => visibleWidth(line) <= width)).toBe(true);
    expect(screen).not.toMatch(/Active:|elapsed|last event/);
  });
  it.each([[120, 10], [80, 7], [40, 3]])("keeps action and unread status bounded at %s columns", (width, height) => {
    const state = setup();
    const lines = renderCurrentActivity(state, width, height, 10000, view);
    expect(lines.length).toBeLessThanOrEqual(height);
    expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
    const screen = stripTerminalSequences(lines.join("\n"));
    expect(screen).toContain("Running (+1 running)");
    expect(screen).toContain("3 unread");
    if (width >= 80) { expect(screen).toContain("Local fixture"); expect(screen).toContain("npm test"); }
    if (width === 120) expect(screen).toContain("10s elapsed / last event 1s ago");
  });
  it("only changes the marker and clocks across a timer tick and uses static dumb-terminal output", () => {
    vi.stubEnv("TERM", "xterm-256color");
    const state = setup();
    const first = renderCurrentActivity(state, 120, 10, 10000, view);
    const second = renderCurrentActivity(state, 120, 10, 10500, view);
    expect(first[2]?.replace("●", "○")).toBe(second[2]);
    expect(first[2]).toContain("\x1b[1mRunning");
    vi.stubEnv("TERM", "dumb"); vi.stubEnv("NO_COLOR", "1");
    try {
      expect(renderCurrentActivity(state, 120, 10, 10000, view)[2]).toBe(renderCurrentActivity(state, 120, 10, 10500, view)[2]);
      expect(renderCurrentActivity(state, 120, 10, 10000, view).join("\n")).not.toMatch(/\x1b|●|○/);
    } finally { vi.unstubAllEnvs(); }
  });
  it.each([[120,80],[120,40],[80,24],[40,12]])("retains the panel, draft and cursor through body views and resizing at %sx%s", (width, height) => {
    let state = setup();
    const terminal = new MemoryTerminal(); terminal.columns = width; terminal.rows = height;
    const service: InteractiveCoordinatorService = { getState: () => state, start: async () => {}, dispose: async () => {}, dispatch: vi.fn(async () => {}), subscribeState: () => () => {}, subscribeUiEvents: () => () => {} };
    const app = new CoordinatorTuiApp(new TuiMainScreen(terminal), terminal, service, { onExit() {} }); app.focused = true;
    app.handleInput("界 draft"); app.handleInput("\x1b[D");
    for (const modal of ["none", "help", "status", "none"] as const) {
      state = { ...state, modal: modal === "none" ? { kind: "none" } : { kind: modal, title: modal, content: "Body view\n".repeat(30), format: "text", createdAt: modal } };
      const lines = app.render(width);
      expect(lines).toHaveLength(height);
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
      expect(stripTerminalSequences(lines.join("\n"))).toContain("Current activity");
      expect(stripTerminalSequences(lines.join("\n"))).toContain("Running");
      expect(stripTerminalSequences(lines.join("\n"))).toContain("界 draft");
      expect(stripTerminalSequences(lines.at(-2) ?? "")).toMatch(/Esc/);
    }
    app.handleInput("X"); expect(stripTerminalSequences(app.render(width).join("\n"))).toContain("界 drafXt");
    app.handleInput("\x1b"); app.render(width); // controls cover the narrative
    expect(stripTerminalSequences(app.render(width).join("\n"))).toContain("Running");
  });
});

it("preserves the measured tall-draft viewport when browsing removes editor focus", () => {
  const state = setup();
  const terminal = new MemoryTerminal(); terminal.columns = 40; terminal.rows = 12;
  const service: InteractiveCoordinatorService = { getState: () => state, start: async () => {}, dispose: async () => {}, dispatch: vi.fn(async () => {}), subscribeState: () => () => {}, subscribeUiEvents: () => () => {} };
  const app = new CoordinatorTuiApp(new TuiMainScreen(terminal), terminal, service, { onExit() {} }); app.focused = true;
  app.handleInput("\x1b[200~one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\x1b[201~");
  const draft = () => app.render(40).slice(4, 10).map(stripTerminalSequences);
  const before = draft();
  expect(before.join("\n")).toContain("eight");
  app.handleInput("\x1bOS"); expect(draft()).toEqual(before);
  app.handleInput("\x1b"); expect(draft()).toEqual(before);
  expect(app.render(40).some((line) => line.includes("\x1b_pi:c\x07"))).toBe(true);
});
