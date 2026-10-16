import { dirname, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";

import { McpClientPool } from "../../src/mcp/client-pool.js";
import { createRoleMcpPolicy } from "../../src/mcp/policy.js";
import { createMcpProxyTool } from "../../src/mcp/proxy-tool.js";
import type { ResolvedMcpConfig } from "../../src/mcp/types.js";

const FIXTURE_SERVER_PATH = join(
  process.cwd(),
  "test",
  "fixtures",
  "fake-mcp-server.mjs"
);

function createConfig(cacheFile: string): ResolvedMcpConfig {
  return {
    enabled: true,
    projectRoot: dirname(cacheFile),
    cacheFile,
    configSources: [],
    servers: [
      {
        name: "fixture",
        command: process.execPath,
        args: [FIXTURE_SERVER_PATH],
        transport: "stdio",
        directTools: false,
        lifecycle: "lazy",
        idleTimeoutMinutes: 10,
        required: false,
        roleOverrides: {},
        sourcePaths: [],
        fingerprint: "fixture-fingerprint"
      }
    ]
  };
}

describe("mcp proxy tool", () => {
  it("cancels an in-flight MCP tool request and keeps the connection usable", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mcp-cancel-"));
    const pool = new McpClientPool("B",createConfig(join(root,"cache.json")));
    try {
      await pool.ensureMetadata("fixture");
      const controller = new AbortController();
      const request = pool.callTool("fixture","slow",{},controller.signal);
      const assertion = expect(request).rejects.toThrow();
      const timer = setTimeout(() => controller.abort(),30);
      try { await assertion; } finally { clearTimeout(timer); }
      expect(await pool.callTool("fixture","echo",{text:"after cancellation"})).toMatchObject({content:[{text:"echo:after cancellation"}]});
    } finally { await pool.closeAll(); rmSync(root,{recursive:true,force:true}); }
  });

  it("supports search, describe, call, resources, prompts, cache reuse, and shutdown", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-mcp-proxy-"));
    const cacheFile = join(root, "mcp-cache.json");
    const config = createConfig(cacheFile);
    const pool = new McpClientPool("B", config);
    await pool.hydrateFromCache();

    const proxy = createMcpProxyTool({
      role: "B",
      clientPool: pool,
      policy: createRoleMcpPolicy("B", config.servers),
      getDirectToolName: () => undefined
    });

    const searchResult = await proxy.execute(
      "call-1",
      { action: "search_tools", query: "echo" },
      undefined,
      undefined,
      {} as never
    );
    expect(readFirstText(searchResult)).toContain("fixture/echo");

    const describeResult = await proxy.execute(
      "call-2",
      { action: "describe_tool", tool: "fixture/echo" },
      undefined,
      undefined,
      {} as never
    );
    expect(readFirstText(describeResult)).toContain("\"canonicalName\": \"fixture/echo\"");

    const callResult = await proxy.execute(
      "call-3",
      { action: "call_tool", tool: "fixture/echo", arguments: { text: "hello" } },
      undefined,
      undefined,
      {} as never
    );
    expect(readFirstText(callResult)).toContain("echo:hello");

    const resourcesResult = await proxy.execute(
      "call-4",
      { action: "list_resources", server: "fixture" },
      undefined,
      undefined,
      {} as never
    );
    expect(readFirstText(resourcesResult)).toContain("file:///fixture/guide.txt");

    const readResourceResult = await proxy.execute(
      "call-5",
      { action: "read_resource", server: "fixture", uri: "file:///fixture/guide.txt" },
      undefined,
      undefined,
      {} as never
    );
    expect(readFirstText(readResourceResult)).toContain("resource-body");

    const promptsResult = await proxy.execute(
      "call-6",
      { action: "list_prompts", server: "fixture" },
      undefined,
      undefined,
      {} as never
    );
    expect(readFirstText(promptsResult)).toContain("hello-prompt");

    const promptResult = await proxy.execute(
      "call-7",
      {
        action: "get_prompt",
        prompt: "fixture/hello-prompt",
        arguments: { name: "Taylor" }
      },
      undefined,
      undefined,
      {} as never
    );
    expect(readFirstText(promptResult)).toContain("Hello Taylor");

    await pool.closeAll();
    expect(pool.getStatusSnapshot().servers[0]?.connected).toBe(false);

    const secondPool = new McpClientPool("B", config);
    await secondPool.hydrateFromCache();
    expect(secondPool.getKnownTools("fixture").map((entry) => entry.tool.name)).toContain("echo");
    await secondPool.closeAll();
  });
});

function readFirstText(result: AgentToolResult<unknown>): string {
  const first = result.content[0];
  return first?.type === "text" && typeof first.text === "string" ? first.text : "";
}
