import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { createRoleRuntime } from "../../src/runtime/create-role-runtime.js";
import { fixtureChatResponse, fixtureChatToolResponse, fixtureResponse, fixtureToolResponse } from "../../src/security/fixture-provider.js";
import { ToolIsolation } from "../../src/security/isolation.js";
import { createRoleTools } from "../../src/tools/create-role-tools.js";
import { readSkillCatalog } from "../../src/tools/skill-catalog.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pi-skills-")); roots.push(root);
  const cwd = join(root, "workspace"), agentDir = join(root, "agent"), skillsDir = join(agentDir, "skills");
  await mkdir(cwd); await mkdir(join(skillsDir, "fixture"), { recursive: true });
  await writeFile(join(skillsDir, "fixture", "SKILL.md"), '---\nname: fixture\ndescription: A fixture skill\ndisable-model-invocation: true\n---\nSKILL_INSTRUCTIONS_OK\n');
  await writeFile(join(agentDir, "protected.txt"), "dummy-private-skill-boundary");
  return { cwd, agentDir, skillsDir, sessionRoot: join(root, "state") };
}
it.each(["A", "B"] as const)("Agent %s can read installed skill instructions through a real Pi tool call", async role => {
  const options = await fixture();
  let calls = 0;
  const binding = await createRoleRuntime({ ...options, role, sessionMode: "memory", providerTestBackend: {
    cwd: options.cwd, modelIds: [], load: async () => "dummy-skill-key", request: async () => {
      if (++calls === 1) return role === "A" ? fixtureToolResponse("skills", { name: "fixture" }) : fixtureChatToolResponse("skills", { name: "fixture" });
      return role === "A" ? fixtureResponse("Skill read") : fixtureChatResponse("Skill read");
    }
  } });
  const results: unknown[] = [];
  binding.session.subscribe(event => { if (event.type === "tool_execution_end") results.push({ result: event.result, isError: event.isError }); });
  try {
    await binding.session.prompt("Use the installed fixture skill.");
    expect(results).toContainEqual(expect.objectContaining({ isError: false }));
    expect(JSON.stringify(results)).toContain("SKILL_INSTRUCTIONS_OK");
    expect(calls).toBe(2);
  } finally { await binding.dispose(); }
});
it("keeps skill references, sibling secrets, and global skill writes inside the sandbox boundary", async () => {
  const options = await fixture();
  await symlink(join(options.agentDir, "protected.txt"), join(options.skillsDir, "fixture", "leak.txt"));
  const isolation = new ToolIsolation(options.cwd, "B", options.skillsDir);
  const tools = createRoleTools({ ...options, role: "B", isolation });
  const skills = tools.find(tool => tool.name === "skills"), read = tools.find(tool => tool.name === "read"), write = tools.find(tool => tool.name === "write");
  if (!skills || !read || !write) throw new Error("Missing fixture tools");
  try {
    const list = await skills.execute("list", {});
    const text = list.content.find(item => item.type === "text");
    expect(text?.type === "text" ? JSON.parse(text.text) : []).toContainEqual({ name: "fixture", description: "A fixture skill", userOnly: true });
    await expect(skills.execute("escape", { name: "fixture", path: "../../protected.txt" })).rejects.toThrow();
    await expect(skills.execute("symlink", { name: "fixture", path: "leak.txt" })).rejects.toThrow();
    await expect(read.execute("read-secret", { path: join(options.agentDir, "protected.txt") })).rejects.toThrow();
    await expect(write.execute("write-skill", { path: join(options.skillsDir, "fixture", "SKILL.md"), content: "changed" })).rejects.toThrow();
    expect(await readFile(join(options.skillsDir, "fixture", "SKILL.md"), "utf8")).toContain("SKILL_INSTRUCTIONS_OK");
  } finally { isolation.dispose(); }
});
it("rejects a symlink for the global skills root", async () => {
  const options = await fixture();
  const link = join(options.agentDir, "linked-skills"); await symlink(options.agentDir, link);
  expect(() => new ToolIsolation(options.cwd, "A", link)).toThrow("not a symlink");
});

it("reports denied startup metadata as unavailable rather than an empty skill catalog", async () => {
  const options = await fixture();
  const isolation = new ToolIsolation(options.cwd, "A");
  try {
    const tool = createRoleTools({ ...options, role: "A", isolation }).find(candidate => candidate.name === "skills");
    if (!tool) throw new Error("Missing skills tool");
    expect(await readSkillCatalog(tool)).toEqual({ status: "unavailable", message: expect.stringContaining("Retry skills({})") });
  } finally { isolation.dispose(); }
});

it("keeps package skill names distinct and permits bundled references", async () => {
  const options = await fixture();
  const base = join(options.skillsDir, "pstack", "skills", "fixture");
  await mkdir(base, { recursive: true });
  await mkdir(join(options.skillsDir, "pstack", "docs"));
  await writeFile(join(base, "SKILL.md"), "---\nname: fixture\ndescription: A package fixture\n---\nPACKAGE_SKILL_OK");
  await writeFile(join(options.skillsDir, "pstack", "docs", "guide.md"), "PACKAGE_REFERENCE_OK");
  const tools = createRoleTools({ ...options, role: "A" });
  const skills = tools.find(tool => tool.name === "skills");
  if (!skills) throw new Error("Missing skills tool");
  const list = await skills.execute("list", {});
  expect(JSON.stringify(list)).toContain("pstack/fixture");
  expect(JSON.stringify(await skills.execute("read", { name: "pstack/fixture" }))).toContain("PACKAGE_SKILL_OK");
  expect(JSON.stringify(await skills.execute("reference", { name: "pstack/fixture", path: "../../docs/guide.md" }))).toContain("PACKAGE_REFERENCE_OK");
  expect(JSON.stringify(await skills.execute("original", { name: "fixture" }))).toContain("SKILL_INSTRUCTIONS_OK");
});
