import { describe, expect, it } from "vitest";

import { renderReviewMessage } from "../../src/workflow/render-review-message.js";

describe("renderReviewMessage", () => {
  it("asks Agent A for a specific operator-facing final response", () => {
    const message = renderReviewMessage(
      {
        workflowId: "wf-1",
        status: "running",
        currentIteration: 1,
        userTask: "Implement feature",
        iterations: [],
        repairCount: 0,
        capCount: 0
      },
      {
        schemaVersion: 1,
        workflowId: "wf-1",
        handoffId: "h-1",
        iteration: 1,
        summary: "Updated the feature flow and tests.",
        changedPaths: ["src/index.ts", "test/index.test.ts"],
        verification: ["npm test -- test/index.test.ts"]
      }
    );

    expect(message).toContain("make the operator-facing response specific and informative");
    expect(message).toContain("not a tool name");
    expect(message).toContain("what Agent B changed");
    expect(message).toContain("what verification ran");
    expect(message).toContain("not as a tool call");
    expect(message).toContain("End your turn with exactly one `pi-final` or `pi-handoff` JSON block");
  });
});
