import { describe, expect, it } from "vitest";

import { createDirectToolNamePlan } from "../../src/mcp/direct-tools.js";
import { createRoleMcpPolicy, isMcpToolCallAllowed } from "../../src/mcp/policy.js";
import type { ResolvedMcpServerConfig } from "../../src/mcp/types.js";

function createServer(name: string): ResolvedMcpServerConfig {
  return {
    name,
    command: "node",
    args: [],
    transport: "stdio",
    directTools: name === "laravel-boost",
    lifecycle: "lazy",
    idleTimeoutMinutes: 10,
    required: name === "laravel-boost",
    roleOverrides: {},
    sourcePaths: [],
    fingerprint: name
  };
}

describe("mcp policy", () => {
  it("allows read-only tools for role A", () => {
    const policy = createRoleMcpPolicy("A", [createServer("fixture")]);

    expect(
      isMcpToolCallAllowed(policy, "fixture", {
        name: "echo",
        inputSchema: { type: "object" },
        annotations: { readOnlyHint: true }
      })
    ).toEqual({ allowed: true });
  });

  it("allows boost search-docs for role A even when it is not annotated read-only", () => {
    const policy = createRoleMcpPolicy("A", [createServer("laravel-boost")]);

    expect(
      isMcpToolCallAllowed(policy, "laravel-boost", {
        name: "search-docs",
        inputSchema: { type: "object" }
      })
    ).toEqual({ allowed: true });
  });

  it("blocks unannotated tools for role A when they are not allowlisted", () => {
    const policy = createRoleMcpPolicy("A", [createServer("fixture")]);

    expect(
      isMcpToolCallAllowed(policy, "fixture", {
        name: "mutate",
        inputSchema: { type: "object" }
      })
    ).toEqual({
      allowed: false,
      reason:
        "Tool fixture/mutate is not allowlisted for role A and is not marked read-only."
    });
  });

  it("blocks destructive tools for role A", () => {
    const policy = createRoleMcpPolicy("A", [createServer("fixture")]);

    expect(
      isMcpToolCallAllowed(policy, "fixture", {
        name: "destroy",
        inputSchema: { type: "object" },
        annotations: { destructiveHint: true }
      })
    ).toEqual({
      allowed: false,
      reason:
        "Tool fixture/destroy is marked destructive and is blocked for role A."
    });
  });

  it("allows the full configured tool set for role B", () => {
    const policy = createRoleMcpPolicy("B", [createServer("fixture")]);

    expect(
      isMcpToolCallAllowed(policy, "fixture", {
        name: "destroy",
        inputSchema: { type: "object" },
        annotations: { destructiveHint: true }
      })
    ).toEqual({ allowed: true });
  });

  it("prefixes direct tool names on collisions", () => {
    const plan = createDirectToolNamePlan({
      role: "B",
      toolSets: [
        {
          serverName: "alpha",
          tools: [{ name: "shared", inputSchema: { type: "object" } }]
        },
        {
          serverName: "beta",
          tools: [{ name: "shared", inputSchema: { type: "object" } }]
        }
      ]
    });

    expect(plan.get("alpha")?.get("shared")).toBe("alpha__shared");
    expect(plan.get("beta")?.get("shared")).toBe("beta__shared");
  });
});

it("keeps native skill and inventory names reserved for both roles", () => {
  for (const role of ["A", "B"] as const) {
    const plan = createDirectToolNamePlan({ role, toolSets: [{ serverName: "fixture", tools: ["skills", "list_tools", "local_server"].map(name => ({ name, inputSchema: { type: "object" as const } })) }] });
    expect(plan.get("fixture")?.get("skills")).toBe("fixture__skills");
    expect(plan.get("fixture")?.get("list_tools")).toBe("fixture__list_tools");
    expect(plan.get("fixture")?.get("local_server")).toBe("fixture__local_server");
  }
});
