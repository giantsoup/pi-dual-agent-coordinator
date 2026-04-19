import { describe, expect, it } from "vitest";

import {
  applyTransition,
  createEmptyHandoffState
} from "../../src/coordinator/handoff-state-machine.js";
import type { FinalDecisionRecord, HandoffRecord } from "../../src/types/handoff.js";

function record(status: HandoffRecord["status"], iteration: number): HandoffRecord {
  return {
    workflowId: "wf-1",
    handoffId: status === "finalized" ? undefined : `h-${iteration}`,
    iteration,
    status,
    role:
      status === "completed"
        ? "B"
        : status === "repair_requested" || status === "blocked" || status === "capped"
          ? "coordinator"
          : "A",
    sessionId: `${status}-session`,
    timestamp: new Date().toISOString(),
    ...(status === "prepared"
      ? {
          envelope: {
            schemaVersion: 1 as const,
            workflowId: "wf-1",
            handoffId: `h-${iteration}`,
            iteration,
            objective: "Implement feature",
            summary: "Need edits",
            acceptanceCriteria: ["tests pass"],
            relevantPaths: ["src/index.ts"]
          }
        }
      : {}),
    ...(status === "completed"
      ? {
          completion: {
            schemaVersion: 1 as const,
            workflowId: "wf-1",
            handoffId: `h-${iteration}`,
            iteration,
            summary: `Done ${iteration}`,
            changedPaths: ["src/index.ts"]
          }
        }
      : {}),
    ...(status === "finalized"
      ? {
          finalDecision: {
            schemaVersion: 1 as const,
            workflowId: "wf-1",
            iteration,
            decision: "approved",
            summary: "Complete",
            userResponse: "Done",
            changedPaths: ["src/index.ts"]
          } satisfies FinalDecisionRecord
        }
      : {})
  };
}

describe("workflow state machine", () => {
  it("replays multiple iterations and finalization", () => {
    let state = createEmptyHandoffState();
    state = applyTransition(state, record("prepared", 1));
    state = applyTransition(state, { ...record("prepared", 1), status: "delivered", role: "B" });
    state = applyTransition(state, record("completed", 1));
    state = applyTransition(state, record("prepared", 2));
    state = applyTransition(state, { ...record("prepared", 2), status: "delivered", role: "B" });
    state = applyTransition(state, record("completed", 2));
    state = applyTransition(state, record("finalized", 2));

    expect(state.activeWorkflowId).toBeUndefined();
    expect(state.latestWorkflowId).toBe("wf-1");
    expect(state.workflows["wf-1"]?.currentIteration).toBe(2);
    expect(state.workflows["wf-1"]?.status).toBe("completed");
    expect(state.workflows["wf-1"]?.latestCompletion?.summary).toBe("Done 2");
  });

  it("tracks repair requests and blocked termination", () => {
    let state = createEmptyHandoffState();
    state = applyTransition(state, record("prepared", 1));
    state = applyTransition(state, {
      workflowId: "wf-1",
      handoffId: "h-1",
      iteration: 1,
      status: "repair_requested",
      role: "coordinator",
      sessionId: "coord",
      timestamp: new Date().toISOString(),
      details: { reason: "invalid block" }
    });
    state = applyTransition(state, {
      workflowId: "wf-1",
      iteration: 1,
      status: "blocked",
      role: "coordinator",
      sessionId: "coord",
      timestamp: new Date().toISOString(),
      details: { reason: "repair failed" }
    });

    expect(state.workflows["wf-1"]?.repairCount).toBe(1);
    expect(state.workflows["wf-1"]?.status).toBe("blocked");
  });
});
