import { describe, expect, it } from "vitest";

import { selectLastValidatedRecord } from "../../src/coordinator/coordinator.js";
import type { HandoffState } from "../../src/types/handoff.js";

describe("coordinator handoff selection", () => {
  it("prefers the newest persisted record as the last validated handoff", () => {
    const state: HandoffState = {
      lastPrepared: {
        handoffId: "h-1",
        status: "prepared",
        role: "A",
        sessionId: "a-1",
        timestamp: "2026-04-18T20:00:00.000Z"
      },
      lastDelivered: {
        handoffId: "h-1",
        status: "delivered",
        role: "B",
        sessionId: "b-1",
        timestamp: "2026-04-18T20:00:01.000Z"
      },
      lastCompleted: {
        handoffId: "h-1",
        status: "completed",
        role: "B",
        sessionId: "b-1",
        timestamp: "2026-04-18T20:00:02.000Z"
      },
      records: [
        {
          handoffId: "h-1",
          status: "prepared",
          role: "A",
          sessionId: "a-1",
          timestamp: "2026-04-18T20:00:00.000Z"
        },
        {
          handoffId: "h-1",
          status: "delivered",
          role: "B",
          sessionId: "b-1",
          timestamp: "2026-04-18T20:00:01.000Z"
        },
        {
          handoffId: "h-1",
          status: "completed",
          role: "B",
          sessionId: "b-1",
          timestamp: "2026-04-18T20:00:02.000Z"
        }
      ]
    };

    expect(selectLastValidatedRecord(state)?.status).toBe("completed");
  });
});
