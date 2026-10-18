import { describe, expect, it, vi } from "vitest";
import { TuiMainScreen, visibleWidth } from "@earendil-works/pi-tui";
import { ModelPicker } from "../../src/app/tui/model-picker.js";
import { CoordinatorTuiApp } from "../../src/app/tui/app.js";
import { HeadlessInteractiveCoordinatorService } from "../../src/app/interactive/service.js";
import { gptModelChoices } from "../../src/security/models.js";
import { LocalModelSwitchError } from "../../src/security/lm-studio.js";
import type { ModelPickerCatalog, ModelSwitchProgress } from "../../src/types/model-selection.js";
import type { CoordinatorStatusSnapshot } from "../../src/types/status.js";
import type { SupportedThinkingLevel } from "../../src/runtime/create-role-runtime.js";
import { MemoryTerminal } from "../helpers/terminal.js";

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));
const aModels = gptModelChoices.map((model) => ({ canonical: `openai/${model.id}`, name: model.name, description: model.description }));
const bModels = [
  { canonical: "lm-studio/qwen3.6-35b-a3b", name: "Qwen3.6 35B A3B", description: "21 GB", loaded: true },
  { canonical: "lm-studio/qwen3-coder-next", name: "Qwen3 Coder Next", description: "79 GB", loaded: false }
];
async function setup() {
  let status: CoordinatorStatusSnapshot = { cwd: "/tmp/model-picker", conversationMode: "planning", phase: "planning", phaseLabel: "Planning", activeRole: "A", activeRoleLabel: "Agent A", activeModelDisplay: "GPT-6 Luna", sessionRoot: "memory", repairCount: 0, maxReviewRounds: 3, metrics: {},
    runtimes: ["A", "B"].map((role) => ({ role: role === "A" ? "A" : "B", sessionId: role, cwd: "/tmp/model-picker", thinking: role === "A" ? "high" : "off", healthy: true, modelDisplay: "fixture", modelName: role === "A" ? "GPT-6 Luna" : "Qwen3.6 35B A3B", modelCanonical: role === "A" ? "openai/gpt-6-luna" : bModels[0]?.canonical })) };
  let release = () => {};
  let cancelled = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const configure = vi.fn(async (role: "A" | "B", input: { model?: string; thinking?: SupportedThinkingLevel; save: boolean }, report?: (progress: ModelSwitchProgress) => void) => {
    if (role === "B") {
      report?.({ phase: "loading", message: "Loading Qwen3 Coder Next…" }); await gate;
      if (cancelled) throw new LocalModelSwitchError("Model switch cancelled. Previous model restored.", true, "restored");
    }
    const choice = [...aModels, ...bModels].find((model) => model.canonical === input.model);
    status = { ...status, runtimes: status.runtimes.map((runtime) => runtime.role === role ? { ...runtime, modelCanonical: input.model, modelName: choice?.name, thinking: input.thinking ?? "off" } : runtime) };
  });
  const submit = vi.fn(async () => ({ mode: "planning" as const, userResponse: "Unused" }));
  const coordinator = { start: async () => {}, dispose: async () => {}, getStatus: () => status, submitUserInput: submit, approvePendingPlan: submit, discardPendingPlan() {}, getSessions: () => [], getLastHandoff: async () => ({}), subscribeEvents: () => () => {}, subscribeRuntimeUiEvents: () => () => {}, replaceRuntime: async () => {}, configureRole: configure,
    getModelPickerCatalog: async (role: "A" | "B"): Promise<ModelPickerCatalog> => ({ role, models: role === "A" ? aModels : bModels, currentModel: status.runtimes.find((runtime) => runtime.role === role)?.modelCanonical, currentThinking: status.runtimes.find((runtime) => runtime.role === role)?.thinking }),
    cancelActive: vi.fn(async () => { cancelled = true; release(); }) };
  const service = new HeadlessInteractiveCoordinatorService(coordinator); await service.start();
  const terminal = new MemoryTerminal(); const tui = new TuiMainScreen(terminal);
  const app = new CoordinatorTuiApp(tui, terminal, service, { onExit() {} }); app.focused = true;
  tui.addChild(app); tui.setFocus(app); tui.start();
  return { app, service, tui, terminal, configure, coordinator, release };
}
describe("model selection controls", () => {
  it("accepts a role key before the opened picker receives its first render", async () => {
    const { app, service, tui } = await setup();
    try {
      app.render(80);
      await service.dispatch({ type: "open_models", role: "A" });
      expect(service.getState().modal).toMatchObject({ kind: "model_picker", catalog: { role: "A" } });
      app.handleInput("b");
      await settle();
      expect(service.getState().modal).toMatchObject({ kind: "model_picker", catalog: { role: "B" } });
    } finally { tui.stop(); await service.dispose(); }
  });
  it.each([[76, 17], [96, 19]])("shows all GPT and reasoning options within %sx%s cells", (width, height) => {
    const picker = new ModelPicker({ role: "A", models: aModels, currentModel: "openai/gpt-6-luna", currentThinking: "high" });
    const lines = picker.render(width, height, false, false);
    const text = lines.join("\n");
    for (const value of ["GPT-6.1 Sol", "GPT-5.6 Terra", "GPT-6 Luna", "Low", "Medium", "[High]", "Remember", "←/→ reasoning", "Enter apply", "Esc back"]) expect(text).toContain(value);
    expect(lines.length).toBeLessThanOrEqual(height);
    expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
    picker.handleInput("\x1b[H", false); picker.handleInput("\x1b[D", false);
    expect(picker.handleInput("\r", false)).toMatchObject({ model: "openai/gpt-6.1-sol", thinking: "medium", save: true });
    picker.handleInput("s", false);
    expect(picker.handleInput("\r", false)).toMatchObject({ save: false });
    expect(picker.handleInput("\r", true)).toBeUndefined();
  });
  it("opens via F3, keeps model/reasoning through help and resize, and preserves the draft", async () => {
    const { app, service, terminal, tui, configure, coordinator } = await setup();
    try {
      app.handleInput("precious model draft"); app.handleInput("\x1bOR"); await settle(); app.render(80);
      expect(service.getState().modal.kind).toBe("model_picker");
      app.handleInput("\x1b[H"); app.handleInput("\x1b[D");
      app.handleInput("\x1bOP"); app.render(80); app.handleInput("\x1b"); app.render(80);
      terminal.columns = 120; terminal.rows = 40; app.render(120);
      app.handleInput("\r"); await settle();
      expect(configure).toHaveBeenCalledWith("A", { model: "openai/gpt-6.1-sol", thinking: "medium", save: true }, expect.any(Function));
      expect(service.getState().notification?.message).toContain("GPT-6.1 Sol / medium reasoning");
      expect(app.render(120).join("\n")).toContain("precious model draft");
      expect(coordinator.submitUserInput).not.toHaveBeenCalled();
    } finally { tui.stop(); await service.dispose(); }
  });
  it.each([false, true])("shows a small loading view and %s cancellation feedback", async (cancel) => {
    const { app, service, terminal, tui, coordinator, release } = await setup();
    try {
      app.handleInput("draft survives loading"); app.handleInput("\x1bOR"); await settle(); app.render(80);
      app.handleInput("b"); await settle(); app.render(80);
      app.handleInput("\x1b[B"); app.handleInput("\r"); await settle();
      expect(service.getState().modal).toMatchObject({ kind: "model_loading", progress: { phase: "loading" } });
      expect(terminal.output).toContain("Loading Qwen3 Coder Next");
      app.handleInput("ignored keys");
      if (cancel) app.handleInput("\x1b"); else release();
      await settle(); await settle();
      expect(service.getState().notification?.code).toBe(cancel ? "runtime.configuration_cancelled" : "runtime.configured");
      expect(service.getState().status.runtimes.find((runtime) => runtime.role === "B")?.modelCanonical).toBe(cancel ? bModels[0]?.canonical : bModels[1]?.canonical);
      expect(app.render(80).join("\n")).toContain("draft survives loading");
      expect(coordinator.submitUserInput).not.toHaveBeenCalled();
    } finally { release(); tui.stop(); await service.dispose(); }
  });
});

