import { describe, expect, it } from "vitest";

import { renderHandoffSummary } from "../../src/app/interactive/presentation.js";

describe("interactive presentation", () => {
  it("renders a structured handoff summary for the latest workflow state", () => {
    const output = renderHandoffSummary({
      workflow: {
        workflowId: "workflow-123",
        status: "reviewing",
        currentIteration: 2,
        latestHandoffId: "handoff-456",
        latestCompletionSummary: "Agent B finished the requested edits.",
        finalDecision: "approved"
      },
      ledgerTail: {
        status: "completed",
        role: "B",
        handoffId: "handoff-456",
        sessionId: "B-session-9",
        sessionFile: "/tmp/sessions/B.jsonl",
        timestamp: "2026-04-20T00:00:00.000Z",
        completion: {
          summary: "Updated the UI state wiring and verified the portal flow."
        }
      }
    });

    expect(output).toContain("Latest Handoff");
    expect(output).toContain("Workflow: workflow-123");
    expect(output).toContain("Status: reviewing");
    expect(output).toContain("Current iteration: 2");
    expect(output).toContain("Latest handoff: handoff-456");
    expect(output).toContain("Final decision: approved");
    expect(output).toContain("Ledger tail");
    expect(output).toContain("Actor: B");
    expect(output).toContain("Session: B-session-9");
    expect(output).toContain("Summary:");
    expect(output).toContain("Updated the UI state wiring and verified the portal flow.");
  });
});
