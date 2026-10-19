import { describe, expect, it } from "vitest";

import { buildRolePromptAppendix } from "../../src/app/trust-policy.js";

describe("trust policy", () => {
  it("tells Agent A how to produce approval-gated plans and accurate tool calls", () => {
    const prompt = buildRolePromptAppendix("A").join("\n");

    expect(prompt).toContain("When the operator wants a concrete implementation plan");
    expect(prompt).toContain("break work into small explicit phases with clear end states");
    expect(prompt).toContain("Make each phase independently verifiable");
    expect(prompt).toContain("exact files and symbols");
    expect(prompt).toContain("representative inputs and outputs");
    expect(prompt).toContain("inside executionPlan, acceptanceCriteria, relevantPaths, or constraints");
    expect(prompt).toContain("expected result");
    expect(prompt).toContain("clear stop condition");
    expect(prompt).toContain("does not guarantee success");
    expect(prompt).toContain("pi-check-in response format");
    expect(prompt).toContain("```pi-plan");
    expect(prompt).toContain("Only the operator command /approve starts Agent B");
    expect(prompt).toContain("relevantPaths: []");
    expect(prompt).toContain("list_tools({})");
    expect(prompt).toContain("there is no multi_tool_use.parallel tool");
    expect(prompt).toContain("`pi-plan` and `pi-execute` are mutually exclusive");
    expect(prompt).toContain("not tool names or commands");
    expect(prompt).toContain("Write `executionPlan` as short ordered phases with explicit outcomes");
    expect(prompt).toContain("During review, act as QA");
    expect(prompt).toContain("likely introduced regressions or missed edge cases");
    expect(prompt).toContain("Make `pi-final.userResponse` operator-facing and specific");
    expect(prompt).toContain("what verification ran");
    expect(prompt).toContain('schemaVersion` must be the integer `1`');
    expect(prompt).toContain("```pi-handoff");
    expect(prompt).toContain('"schemaVersion":1');
    const examples = [...prompt.matchAll(/```pi-(?:plan|execute)\n([^\n]+)\n```/g)];
    expect(examples).toHaveLength(1);
    for (const example of examples) {
      const plan = JSON.parse(example[1] ?? "");
      expect(plan.acceptanceCriteria.join(" ")).toContain('parseRetryLimit("3") returns 3');
      expect(plan.executionPlan.join(" ")).toContain("npm run check");
    }
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
