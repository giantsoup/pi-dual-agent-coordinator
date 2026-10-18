import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { McpClientPool } from "../../src/mcp/client-pool.js";
import type { ResolvedMcpConfig } from "../../src/mcp/types.js";
import { createRoleRuntime } from "../../src/runtime/create-role-runtime.js";
import { fixtureChatResponse, fixtureChatToolResponse } from "../../src/security/fixture-provider.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(directTools = false) {
  const root = await mkdtemp(join(tmpdir(), "pi-dependency-contracts-")); roots.push(root);
  const cwd = join(root, "workspace"); await mkdir(cwd);
  const mcp: ResolvedMcpConfig = { enabled: true, projectRoot: cwd, cacheFile: join(root, "cache.json"), configSources: [], servers: [{
    name: "fixture", command: process.execPath, args: [join(process.cwd(), "test/fixtures/fake-mcp-server.mjs")], transport: "stdio",
    directTools, lifecycle: "lazy", idleTimeoutMinutes: 10, required: true, roleOverrides: {}, sourcePaths: [], fingerprint: "contracts"
  }] };
  return { cwd, sessionRoot: join(root, "state"), mcp };
}

it("lets the MCP SDK reject pending requests and release its transport on close", async () => {
  const options = await fixture();
  const pool = new McpClientPool("B", options.mcp);
  try {
    const client = await pool.connect("fixture");
    const pending = client.callTool({ name: "slow", arguments: {} }, undefined, { timeout: 4000 });
    const settled = pending.then(value => ({ value }), (error: unknown) => ({ error }));
    await new Promise<void>(resolve => setImmediate(resolve));
    await pool.closeAll();
    expect(await settled).toMatchObject({ error: { code: ErrorCode.ConnectionClosed } });
    expect(client.transport).toBeUndefined();
    expect(await pool.callTool("fixture", "echo", { text: "reconnected" })).toMatchObject({ content: [{ text: "echo:reconnected" }] });
  } finally { await pool.closeAll(); }
});

it.each([false, true])("preserves MCP failure and structured result fields in real Pi sessions (direct=%s)", async directTools => {
  const options = await fixture(directTools);
  let calls = 0;
  const binding = await createRoleRuntime({ ...options, role: "B", sessionMode: "memory", providerTestBackend: {
    cwd: options.cwd, modelIds: [], request: async () => ++calls === 1
      ? fixtureChatToolResponse(directTools ? "failure" : "mcp", directTools ? {} : { action: "call_tool", server: "fixture", tool: "failure", arguments: {} })
      : fixtureChatResponse("Failure acknowledged")
  } });
  const results: unknown[] = [];
  const failures: boolean[] = [];
  binding.session.subscribe(event => { if (event.type === "tool_execution_end") { failures.push(event.isError); results.push(event.result); } });
  try {
    await binding.session.prompt("Call the failure fixture once.");
    expect(failures).toEqual([true]);
    expect(results).toContainEqual(expect.objectContaining({ isError: true, structuredContent: { ok: false, reason: "fixture" } }));
    expect(binding.session.messages).toContainEqual(expect.objectContaining({ role: "toolResult", isError: true }));
  } finally { await binding.dispose(); }
});

async function pagedFixture(mode?: string) {
  const options = await fixture();
  const server = options.mcp.servers[0];
  if (!server) throw new Error("Missing fixture server");
  server.args = [join(process.cwd(), "test/fixtures/paged-mcp-server.mjs"), ...(mode ? [mode] : [])];
  return options;
}

it("collects every metadata page and validates first-page output after cache hydration", async () => {
  const options = await pagedFixture();
  const pool = new McpClientPool("B", options.mcp);
  try {
    const metadata = await pool.syncMetadata("fixture");
    for (const entries of [metadata.tools, metadata.resources, metadata.resourceTemplates, metadata.prompts]) {
      expect(entries.map(entry => entry.name)).toEqual(["first", "second"]);
    }
    expect(await pool.callTool("fixture", "first", {})).toMatchObject({ structuredContent: { ok: true } });
    await expect(pool.callTool("fixture", "first", { invalid: true })).rejects.toThrow("Invalid structured result");
  } finally { await pool.closeAll(); }
  const restored = new McpClientPool("B", options.mcp);
  try {
    await restored.hydrateFromCache();
    expect(restored.getKnownTools()).toHaveLength(2);
    await expect(restored.callTool("fixture", "first", { invalid: true })).rejects.toThrow("Invalid structured result");
  } finally { await restored.closeAll(); }
});

it("rejects repeated opaque cursors and honors server capabilities", async () => {
  for (const mode of ["repeat", "resources-only"]) {
    const options = await pagedFixture(mode);
    const pool = new McpClientPool("B", options.mcp);
    try {
      if (mode === "repeat") await expect(pool.syncMetadata("fixture")).rejects.toThrow("repeated a cursor");
      else expect(await pool.syncMetadata("fixture")).toMatchObject({ tools: [], prompts: [], resources: [{ name: "first" }, { name: "second" }] });
    } finally { await pool.closeAll(); }
  }
});

it.each(["resource", "prompt"])("cancels in-flight MCP %s requests", async kind => {
  const options = await pagedFixture();
  const pool = new McpClientPool("B", options.mcp);
  try {
    await pool.connect("fixture");
    const controller = new AbortController();
    const pending = kind === "resource" ? pool.readResource("fixture", "fixture:///first", controller.signal) : pool.getPrompt("fixture", "first", undefined, controller.signal);
    const rejected = expect(pending).rejects.toThrow("cancel fixture");
    await new Promise<void>(resolve => setImmediate(resolve));
    controller.abort(new Error("cancel fixture"));
    await rejected;
    expect(await pool.callTool("fixture", "first", {})).toMatchObject({ structuredContent: { ok: true } });
  } finally { await pool.closeAll(); }
});
