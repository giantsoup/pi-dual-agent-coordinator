import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadResolvedMcpConfig } from "../../src/mcp/config-loader.js";

describe("mcp config loader", () => {
  it("merges global, project, and explicit config sources in precedence order", async () => {
    const root = join(tmpdir(), `pi-dual-mcp-config-${Date.now()}-${Math.random()}`);
    const agentDir = join(root, "agent");
    const cwd = join(root, "project");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(cwd, { recursive: true });

    writeFileSync(
      join(agentDir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          shared: {
            command: "global-command",
            args: ["global"],
            "x-pi-dual": {
              lifecycle: "lazy"
            }
          }
        }
      })
    );
    writeFileSync(
      join(cwd, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          shared: {
            command: "project-command",
            args: ["project"],
            "x-pi-dual": {
              roles: {
                A: {
                  allowTools: ["project-tool"]
                }
              }
            }
          },
          "laravel-boost": {
            command: "php",
            args: ["artisan", "boost:mcp"]
          }
        }
      })
    );
    const explicit = join(root, "explicit.mcp.json");
    writeFileSync(
      explicit,
      JSON.stringify({
        mcpServers: {
          shared: {
            command: "explicit-command",
            args: ["explicit"],
            "x-pi-dual": {
              directTools: true
            }
          }
        }
      })
    );

    const resolved = await loadResolvedMcpConfig({
      cwd,
      agentDir,
      enabled: true,
      explicitConfigPaths: [explicit]
    });

    expect(resolved.configSources).toEqual([
      join(agentDir, "mcp.json"),
      join(cwd, ".mcp.json"),
      explicit
    ]);

    const shared = resolved.servers.find((server) => server.name === "shared");
    expect(shared?.command).toBe("explicit-command");
    expect(shared?.args).toEqual(["explicit"]);
    expect(shared?.directTools).toBe(true);
    expect(shared?.roleOverrides.A?.allowTools).toEqual(["project-tool"]);

    const boost = resolved.servers.find((server) => server.name === "laravel-boost");
    expect(boost?.directTools).toBe(true);
    expect(boost?.required).toBe(true);
    expect(boost?.transport).toBe("stdio");
  });

  it("parses a boost-style project config unchanged", async () => {
    const root = join(tmpdir(), `pi-dual-mcp-boost-${Date.now()}-${Math.random()}`);
    const agentDir = join(root, "agent");
    const cwd = join(root, "project");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(cwd, { recursive: true });

    writeFileSync(
      join(cwd, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          "laravel-boost": {
            command: "php",
            args: ["artisan", "boost:mcp"]
          },
          herd: {
            command: "php",
            args: ["herd-mcp.phar"],
            env: {
              SITE_PATH: cwd
            }
          }
        }
      })
    );

    const resolved = await loadResolvedMcpConfig({
      cwd,
      agentDir,
      enabled: true
    });

    const boost = resolved.servers.find((server) => server.name === "laravel-boost");
    const herd = resolved.servers.find((server) => server.name === "herd");

    expect(boost?.command).toBe("php");
    expect(boost?.args).toEqual(["artisan", "boost:mcp"]);
    expect(boost?.directTools).toBe(true);
    expect(herd?.env).toEqual({ SITE_PATH: cwd });
    expect(herd?.directTools).toBe(false);
  });
});
