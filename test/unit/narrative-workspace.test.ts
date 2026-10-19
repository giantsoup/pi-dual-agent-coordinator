import { describe, expect, it, vi } from "vitest";
import { CurrentWorkspace } from "../../src/app/tui/workspace.js";
import { HeadlessInteractiveCoordinatorService } from "../../src/app/interactive/service.js";
import type { RuntimeUiBridgeEvent } from "../../src/coordinator/bind-runtime-events.js";
import type { NormalizedTelemetryEvent } from "../../src/types/telemetry.js";
import type { CoordinatorStatusSnapshot } from "../../src/types/status.js";

describe("request narrative", () => {
  it("retains both agents' responses with tool calls collapsed beneath them", async () => {
    let telemetry = (_event: NormalizedTelemetryEvent) => {};
    let output = (_event: RuntimeUiBridgeEvent) => {};
    const status: CoordinatorStatusSnapshot = { operation: { kind: "running" }, cwd: "/fixture", conversationMode: "planning", phase: "execution", phaseLabel: "Execution", activeRole: "B", activeRoleLabel: "Agent B", activeModelDisplay: "fixture", sessionRoot: "memory", repairCount: 0, maxReviewRounds: 3, runtimes: [], metrics: {} };
    const service = new HeadlessInteractiveCoordinatorService({
      start: async () => {}, dispose: async () => {}, getStatus: () => status,
      submitUserInput: vi.fn(), approvePendingPlan: vi.fn(), discardPendingPlan() {},
      getSessions: () => [], getLastHandoff: async () => ({}), replaceRuntime: vi.fn(),
      subscribeEvents: (listener) => { telemetry = listener; return () => {}; },
      subscribeRuntimeUiEvents: (listener) => { output = listener; return () => {}; }
    });
    try {
      await service.start();
      const emit = (eventType: string, role: "A" | "B", runId: string, details: Record<string, unknown> = {}) => telemetry({ eventType, role, runId, sessionId: role, operatorTurnId: "turn", timestamp: new Date().toISOString(), details });
      emit("ui.turn_started", "A", "a", { objective: "Fix calculator" });
      emit("runtime.run_started", "A", "a");
      output({ type: "assistant_text_delta", role: "A", sessionId: "A", messageId: "a1", timestamp: new Date().toISOString(), delta: "I found the arithmetic bug." });
      emit("pi.tool_execution_start", "A", "a", { toolName: "read", toolCallId: "read1", toolArgs: { path: "arithmetic.js" } });
      emit("pi.tool_execution_end", "A", "a", { toolName: "read", toolCallId: "read1", isError: false });
      output({ type: "assistant_turn_committed", role: "A", sessionId: "A", messageId: "a1", timestamp: new Date().toISOString(), text: "I found the arithmetic bug." });
      emit("runtime.run_finished", "A", "a", { outcome: "completed" });
      emit("runtime.run_started", "B", "b", { provenance: "coordinator_handoff" });
      output({ type: "assistant_text_delta", role: "B", sessionId: "B", messageId: "b1", timestamp: new Date().toISOString(), delta: "I am fixing the arithmetic and adding coverage." });
      emit("pi.tool_execution_start", "B", "b", { toolName: "edit", toolCallId: "edit1", toolArgs: { path: "arithmetic.js" } });
      const workspace = new CurrentWorkspace(service, () => {});
      const screen = () => workspace.render(service.getState(), 120, 40).join("\n");
      await vi.waitFor(() => expect(screen()).toContain("I found the arithmetic bug."));
      expect(screen()).toContain("I am fixing the arithmetic and adding coverage.");
      expect(screen()).toContain("1 tool call");
      expect(screen()).not.toContain("read arithmetic.js");
      expect(screen()).not.toContain("edit arithmetic.js");
      output({ type: "assistant_text_delta", role: "A", sessionId: "A", runId: "a", messageId: "late", timestamp: new Date().toISOString(), delta: "STALE_RESPONSE" });
      expect(service.getState().liveStream?.text).toBe("I am fixing the arithmetic and adding coverage.");
      expect(screen()).not.toContain("STALE_RESPONSE");
      emit("runtime.run_started", "A", "check", { provenance: "execution_check_in" });
      output({ type: "assistant_turn_committed", role: "A", sessionId: "A", runId: "check", messageId: "check1", timestamp: new Date().toISOString(), text: "The current approach is on scope." });
      emit("runtime.run_finished", "A", "check", { outcome: "completed" });
      output({ type: "assistant_text_delta", role: "B", sessionId: "B", runId: "b", messageId: "b2", timestamp: new Date().toISOString(), delta: "I will finish the remaining verification." });
      expect(screen()).toMatch(/current approach is on scope[\s\S]*B - Junior \| Execution continued[\s\S]*remaining verification/);
    } finally { await service.dispose(); }
  });
});
