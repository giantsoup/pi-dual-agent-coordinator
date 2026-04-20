import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createMcpExtension } from "../../src/mcp/extension.js";
import type { ResolvedMcpConfig } from "../../src/mcp/types.js";

const FIXTURE_SERVER_PATH = join(
  process.cwd(),
  "test",
  "fixtures",
  "fake-mcp-server.mjs"
);

describe("mcp extension", () => {
  it("fails startup when a required direct-tool server cannot initialize", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-mcp-ext-fail-"));
    const extension = createMcpExtension({
      role: "B",
      config: {
        enabled: true,
        projectRoot: root,
        cacheFile: join(root, "mcp-cache.json"),
        configSources: [],
        servers: [
          {
            name: "laravel-boost",
            command: join(root, "missing-command"),
            args: [],
            transport: "stdio",
            directTools: true,
            lifecycle: "lazy",
            idleTimeoutMinutes: 10,
            required: true,
            roleOverrides: {},
            sourcePaths: [],
            fingerprint: "missing"
          }
        ]
      }
    });

    const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>();
    extension?.extensionFactory({
      registerTool() {},
      on(event: string, handler: (...args: unknown[]) => unknown) {
        registeredHandlers.set(event, handler as (...args: unknown[]) => unknown);
      }
    } as never);

    await expect(
      registeredHandlers.get("session_start")?.()
    ).rejects.toThrow("Failed to initialize required MCP server laravel-boost");
  });

  it("registers only role-safe direct tools for Agent A", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-mcp-ext-safe-"));
    const config: ResolvedMcpConfig = {
      enabled: true,
      projectRoot: root,
      cacheFile: join(root, "mcp-cache.json"),
      configSources: [],
      servers: [
        {
          name: "fixture",
          command: process.execPath,
          args: [FIXTURE_SERVER_PATH],
          transport: "stdio",
          directTools: true,
          lifecycle: "lazy",
          idleTimeoutMinutes: 10,
          required: true,
          roleOverrides: {},
          sourcePaths: [],
          fingerprint: "fixture"
        }
      ]
    };

    const extension = createMcpExtension({
      role: "A",
      config
    });
    const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>();
    const registeredTools: string[] = [];

    extension?.extensionFactory({
      registerTool(tool: { name: string }) {
        registeredTools.push(tool.name);
      },
      on(event: string, handler: (...args: unknown[]) => unknown) {
        registeredHandlers.set(event, handler as (...args: unknown[]) => unknown);
      }
    } as never);

    await registeredHandlers.get("session_start")?.();

    expect(registeredTools).toContain("mcp");
    expect(registeredTools).toContain("echo");
    expect(registeredTools).not.toContain("destroy");

    await extension?.dispose();
  });
});
