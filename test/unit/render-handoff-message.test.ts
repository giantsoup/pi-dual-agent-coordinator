import { describe, expect, it } from "vitest";

import { renderHandoffMessage } from "../../src/handoff/render-handoff-message.js";

describe("renderHandoffMessage", () => {
  it("includes execution plan bullets and only renders the structured brief", () => {
    const message = renderHandoffMessage({
      schemaVersion: 1,
      workflowId: "wf-1",
      handoffId: "h-1",
      iteration: 1,
      objective: "Implement feature",
      summary: "Structured summary only",
      acceptanceCriteria: ["tests pass"],
      relevantPaths: ["src/index.ts"],
      executionPlan: ["Update the implementation", "Run tests"],
      constraints: ["Do not widen scope"]
    });

    expect(message).toContain("Execution plan:");
    expect(message).toContain("- Update the implementation");
    expect(message).toContain("- Run tests");
    expect(message).toContain("It is not a tool name");
    expect(message).toContain("For `pi-completion.summary`, describe actual changes or observed verification results");
    expect(message).toContain("Include `verification`");
    expect(message).toContain("not as a tool call");
    expect(message).toContain("do not place prose after the completion block");
    expect(message).not.toContain("raw planning transcript");
    expect(message).toContain("then stop even when the check fails");
    expect(message).toContain("there is no universal tool-call limit");
    expect(message).toContain("Failure does not authorize diagnosis, repair, or a rerun");
  });
});
