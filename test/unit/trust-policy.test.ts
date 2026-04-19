import { describe, expect, it } from "vitest";

import { buildRolePromptAppendix } from "../../src/app/trust-policy.js";

describe("trust policy", () => {
  it("tells Agent A how to plan normally and start execution with pi-execute", () => {
    const prompt = buildRolePromptAppendix("A").join("\n");

    expect(prompt).toContain("In planning mode, converse normally");
    expect(prompt).toContain("```pi-execute");
    expect(prompt).toContain('schemaVersion` must be the integer `1`');
    expect(prompt).toContain("```pi-handoff");
    expect(prompt).toContain('"schemaVersion":1');
  });

  it("tells Agent B to use an integer schema version with an example completion block", () => {
    const prompt = buildRolePromptAppendix("B").join("\n");

    expect(prompt).toContain('schemaVersion` must be the integer `1`');
    expect(prompt).toContain("```pi-completion");
    expect(prompt).toContain('"schemaVersion":1');
  });
});
