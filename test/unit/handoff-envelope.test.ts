import { describe, expect, it } from "vitest";

import {
  maybeParseCompletionRecord,
  maybeParseHandoffEnvelope
} from "../../src/handoff/handoff-envelope.js";
import { assistantMessage } from "../helpers/fakes.js";

describe("handoff envelope", () => {
  it("accepts a valid handoff block", () => {
    const message = assistantMessage(`
\`\`\`pi-handoff
{"schemaVersion":1,"handoffId":"h-1","objective":"Fix issue","summary":"Plan","acceptanceCriteria":["tests pass"],"relevantPaths":["src/index.ts"]}
\`\`\`
`);

    const envelope = maybeParseHandoffEnvelope(message);

    expect(envelope?.handoffId).toBe("h-1");
    expect(envelope?.acceptanceCriteria).toEqual(["tests pass"]);
  });

  it("normalizes a string schema version for handoff blocks", () => {
    const message = assistantMessage(`
\`\`\`pi-handoff
{"schemaVersion":"1.0","handoffId":"h-1","objective":"Fix issue","summary":"Plan","acceptanceCriteria":["tests pass"],"relevantPaths":["src/index.ts"]}
\`\`\`
`);

    expect(maybeParseHandoffEnvelope(message)?.schemaVersion).toBe(1);
  });

  it("rejects an invalid handoff block", () => {
    const message = assistantMessage(`
\`\`\`pi-handoff
{"schemaVersion":1,"handoffId":"h-1","objective":"Fix issue","summary":"Plan","acceptanceCriteria":[],"relevantPaths":[]}
\`\`\`
`);

    expect(maybeParseHandoffEnvelope(message)).toBeUndefined();
  });

  it("accepts a valid completion block", () => {
    const message = assistantMessage(`
\`\`\`pi-completion
{"schemaVersion":1,"handoffId":"h-1","summary":"Done","changedPaths":["src/index.ts"]}
\`\`\`
`);

    expect(maybeParseCompletionRecord(message)?.changedPaths).toEqual(["src/index.ts"]);
  });

  it("normalizes a string schema version for completion blocks", () => {
    const message = assistantMessage(`
\`\`\`pi-completion
{"schemaVersion":"1","handoffId":"h-1","summary":"Done","changedPaths":["src/index.ts"]}
\`\`\`
`);

    expect(maybeParseCompletionRecord(message)?.schemaVersion).toBe(1);
  });
});
