import { describe, expect, it } from "vitest";

import { selectLastValidatedRecord } from "../../src/coordinator/coordinator.js";
import type { WorkflowState } from "../../src/types/workflow.js";

describe("coordinator workflow selection", () => {
  it("prefers the newest persisted workflow record", () => {
    const state: WorkflowState = {
      activeWorkflowId: undefined,
      latestWorkflowId: "wf-1",
      workflows: {
        "wf-1": {
          workflowId: "wf-1",
          status: "completed",
          currentIteration: 1,
          iterations: [],
          repairCount: 0,
          capCount: 0
        }
      },
      records: [
        {
          workflowId: "wf-1",
          handoffId: "h-1",
          iteration: 1,
          status: "prepared",
          role: "A",
          sessionId: "a-1",
          timestamp: "2026-04-18T20:00:00.000Z"
        },
        {
          workflowId: "wf-1",
          iteration: 1,
          status: "finalized",
          role: "A",
          sessionId: "a-1",
          timestamp: "2026-04-18T20:00:02.000Z",
          finalDecision: {
            schemaVersion: 1,
            workflowId: "wf-1",
            iteration: 1,
            decision: "approved",
            summary: "Complete",
            userResponse: "Done",
            changedPaths: ["src/index.ts"]
          }
        }
      ]
    };

    expect(selectLastValidatedRecord(state)?.status).toBe("finalized");
  });
});
