import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { Coordinator } from "../../src/coordinator/coordinator.js";
import type { CreateRoleRuntimeOptions } from "../../src/runtime/create-role-runtime.js";
import { createFakeBinding, FakeRuntime, FakeSession } from "../helpers/fakes.js";

describe("runtime bootstrap", () => {
  it("boots both runtimes independently", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-bootstrap-"));
    const runtimes = new Map<string, FakeRuntime>();

    const coordinator = new Coordinator({
      cwd: process.cwd(),
      sessionRoot: root,
      sessionMode: "memory",
      jsonLogs: false,
      verbose: false,
      createRoleRuntime: async (options: CreateRoleRuntimeOptions) => {
        const session = new FakeSession(
          `${options.role}-session-1`,
          join(root, `${options.role}.jsonl`)
        );
        const runtime = new FakeRuntime(process.cwd(), session, options.role);
        runtimes.set(options.role, runtime);
        return createFakeBinding(options.role, runtime);
      }
    });

    await coordinator.start();
    const status = coordinator.getStatus();
    const runtimeStatus = status.runtimes;

    expect(runtimeStatus).toHaveLength(2);
    expect(runtimeStatus[0]?.sessionId).not.toBe(runtimeStatus[1]?.sessionId);
    expect(status.phase).toBe("planning");
    expect(status.activeRole).toBe("A");
    expect(runtimeStatus[0]?.modelDisplay).toBeTruthy();
    expect(status.mcp?.enabled).toBe(false);
    expect(runtimes.get("A")?.createdSessions).toHaveLength(1);
    expect(runtimes.get("B")?.createdSessions).toHaveLength(1);

    await coordinator.dispose();
  });

  it("resolves MCP config once and passes it into both role runtimes", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-bootstrap-mcp-"));
    writeFileSync(
      join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          "laravel-boost": {
            command: "php",
            args: ["artisan", "boost:mcp"]
          }
        }
      })
    );

    const seen = new Map<string, CreateRoleRuntimeOptions>();
    const coordinator = new Coordinator({
      cwd: root,
      sessionRoot: root,
      sessionMode: "memory",
      jsonLogs: false,
      verbose: false,
      mcpEnabled: true,
      mcpConfigPaths: [],
      createRoleRuntime: async (options: CreateRoleRuntimeOptions) => {
        seen.set(options.role, options);
        const session = new FakeSession(
          `${options.role}-session-1`,
          join(root, `${options.role}.jsonl`)
        );
        const runtime = new FakeRuntime(root, session, options.role);
        return createFakeBinding(options.role, runtime);
      }
    });

    await coordinator.start();

    expect(seen.get("A")?.mcp?.servers[0]?.name).toBe("laravel-boost");
    expect(seen.get("B")?.mcp?.servers[0]?.name).toBe("laravel-boost");
    expect(coordinator.getStatus().mcp?.configSources).toEqual([join(root, ".mcp.json")]);

    await coordinator.dispose();
  });
});
