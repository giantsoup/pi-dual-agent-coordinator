import { describe, expect, it } from "vitest";

import {
  maybeParseCompletionRecord,
  maybeParseExecutionPlanEnvelope,
  maybeParseFinalDecisionRecord,
  maybeParseHandoffEnvelope
} from "../../src/handoff/handoff-envelope.js";
import { assistantMessage } from "../helpers/fakes.js";

describe("workflow machine blocks", () => {
  it("accepts a valid execute block", () => {
    const message = assistantMessage(`
\`\`\`pi-execute
{"schemaVersion":1,"objective":"Implement feature","summary":"Ready to start execution","acceptanceCriteria":["tests pass"],"relevantPaths":["src/index.ts"],"executionPlan":["Update the implementation","Run tests"],"constraints":["Keep the change scoped"]}
\`\`\`
`);

    const envelope = maybeParseExecutionPlanEnvelope(message);

    expect(envelope?.objective).toBe("Implement feature");
    expect(envelope?.executionPlan).toEqual([
      "Update the implementation",
      "Run tests"
    ]);
  });

  it("accepts a valid handoff block", () => {
    const message = assistantMessage(`
\`\`\`pi-handoff
{"schemaVersion":1,"workflowId":"wf-1","handoffId":"h-1","iteration":1,"objective":"Fix issue","summary":"Plan","acceptanceCriteria":["tests pass"],"relevantPaths":["src/index.ts"]}
\`\`\`
`);

    const envelope = maybeParseHandoffEnvelope(message);

    expect(envelope?.workflowId).toBe("wf-1");
    expect(envelope?.handoffId).toBe("h-1");
    expect(envelope?.acceptanceCriteria).toEqual(["tests pass"]);
  });

  it("normalizes tolerant schema versions", () => {
    const handoff = assistantMessage(`
\`\`\`pi-handoff
{"schemaVersion":"1.0","workflowId":"wf-1","handoffId":"h-1","iteration":1,"objective":"Fix issue","summary":"Plan","acceptanceCriteria":["tests pass"],"relevantPaths":["src/index.ts"]}
\`\`\`
`);
    const completion = assistantMessage(`
\`\`\`pi-completion
{"schemaVersion":"1","workflowId":"wf-1","handoffId":"h-1","iteration":1,"summary":"Done","changedPaths":["src/index.ts"]}
\`\`\`
`);

    expect(maybeParseHandoffEnvelope(handoff)?.schemaVersion).toBe(1);
    expect(maybeParseCompletionRecord(completion)?.schemaVersion).toBe(1);
  });

  it("rejects malformed blocks", () => {
    const execute = assistantMessage(`
\`\`\`pi-execute
{"schemaVersion":1,"objective":"Implement feature","summary":"Ready","acceptanceCriteria":["tests pass"],"relevantPaths":["src/index.ts"],"executionPlan":[]}
\`\`\`
`);
    const handoff = assistantMessage(`
\`\`\`pi-handoff
{"schemaVersion":1,"workflowId":"wf-1","handoffId":"h-1","iteration":1,"objective":"Fix issue","summary":"Plan","acceptanceCriteria":[],"relevantPaths":[]}
\`\`\`
`);
    const completion = assistantMessage(`
\`\`\`pi-completion
{"schemaVersion":1,"workflowId":"wf-1","handoffId":"h-1","iteration":1,"summary":"Done","changedPaths":[1]}
\`\`\`
`);

    expect(maybeParseExecutionPlanEnvelope(execute)).toBeUndefined();
    expect(maybeParseHandoffEnvelope(handoff)).toBeUndefined();
    expect(maybeParseCompletionRecord(completion)).toBeUndefined();
  });

  it("accepts a valid completion block", () => {
    const message = assistantMessage(`
\`\`\`pi-completion
{"schemaVersion":1,"workflowId":"wf-1","handoffId":"h-1","iteration":1,"summary":"Done","changedPaths":["src/index.ts"],"openQuestions":["confirm deployment"]}
\`\`\`
`);

    expect(maybeParseCompletionRecord(message)?.openQuestions).toEqual([
      "confirm deployment"
    ]);
  });

  it("accepts a valid final block", () => {
    const message = assistantMessage(`
\`\`\`pi-final
{"schemaVersion":1,"workflowId":"wf-1","iteration":2,"decision":"approved","summary":"Complete","userResponse":"Done.","changedPaths":["src/index.ts"]}
\`\`\`
`);

    expect(maybeParseFinalDecisionRecord(message)?.decision).toBe("approved");
  });
});
