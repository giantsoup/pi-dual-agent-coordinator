import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { z } from "zod";
import { afterEach, expect, it, vi } from "vitest";
import { loadResolvedMcpConfig } from "../../src/mcp/config-loader.js";
import { createRoleRuntime } from "../../src/runtime/create-role-runtime.js";
import { fixtureChatResponse, fixtureChatToolResponse, fixtureResponse, fixtureToolResponse } from "../../src/security/fixture-provider.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

it.each(["A", "B"].flatMap(role => [false, true].map(direct => ({ role, direct }))))("Agent $role executes global MCP (direct=$direct)", async ({ role: roleInput, direct }) => {
  if (roleInput !== "A" && roleInput !== "B") throw new Error("Invalid fixture role");
  const role = roleInput;
  const root = await mkdtemp(join(tmpdir(), "pi-global-session-")); roots.push(root);
  const cwd = join(root, "workspace"); await mkdir(cwd);
  const agentDir = join(root, "agent"); await mkdir(agentDir);
  await writeFile(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: [join(process.cwd(), "test/fixtures/fake-mcp-server.mjs")], ...(direct ? {} : { "x-pi-dual": { directTools: false } }) } } }));
  const mcp = await loadResolvedMcpConfig({ cwd, agentDir, enabled: true });
  let calls = 0;
  const args = { action: "call_tool", server: "fixture", tool: "destroy", arguments: {} };
  const binding = await createRoleRuntime({ role, cwd, sessionRoot: join(root, "state"), sessionMode: "memory", mcp,
    providerTestBackend: { cwd, modelIds: [], load: async () => "dummy-global-mcp-key", request: async () => {
      calls++;
      const call = (name: string, arguments_: Record<string, unknown>) => role === "A" ? fixtureToolResponse(name, arguments_) : fixtureChatToolResponse(name, arguments_);
      if (calls === 1) return call("list_tools", {});
      if (!direct && calls === 2) return call("mcp", { action: "list_tools" });
      if (calls === (direct ? 2 : 3)) return call(direct ? "destroy" : "mcp", direct ? {} : args);
      return role === "A" ? fixtureResponse("Global MCP confirmed") : fixtureChatResponse("Global MCP confirmed");
    } }
  });
  const results: unknown[] = [];
  let inventoryText = "";
  let discoveryText = "";
  binding.session.subscribe(event => { if (event.type === "tool_execution_end") results.push({ result: event.result, isError: event.isError });
    if (event.type === "tool_execution_end" && (event.toolName === "list_tools" || event.toolName === "mcp")) {
      for (const content of event.result.content) if (content.type === "text") {
        if (event.toolName === "list_tools") inventoryText += content.text;
        else discoveryText += content.text;
      }
    } });
  try {
    await binding.session.prompt("Call the global fixture MCP tool once.");
    expect(results).toContainEqual(expect.objectContaining({ isError: false, result: expect.objectContaining({ content: [{ type: "text", text: "destroyed" }] }) }));
    expect(calls).toBe(direct ? 3 : 4);
    const inventory = z.object({ tools: z.array(z.object({ name: z.string(), parameters: z.object({ type: z.literal("object") }).passthrough() })) }).parse(JSON.parse(inventoryText));
    const names = inventory.tools.map(tool => tool.name);
    expect(names).toEqual(expect.arrayContaining(["list_tools", "skills", "mcp", "read"]));
    expect(names.includes("destroy")).toBe(direct);
    expect(names).not.toContain("multi_tool_use.parallel");
    if (role === "A") for (const forbidden of ["bash", "write", "edit"]) expect(names).not.toContain(forbidden);
    else expect(names).toEqual(expect.arrayContaining(["write", "edit", "bash"]));
    if (!direct) expect(discoveryText).toContain('"inputSchema"');
    expect(results).toHaveLength(direct ? 2 : 3);
    expect(binding.session.messages?.at(-1)).toMatchObject({ role: "assistant", stopReason: "stop" });
  } finally { await binding.dispose(); }
});

it("keeps Agent A usable after optional startup discovery fails and retries through the proxy", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-mcp-retry-")); roots.push(root);
  const cwd = join(root, "workspace"), agentDir = join(root, "agent");
  await mkdir(cwd); await mkdir(agentDir);
  const later = join(cwd, "later.mjs");
  await writeFile(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: {
    fixture: { command: process.execPath, args: [later] }
  } }));
  const mcp = await loadResolvedMcpConfig({ cwd, agentDir, enabled: true });
  let calls = 0;
  const binding = await createRoleRuntime({ role: "A", cwd, sessionRoot: join(root, "state"), sessionMode: "memory", mcp,
    providerTestBackend: { cwd, modelIds: [], load: async () => "dummy-retry-key", request: async () => {
      calls++;
      if (calls === 1) return fixtureToolResponse("mcp", { action: "list_tools" });
      if (calls === 2) return fixtureToolResponse("mcp", { action: "call_tool", tool: "fixture/echo", arguments: { text: "recovered" } });
      return fixtureResponse("Recovered MCP confirmed");
    } }
  });
  const results: unknown[] = [];
  binding.session.subscribe(event => { if (event.type === "tool_execution_end") results.push({ result: event.result, isError: event.isError }); });
  try {
    expect(binding.getMcpStatus?.().servers[0]?.lastError).toBeTruthy();
    await writeFile(later, `import ${JSON.stringify(pathToFileURL(join(process.cwd(), "test/fixtures/fake-mcp-server.mjs")).href)};\n`);
    await binding.session.prompt("Retry MCP discovery and call echo.");
    expect(results).toHaveLength(2);
    expect(results).toContainEqual(expect.objectContaining({ isError: false, result: expect.objectContaining({ content: [{ type: "text", text: "echo:recovered" }] }) }));
    expect(binding.getMcpStatus?.().servers[0]?.lastError).toBeUndefined();
    expect(calls).toBe(3);
  } finally { await binding.dispose(); }
});
