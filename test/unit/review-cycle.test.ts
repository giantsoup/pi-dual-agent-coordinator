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

  it("rejects a final using the next handoff iteration so it can be repaired", () => {
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

    expect(response).toEqual({ kind: "invalid", reason: "unexpected final iteration 3" });
  });
});

import { resolveAgentBResponse } from "../../src/coordinator/review-cycle.js";
const finalRecord = { schemaVersion: 1, workflowId: "wf", iteration: 2, decision: "blocked", summary: "Need approval", userResponse: "Choose a scope", changedPaths: [] };
const completion = { schemaVersion: 1, workflowId: "wf", handoffId: "handoff", iteration: 2, summary: "Done", changedPaths: [] };
const fenced = (type: string, value: unknown) => `\`\`\`${type}\n${JSON.stringify(value)}\n\`\`\``;
describe.each(["A", "B"] as const)("Agent %s malformed responses", (role) => {
  const name = role === "A" ? "pi-final" : "pi-completion";
  const record = role === "A" ? finalRecord : completion;
  it.each([
    ["missing", "Just prose"], ["empty", ""], ["empty block", `\`\`\`${name}\n\n\`\`\``],
    ["malformed JSON", `\`\`\`${name}\n{broken}\n\`\`\``],
    ["truncated block", `\`\`\`${name}\n{"schemaVersion":1`],
    ["missing fields", fenced(name, {})], ["invalid fields", fenced(name, { ...record, changedPaths: 3 })],
    ["empty fields", fenced(name, { ...record, summary: "   " })],
    ["workflow ID", fenced(name, { ...record, workflowId: "old" })],
    ["iteration", fenced(name, { ...record, iteration: 3 })],
    ["request ID", fenced(name, { ...record, requestId: "old" })],
    ["duplicate", fenced(name, record) + fenced(name, record)],
    ["mixed wrong block", fenced(name, record) + fenced("pi-check-in", {})],
    ["incorrect type", fenced("pi-plan", record)]
  ])("rejects %s", (_category, text) => {
    const message = assistantMessage(text);
    const response = role === "A" ? resolveAgentAResponse({ message, workflowId: "wf", requestId: "request", allowedHandoffIterations: [3], allowedFinalIterations: [2] })
      : resolveAgentBResponse({ message, workflowId: "wf", handoffId: "handoff", iteration: 2, requestId: "request" });
    expect(response.kind).toBe("invalid");
  });
  it("rejects a provider-truncated response even when it contains valid JSON", () => {
    const message = assistantMessage(fenced(name, record)); message.stopReason = "length";
    const response = role === "A" ? resolveAgentAResponse({ message, workflowId: "wf", allowedHandoffIterations: [3], allowedFinalIterations: [2] })
      : resolveAgentBResponse({ message, workflowId: "wf", handoffId: "handoff", iteration: 2 });
    expect(response).toMatchObject({ kind: "invalid", reason: expect.stringContaining("Truncated") });
  });
});
