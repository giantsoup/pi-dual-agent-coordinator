import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { loadResolvedMcpConfig } from "../../src/mcp/config-loader.js";
import { createRoleMcpPolicy, isMcpToolCallAllowed } from "../../src/mcp/policy.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pi-global-mcp-")); roots.push(root);
  const cwd = join(root, "workspace"), agentDir = join(root, "agent");
  await mkdir(cwd); await mkdir(agentDir);
  return { root, cwd, agentDir, enabled: true };
}

it("loads Pi global MCP independently of other agent apps and exposes all tools to both roles", async () => {
  const options = await fixture();
  vi.stubEnv("CODEX_HOME", join(options.root, "nonexistent-codex"));
  await writeFile(join(options.agentDir, "mcp.json"), JSON.stringify({ mcpServers: {
    docs: { url: "https://example.com/mcp" }, offline: { command: "node", args: ["fixture.mjs"] }
  } }));
  const config = await loadResolvedMcpConfig(options);
  expect(config.configSources).toEqual([join(options.agentDir, "mcp.json")]);
  expect(config.servers.map(server => server.name)).toEqual(["docs", "offline"]);
  expect(config.servers.every(server => server.directTools && !server.required)).toBe(true);
  expect(config.servers.find(server => server.name === "offline")?.cwd).toBe(options.cwd);
  for (const role of ["A", "B"] as const) {
    const policy = createRoleMcpPolicy(role, config.servers);
    expect(isMcpToolCallAllowed(policy, "docs", { name: "navigate", inputSchema: { type: "object" } })).toEqual({ allowed: true });
    expect(isMcpToolCallAllowed(policy, "docs", { name: "delete", inputSchema: { type: "object" }, annotations: { destructiveHint: true } })).toEqual({ allowed: true });
  }
});

it("enforces explicit tool selections and exclusions for both roles", async () => {
  const options = await fixture();
  const selected = { onlyTools: ["read", "write"], excludeTools: ["write"] };
  await writeFile(join(options.agentDir, "mcp.json"), JSON.stringify({ mcpServers: {
    docs: { url: "https://example.com/mcp", "x-pi-dual": { roles: { A: selected, B: selected } } }
  } }));
  const config = await loadResolvedMcpConfig(options);
  for (const role of ["A", "B"] as const) {
    const policy = createRoleMcpPolicy(role, config.servers);
    for (const [name, allowed] of [["read", true], ["write", false], ["other", false]] as const) {
      expect(isMcpToolCallAllowed(policy, "docs", { name, inputSchema: { type: "object" } }).allowed).toBe(allowed);
    }
  }
});

it("keeps project overrides last and lets them restrict full global access", async () => {
  const options = await fixture();
  await writeFile(join(options.agentDir, "mcp.json"), JSON.stringify({ mcpServers: { docs: { url: "https://example.com/mcp" } } }));
  await writeFile(join(options.cwd, ".mcp.json"), JSON.stringify({ mcpServers: { docs: { command: "node", "x-pi-dual": { roles: { A: { allowAllTools: false }, B: { excludeTools: ["delete"] } } } } } }));
  const config = await loadResolvedMcpConfig(options);
  const server = config.servers[0];
  expect(server?.transport).toBe("stdio"); expect(server?.url).toBeUndefined();
  for (const role of ["A", "B"] as const) {
    expect(isMcpToolCallAllowed(createRoleMcpPolicy(role, config.servers), "docs", { name: "delete", inputSchema: { type: "object" } }).allowed).toBe(false);
  }
});

it("withholds parser source snippets and honors --no-mcp", async () => {
  const options = await fixture();
  await writeFile(join(options.agentDir, "mcp.json"), '{"private":"dummy-private-secret');
  await expect(loadResolvedMcpConfig(options)).rejects.toThrow("Invalid MCP JSON config");
  await expect(loadResolvedMcpConfig(options)).rejects.not.toThrow("dummy-private-secret");
  expect(await loadResolvedMcpConfig({ ...options, enabled: false })).toMatchObject({ servers: [], configSources: [] });
});

it("honors explicit proxy-only and required global server settings", async () => {
  const options = await fixture();
  await writeFile(join(options.agentDir, "mcp.json"), JSON.stringify({ mcpServers: {
    docs: { url: "https://example.com/mcp", "x-pi-dual": { directTools: false, required: true } }
  } }));
  const config = await loadResolvedMcpConfig(options);
  expect(config.servers[0]).toMatchObject({ directTools: false, required: true });
});
