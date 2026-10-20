import { describe, expect, it } from "vitest";

import {
  buildHelpText,
  buildPromptLabel,
  buildStartupBanner,
  ReplProgressRenderer
} from "../../src/app/repl-progress.js";
import type { CoordinatorStatusSnapshot } from "../../src/types/status.js";
import { createInitialInteractiveUiState } from "../../src/app/interactive/store.js";
import type { CurrentActivity } from "../../src/types/ui.js";

describe("repl progress renderer", () => {
  it("renders the startup banner and prompt with model displays", () => {
    const status = createStatus();

    expect(buildStartupBanner(status, false)).toContain("Project: /tmp/project");
    expect(buildStartupBanner(status, false)).toContain("Agent A model: GPT-5.4 (openai/gpt-5.4)");
    expect(buildStartupBanner(status, false)).toContain("waits for /approve");
    expect(buildStartupBanner(status, false)).toContain("Modes switch automatically");
    expect(buildPromptLabel(status)).toBe(
      "pi-dual [Planning · GPT-5.4 (openai/gpt-5.4)]> "
    );
    expect(buildHelpText(false)).toContain("/help /status /approve /discard /sessions /handoff /cancel /new [A|B] /switch A|B /quit");
  });

  it("renders the shared observed actions once without per-delta noise or inferred intentions", () => {
    const { renderer, stderrWrites, stdoutWrites } = createRenderer();
    const state = createInitialInteractiveUiState(createStatus());
    const emit = (activity: CurrentActivity) => { state.currentActivity = activity; renderer.handleUiEvent({ type: "state_changed", state }); };
    const activity: CurrentActivity = { action: { kind: "thinking" }, owner: { kind: "runtime", role: "A", sessionId: "A", runId: "run", turnId: "turn" }, phase: "Planning", model: "Fixture A", startedAt: 0, lastEventAt: 0, recent: [] };
    emit(activity); emit({ ...activity, lastEventAt: 100 });
    emit({ ...activity, action: { kind: "writing" } });
    const tool: CurrentActivity = { ...activity, action: { kind: "tool_execution", toolName: "read", callId: "one", label: "reading", target: "src/index.ts", additionalCalls: 0 } };
    emit(tool); emit({ ...tool, lastEventAt: 200 });
    emit({ ...tool, action: { kind: "tool_execution", toolName: "read", callId: "two", label: "reading", additionalCalls: 0 } });
    emit({ ...activity, action: { kind: "cancelling" }, owner: { kind: "coordinator" } });
    emit({ ...activity, action: { kind: "terminal", outcome: "cancelled" }, owner: { kind: "coordinator" } });
    renderer.beforeTextOutput(); renderer.beforeTextOutput();
    expect(stderrWrites).toEqual([
      "Agent A / Fixture A / Planning: Thinking\n",
      "Agent A / Fixture A / Planning: Writing a response\n",
      "Agent A / Fixture A / Planning: Reading src/index.ts\n",
      "Agent A / Fixture A / Planning: Reading\n",
      "Coordinator / Planning: Cancelling; waiting for runtime cleanup\n",
      "Coordinator / Planning: Request cancelled\n"
    ]);
    expect(stdoutWrites).toEqual(["\n"]);
    expect(stderrWrites.join("")).not.toMatch(/reason:|gathering|inspecting/);
  });

  it("reports a new role, model and phase directly from the shared owner", () => {
    const { renderer, stderrWrites } = createRenderer();
    const state = createInitialInteractiveUiState(createStatus());
    state.currentActivity = { action: { kind: "waiting", reason: "provider" }, owner: { kind: "runtime", role: "B", sessionId: "B", runId: "b", turnId: "turn" }, phase: "Revision", model: "Local B", recent: [] };
    renderer.handleUiEvent({ type: "state_changed", state });
    expect(stderrWrites).toEqual(["Agent B / Local B / Revision: Waiting for model response\n"]);
  });
});

function createRenderer(
  statusRef: { current: CoordinatorStatusSnapshot } = { current: createStatus() }
): {
  renderer: ReplProgressRenderer;
  stderrWrites: string[];
  stdoutWrites: string[];
  statusRef: { current: CoordinatorStatusSnapshot };
} {
  const stderrWrites: string[] = [];
  const stdoutWrites: string[] = [];
  const renderer = new ReplProgressRenderer({
    stdout: {
      write: (chunk: string) => {
        stdoutWrites.push(chunk);
        return true;
      }
    },
    stderr: {
      write: (chunk: string) => {
        stderrWrites.push(chunk);
        return true;
      }
    },
    isTTY: false,
    getStatus: () => statusRef.current
  });

  return { renderer, stderrWrites, stdoutWrites, statusRef };
}

function createStatus(): CoordinatorStatusSnapshot {
  return {
    cwd: "/tmp/project",
    conversationMode: "planning",
    phase: "planning",
    phaseLabel: "Planning",
    activeRole: "A",
    activeRoleLabel: "Agent A",
    activeModelName: "GPT-5.4",
    activeModelProvider: "openai",
    activeModelId: "gpt-5.4",
    activeModelCanonical: "openai/gpt-5.4",
    activeModelDisplay: "GPT-5.4 (openai/gpt-5.4)",
    sessionRoot: "/tmp/sessions",
    pendingPlanReady: false,
    repairCount: 0,
    maxReviewRounds: 3,
    runtimes: [
      {
        role: "A",
        healthy: true,
        sessionId: "A-session-1",
        sessionFile: "/tmp/sessions/A.jsonl",
        cwd: "/tmp/project",
        modelName: "GPT-5.4",
        modelProvider: "openai",
        modelId: "gpt-5.4",
        modelCanonical: "openai/gpt-5.4",
        modelDisplay: "GPT-5.4 (openai/gpt-5.4)",
        thinking: "high"
      },
      {
        role: "B",
        healthy: true,
        sessionId: "B-session-1",
        sessionFile: "/tmp/sessions/B.jsonl",
        cwd: "/tmp/project",
        modelName: "Qwen3 Coder Next",
        modelProvider: "local-qwen",
        modelId: "qwen3-coder-next",
        modelCanonical: "local-qwen/qwen3-coder-next",
        modelDisplay: "Qwen3 Coder Next (local-qwen/qwen3-coder-next)",
        thinking: "off"
      }
    ],
    metrics: {}
  };
}
