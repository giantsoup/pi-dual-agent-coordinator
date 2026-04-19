import { describe, expect, it } from "vitest";

import { buildRolePromptAppendix } from "../../src/app/trust-policy.js";

describe("trust policy", () => {
  it("tells Agent A how to produce approval-gated plans and immediate execution blocks", () => {
    const prompt = buildRolePromptAppendix("A").join("\n");

    expect(prompt).toContain("When the operator wants a concrete implementation plan");
    expect(prompt).toContain("```pi-plan");
    expect(prompt).toContain("```pi-execute");
    expect(prompt).toContain("`pi-plan` and `pi-execute` are mutually exclusive");
    expect(prompt).toContain("not tool names or commands");
    expect(prompt).toContain("Make `pi-final.userResponse` operator-facing and specific");
    expect(prompt).toContain("what verification ran");
    expect(prompt).toContain('schemaVersion` must be the integer `1`');
    expect(prompt).toContain("```pi-handoff");
    expect(prompt).toContain('"schemaVersion":1');
  });

  it("tells Agent B to use an integer schema version with an example completion block", () => {
    const prompt = buildRolePromptAppendix("B").join("\n");

    expect(prompt).toContain('schemaVersion` must be the integer `1`');
    expect(prompt).toContain("```pi-completion");
    expect(prompt).toContain("not a tool name, command, or function call");
    expect(prompt).toContain("Make `pi-completion.summary` concrete and implementation-specific");
    expect(prompt).toContain("Include `verification`");
    expect(prompt).toContain('"schemaVersion":1');
  });
});
