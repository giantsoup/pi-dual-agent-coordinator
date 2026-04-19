import { describe, expect, it } from "vitest";

import { resolveAgentAResponse } from "../../src/coordinator/review-cycle.js";
import { assistantMessage } from "../helpers/fakes.js";

describe("review cycle validation", () => {
  it("accepts a final for the current iteration during review", () => {
    const response = resolveAgentAResponse({
      message: assistantMessage(`
\`\`\`pi-final
{"schemaVersion":1,"workflowId":"wf-1","iteration":2,"decision":"approved","summary":"Done","userResponse":"Done","changedPaths":["src/index.ts"]}
\`\`\`
`),
      workflowId: "wf-1",
      allowedHandoffIterations: [3],
      allowedFinalIterations: [2]
    });

    expect(response.kind).toBe("final");
  });

  it("accepts the next handoff iteration during review", () => {
    const response = resolveAgentAResponse({
      message: assistantMessage(`
\`\`\`pi-handoff
{"schemaVersion":1,"workflowId":"wf-1","handoffId":"h-3","iteration":3,"objective":"Fix gap","summary":"Revise","acceptanceCriteria":["tests pass"],"relevantPaths":["src/index.ts"]}
\`\`\`
`),
      workflowId: "wf-1",
      allowedHandoffIterations: [3],
      allowedFinalIterations: [2]
    });

    expect(response.kind).toBe("handoff");
  });

  it("rejects a final that incorrectly advances the iteration", () => {
    const response = resolveAgentAResponse({
      message: assistantMessage(`
\`\`\`pi-final
{"schemaVersion":1,"workflowId":"wf-1","iteration":3,"decision":"approved","summary":"Done","userResponse":"Done","changedPaths":["src/index.ts"]}
\`\`\`
`),
      workflowId: "wf-1",
      allowedHandoffIterations: [4],
      allowedFinalIterations: [2]
    });

    expect(response).toEqual({
      kind: "invalid",
      reason: "unexpected final iteration 3"
    });
  });

  it("normalizes a final that incorrectly uses the next handoff iteration", () => {
    const response = resolveAgentAResponse({
      message: assistantMessage(`
\`\`\`pi-final
{"schemaVersion":1,"workflowId":"wf-1","iteration":3,"decision":"approved","summary":"Done","userResponse":"Done","changedPaths":["src/index.ts"]}
\`\`\`
`),
      workflowId: "wf-1",
      allowedHandoffIterations: [3],
      allowedFinalIterations: [2]
    });

    expect(response).toEqual({
      kind: "final",
      finalDecision: {
        schemaVersion: 1,
        workflowId: "wf-1",
        iteration: 2,
        decision: "approved",
        summary: "Done",
        userResponse: "Done",
        changedPaths: ["src/index.ts"]
      }
    });
  });
});
