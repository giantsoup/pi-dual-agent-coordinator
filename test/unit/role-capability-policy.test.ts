import { describe, expect, it } from "vitest";

import { createRoleTools } from "../../src/tools/create-role-tools.js";

describe("role capability policy", () => {
  it("keeps role A read-only", () => {
    const tools = createRoleTools({ role: "A", cwd: process.cwd() });
    const names = tools.map((tool) => tool.name);
    expect(names).not.toContain("edit");
    expect(names).not.toContain("write");
  });

  it("gives role B mutation tools", () => {
    const tools = createRoleTools({ role: "B", cwd: process.cwd() });
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("edit");
    expect(names).toContain("write");
  });
});