it("offers Qwen3.8 reasoning in the B picker and constrains other local models", () => {
  const qwen = { canonical: "lm-studio/qwen/qwen3.8-27b", name: "Qwen3.8", description: "ready", loaded: true,
    thinkingLevels: ["off", "low", "medium", "xhigh"] satisfies SupportedThinkingLevel[], defaultThinking: "xhigh" as const };
  const picker = new ModelPicker({ role: "B", models: [qwen, ...bModels], currentModel: qwen.canonical, currentThinking: "xhigh" });
  const lines = picker.render(80, 24, false, false);
  expect(lines.join("\n")).toContain("[Xhigh]");
  expect(lines.length).toBeLessThanOrEqual(24);
  expect(lines.every(line => visibleWidth(line) <= 80)).toBe(true);
  expect(picker.handleInput("\r", false)).toMatchObject({ role: "B", thinking: "xhigh", save: true });
  picker.handleInput("\x1b[D", false);
  expect(picker.handleInput("\r", false)).toMatchObject({ thinking: "medium" });
  picker.handleInput("\x1b[B", false);
  expect(picker.handleInput("\r", false)).toMatchObject({ thinking: "off" });
  picker.handleInput("\x1b[A", false);
  expect(picker.handleInput("\r", false)).toMatchObject({ thinking: "xhigh" });
});
