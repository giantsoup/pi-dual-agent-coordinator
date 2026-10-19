import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { z } from "zod";
import { createRoleRuntime } from "../../src/runtime/create-role-runtime.js";
import { loadResolvedMcpConfig } from "../../src/mcp/config-loader.js";
import { parseToolResult } from "../../src/tools/tool-result.js";
import { fixtureResponse, fixtureToolResponse, fixtureChatResponse, fixtureChatToolResponse } from "../../src/security/fixture-provider.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const inventorySchema = z.object({
  tools: z.array(z.object({ name: z.string(), kind: z.enum(["native", "mcp"]) })),
  skills: z.object({ status: z.literal("ready"), skills: z.array(z.object({ name: z.string(), userOnly: z.boolean() })) }),
  mcp: z.object({ tools: z.array(z.object({ canonicalName: z.string(), allowed: z.boolean() })),
    status: z.object({ enabled: z.boolean(), servers: z.array(z.object({ name: z.string(), connected: z.boolean(), lastError: z.string().optional() })) }) })
});

it.each(["A", "B"] as const)("Agent %s sees startup skills and discovers all capability categories with the Pi adapter", async role => {
  const root = await mkdtemp(join(tmpdir(), "pi-capabilities-")); roots.push(root);
  const cwd = join(root, "workspace"), agentDir = join(root, "agent"), skills = join(agentDir, "skills");
  await mkdir(cwd);
  for (const [name, description] of [["setup-matt-pocock-skills", "Configure Matt Pocock workflows"], ["pstack/skills/poteto-mode", "pstack review workflows"]] satisfies Array<[string, string]>) {
    await mkdir(join(skills, name), { recursive: true });
    await writeFile(join(skills, name, "SKILL.md"), `---\nname: ${name.split("/").at(-1)}\ndescription: ${description}\ndisable-model-invocation: true\n---\nUPSTREAM_BODY_NOT_PRELOADED\nUse Task to request reviewers.`);
  }
  await writeFile(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: {
    fixture: { command: process.execPath, args: [join(process.cwd(), "test/fixtures/fake-mcp-server.mjs")],
      "x-pi-dual": { directTools: false, roles: { A: { excludeTools: ["destroy"] } } } },
    offline: { command: join(root, "missing-command"), "x-pi-dual": { directTools: false } }
  } }));
  const mcp = await loadResolvedMcpConfig({ cwd, agentDir, enabled: true });
  let calls = 0;
  const binding = await createRoleRuntime({ role, cwd, agentDir, mcp, sessionMode: "memory", sessionRoot: join(root, "state"),
    providerTestBackend: { cwd, modelIds: [], load: async () => "dummy-capabilities", request: async (_url, init) => {
      const body = String(init?.body);
      if (++calls === 1) {
        expect(body).toContain("setup-matt-pocock-skills"); expect(body).toContain("pstack/poteto-mode");
        expect(body).toContain("pstack review workflows"); expect(body).not.toContain("UPSTREAM_BODY_NOT_PRELOADED");
        return role === "A" ? fixtureToolResponse("list_tools", {}) : fixtureChatToolResponse("list_tools", {});
      }
      if (calls === 2) return role === "A" ? fixtureToolResponse("skills", { name: "pstack/poteto-mode" }) : fixtureChatToolResponse("skills", { name: "pstack/poteto-mode" });
      if (calls === 3) {
        expect(body).toContain("Pi host adapter for pstack");
        expect(body).toContain("/approve"); expect(body).toContain("capability gap");
      } else expect(body).toContain("new-session-skill");
      return role === "A" ? fixtureResponse("Capabilities verified") : fixtureChatResponse("Capabilities verified");
    } }
  });
  let inventory: z.output<typeof inventorySchema> | undefined;
  const errors: boolean[] = [];
  binding.session.subscribe(event => {
    if (event.type !== "tool_execution_end") return;
    errors.push(event.isError);
    if (event.toolName === "list_tools") {
      const text = parseToolResult(event.result).content.find(item => item.type === "text");
      inventory = inventorySchema.parse(JSON.parse(text?.type === "text" ? text.text : "null"));
    }
  });
  try {
    await binding.session.prompt("List your MCP tools, including Matt Pocock and pstack workflows.");
    expect(calls).toBe(3); expect(errors).toEqual([false, false]);
    expect(inventory?.skills.skills.map(skill => skill.name)).toEqual(["pstack/poteto-mode", "setup-matt-pocock-skills"]);
    expect(inventory?.mcp.tools).toContainEqual(expect.objectContaining({ canonicalName: "fixture/destroy", allowed: role === "B" }));
    expect(inventory?.mcp.status.servers).toContainEqual(expect.objectContaining({ name: "fixture", connected: true }));
    expect(inventory?.mcp.status.servers).toContainEqual(expect.objectContaining({ name: "offline", connected: false, lastError: expect.any(String) }));
    expect(inventory?.tools.map(tool => tool.name)).toContain("skills");
    expect(inventory?.tools.map(tool => tool.name)).not.toContain("Task");
    if (role === "A") expect(inventory?.tools.map(tool => tool.name)).not.toContain("write");
    await mkdir(join(skills, "new-session-skill"));
    await writeFile(join(skills, "new-session-skill", "SKILL.md"), "---\nname: new-session-skill\ndescription: Freshly installed\n---\nNew instructions");
    await binding.runtime.newSession();
    await binding.session.prompt("Check refreshed skill metadata.");
    expect(calls).toBe(4);
  } finally { await binding.dispose(); }
});

it("omits the skill catalog and tools from no-tools smoke runtimes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-no-tools-catalog-")); roots.push(root);
  const cwd = join(root, "workspace"), agentDir = join(root, "agent"); await mkdir(cwd);
  await mkdir(join(agentDir, "skills", "private-skill"), { recursive: true });
  await writeFile(join(agentDir, "skills", "private-skill", "SKILL.md"), "---\nname: private-skill\ndescription: SHOULD_NOT_LOAD\n---\nSHOULD_NOT_LOAD");
  const binding = await createRoleRuntime({ role: "A", cwd, agentDir, noTools: true, sessionMode: "memory", sessionRoot: join(root, "state"),
    providerTestBackend: { cwd, modelIds: [], load: async () => "dummy-no-tools", request: async (_url, init) => {
      const body = String(init?.body); expect(body).not.toContain("SHOULD_NOT_LOAD");
      expect(body).not.toContain("Installed Pi skills (");
      return fixtureResponse("Smoke checked");
    } }
  });
  try { await binding.session.prompt("Smoke fixture"); } finally { await binding.dispose(); }
});
