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
const liveView = { unread: 0, following: true, hidden: false, returnHint: "" };
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
    expect(screen).toMatch(/Agent B|B failed|B - Junior/);
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
    expect(first[1]?.replace("●", "○")).toBe(second[1]);
    expect(first[1]).toContain("\x1b[1mRunning");
    vi.stubEnv("TERM", "dumb"); vi.stubEnv("NO_COLOR", "1");
    try {
      expect(renderCurrentActivity(state, 120, 10, 10000, view)[1]).toBe(renderCurrentActivity(state, 120, 10, 10500, view)[1]);
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
      expect(stripTerminalSequences(lines.join("\n"))).toContain(width >= 80 ? "Current /" : "Current activity");
      expect(stripTerminalSequences(lines.join("\n"))).toContain("Running");
      expect(stripTerminalSequences(lines.join("\n"))).toContain("界 draft");
      expect(stripTerminalSequences(lines.at(-2) ?? "")).toMatch(/Esc/);
    }
    app.handleInput("X"); expect(stripTerminalSequences(app.render(width).join("\n"))).toContain("界 drafXt");
    app.handleInput("\x1b"); app.render(width); // controls cover the narrative
    expect(stripTerminalSequences(app.render(width).join("\n"))).toContain("Running");
  });
});

it.each(([[120, 8, "thinking"], [80, 7, "thinking"], [120, 8, "cancelling"], [80, 7, "cancelling"], [120, 8, "tool"], [80, 7, "tool"]] as const)
  .flatMap(([width, height, mode]) => (["A", "B"] as const).map((role) => ({ width, height, mode, role }))))("separates the current action and clock from role-colored recent calls for $role at $width columns, $height rows, $mode", ({ width, height, mode, role }) => {
  vi.stubEnv("TERM", "xterm-256color");
  vi.stubEnv("NO_COLOR", undefined);
  try {
    const state = setup();
    state.currentActivity.owner = { kind: "runtime", role, sessionId: role, runId: "run", turnId: "turn" };
    if (mode !== "tool") state.currentActivity.action = { kind: mode };
    state.currentActivity.model = "Local fixture (lm-studio/fixture)";
    state.history = { revision: 1, warnings: [], currentTurnId: "turn", records: [
      { kind: "run", id: "run", parentId: "turn", role: "B", sessionId: "B", phase: "Execution", title: "Execution", timestamp: "2026-10-21T00:00:00Z", outcome: { kind: "running", startedAt: "2026-10-21T00:00:00Z" } },
      ...[1, 2, 3, 4].map((id) => ({ kind: "tool" as const, id: String(id), parentId: "run", role: "B" as const, sessionId: "B", callId: String(id), toolName: "find", request: "{}", preview: "", title: "find /fixture/node_modules", timestamp: `2026-10-21T00:00:0${id}Z`, outcome: id === 1 || id === 3 ? { kind: "failed" as const, endedAt: `2026-10-21T00:00:0${id}Z` } : { kind: "completed" as const, endedAt: `2026-10-21T00:00:0${id}Z` } })),
      { kind: "tool", id: "active", parentId: "run", role: "B", sessionId: "B", callId: "active", toolName: "read", request: "{}", preview: "", title: "read current.txt", timestamp: "2026-10-21T00:00:05Z", outcome: { kind: "running", startedAt: "2026-10-21T00:00:05Z" } },
      { kind: "tool", id: "old", parentId: "other-run", role: "A", sessionId: "A", callId: "old", toolName: "bash", request: "{}", preview: "", title: "old failed call", timestamp: "2026-10-21T00:00:06Z", outcome: { kind: "failed", endedAt: "2026-10-21T00:00:06Z" } }
    ] };
    const lines = renderCurrentActivity(state, width, height, 10000, liveView);
    const plain = lines.map(stripTerminalSequences);
    const recent = plain.findIndex((line) => line.includes("3 recent calls"));
    expect(plain[0]).toContain(`Current / ${role === "A" ? "A - Senior" : "B - Junior"} / Local fixture / ${mode === "cancelling" ? "Cleanup" : "Execution"}`);
    expect(plain[0]).not.toContain("lm-studio/fixture");
    const label = mode === "thinking" ? "Thinking" : mode === "cancelling" ? "Cancelling" : "Running";
    expect(plain[1]).toContain(label);
    expect(lines[1]).toContain(`\x1b[1m${label}`);
    expect(recent).toBeGreaterThan(2);
    expect(plain[recent - 1]?.replaceAll("|", "").trim()).toBe("");
    expect(plain[recent - 2]).toContain("10s elapsed / last event 1s ago");
    expect(lines[recent - 2]).toContain("\x1b[37;");
    expect(lines[recent]).toContain(`\x1b[${role === "A" ? "36" : "33"};49m3 recent calls`);
    expect(plain[recent]).toContain("3 recent calls / 1 failed: find node_modules");
    expect(plain.join("\n")).not.toContain("old failed call");
    expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
    const crowded = renderCurrentActivity(state, width, 5, 10000, liveView).map(stripTerminalSequences).join("\n");
    expect(crowded).toContain(label);
    expect(crowded).not.toContain("recent call");
    vi.stubEnv("NO_COLOR", "1");
    expect(renderCurrentActivity(state, width, height, 10000, liveView).join("\n")).not.toMatch(/\x1b\[(?:33|36|37);/);
    vi.stubEnv("NO_COLOR", undefined);
    vi.stubEnv("TERM", "dumb");
    expect(renderCurrentActivity(state, width, height, 10000, liveView).join("\n")).not.toContain("\x1b");
  } finally { vi.unstubAllEnvs(); }
});

it.each([0, 1, 2, 3, 4, 20])("keeps borders within even a %s-column render budget", (width) => {
  const lines = renderCurrentActivity(setup(), width, 8, 10000, liveView);
  expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
});

it.each(["running", "cancelling"] as const)("keeps cancellation visible during %s even with a workflow notification", (kind) => {
  const state = setup();
  state.operation = { kind };
  state.notification = { id: "started", level: "info", scope: "workflow", code: "started", message: "Execution started for this project.", createdAt: "2026-10-21T00:00:00Z" };
  const terminal = new MemoryTerminal();
  const service: InteractiveCoordinatorService = { getState: () => state, start: async () => {}, dispose: async () => {}, dispatch: vi.fn(async () => {}), subscribeState: () => () => {}, subscribeUiEvents: () => () => {} };
  const app = new CoordinatorTuiApp(new TuiMainScreen(terminal), terminal, service, { onExit() {} });
  for (const [width, height] of [[120, 40], [80, 24], [40, 12]]) {
    terminal.columns = width ?? 80; terminal.rows = height ?? 24;
    expect(stripTerminalSequences(app.render(terminal.columns).at(-1) ?? "")).toContain("Ctrl+C cancel");
    state.modal = { kind: "help", title: "Help", content: "Help text", format: "text", createdAt: "help" };
    expect(stripTerminalSequences(app.render(terminal.columns).at(-1) ?? "")).toContain("Ctrl+C cancel");
    state.modal = { kind: "none" };
  }
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
