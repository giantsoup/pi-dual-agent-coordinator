import { describe, expect, it } from "vitest";

import {
  applyTransition,
  createEmptyHandoffState
} from "../../src/coordinator/handoff-state-machine.js";
import { isDuplicateRecord } from "../../src/coordinator/duplicate-suppression.js";
import type { HandoffRecord } from "../../src/types/handoff.js";

function record(status: HandoffRecord["status"]): HandoffRecord {
  return {
    handoffId: "h-1",
    status,
    role: status === "completed" ? "B" : "A",
    sessionId: "session-1",
    timestamp: new Date().toISOString()
  };
}

describe("handoff state machine", () => {
  it("allows monotonic transitions", () => {
    let state = createEmptyHandoffState();
    state = applyTransition(state, record("prepared"));
    state = applyTransition(state, record("delivered"));
    state = applyTransition(state, record("completed"));

    expect(state.lastCompleted?.handoffId).toBe("h-1");
    expect(state.activeHandoffId).toBeUndefined();
  });

  it("suppresses duplicate records", () => {
    const state = applyTransition(createEmptyHandoffState(), record("prepared"));
    expect(isDuplicateRecord(state, record("prepared"))).toBe(true);
    expect(isDuplicateRecord(state, record("delivered"))).toBe(false);
  });
});
