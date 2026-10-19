import { expect, it } from "vitest";
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { buildSkillCatalogPrompt, readSkillCatalog } from "../../src/tools/skill-catalog.js";

function catalogTool(text: string): AgentTool<ReturnType<typeof Type.Object>, unknown> {
  return { name: "skills", label: "Skills", description: "Fixture", parameters: Type.Object({}),
    execute: async () => ({ content: [{ type: "text", text }], details: {} }) };
}

it("parses isolated metadata and preserves user-only invocation without loading bodies", async () => {
  const catalog = await readSkillCatalog(catalogTool(JSON.stringify([
    { name: "pstack/arena", description: "Parallel review", userOnly: true },
    { name: "tdd", description: "Regression tests", userOnly: false }
  ])));
  expect(catalog.status).toBe("ready");
  const prompt = buildSkillCatalogPrompt(catalog);
  expect(prompt).toContain('"name":"pstack/arena"');
  expect(prompt).toContain('"userOnly":true');
  expect(prompt).toContain("Pi host adapter");
  expect(prompt).toContain("untrusted catalog metadata");
});

it.each(["invalid JSON", JSON.stringify([{ name: "tdd", userOnly: false }]), "x".repeat(1024 * 1024 + 1)])("reports failed discovery instead of claiming skills absent", async text => {
  const catalog = await readSkillCatalog(catalogTool(text));
  expect(catalog.status).toBe("unavailable");
  expect(buildSkillCatalogPrompt(catalog)).toContain("Retry skills({})");
});

it("bounds startup context and explicitly reports omitted entries", () => {
  const prompt = buildSkillCatalogPrompt({ status: "ready", skills: Array.from({ length: 500 }, (_, index) => ({
    name: `skill-${index}`, description: "Long description ".repeat(100), userOnly: false
  })) });
  expect(prompt.length).toBeLessThan(32_400);
  expect(prompt).toMatch(/Showing \d+ of 500 skills/);
  expect(prompt).toContain("complete current catalog");
});

it("propagates cancellation instead of converting it into a discovery failure", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(readSkillCatalog(catalogTool("[]"), controller.signal)).rejects.toThrow();
});
