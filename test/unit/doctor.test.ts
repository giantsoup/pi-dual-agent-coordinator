import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { inspectRuntimeSetup, renderSetupReport } from "../../src/app/doctor.js";

function createTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "pi-dual-doctor-"));
}

describe("setup doctor", () => {
  const previousHome = process.env.PI_DUAL_COORDINATOR_HOME;

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    if (previousHome === undefined) {
      delete process.env.PI_DUAL_COORDINATOR_HOME;
    } else {
      process.env.PI_DUAL_COORDINATOR_HOME = previousHome;
    }
  });

  it("reports a ready setup when valid API auth and models exist", async () => {
    const root = createTempRoot();
    process.env.PI_DUAL_COORDINATOR_HOME = root;
    const projectDir = join(root, "project");
    const agentDir = join(root, "agent");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(agentDir, { recursive: true });

    writeFileSync(
      join(agentDir, "auth.json"),
      JSON.stringify({
        openai: {
          type: "api_key",
          key: "sk-test-123"
        }
      })
    );
    writeFileSync(
      join(agentDir, "models.json"),
      JSON.stringify({
        providers: {
          "local-qwen": {
            baseUrl: "http://127.0.0.1:1234/v1",
            api: "openai-completions",
            apiKey: "lm-studio",
            compat: {
              supportsDeveloperRole: false,
              supportsReasoningEffort: false
            },
            models: [
              {
                id: "qwen3-coder-next",
                name: "Qwen3 Coder Next (LM Studio)",
                reasoning: false,
                input: ["text"],
                contextWindow: 131072,
                maxTokens: 16384,
                cost: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0
                }
              }
            ]
          }
        }
      })
    );

    const report = await inspectRuntimeSetup({
      cwd: projectDir,
      agentDir,
      modelA: "openai/gpt-5.4",
      modelB: "local-qwen/qwen3-coder-next",
      mcpEnabled: false
    });

    expect(report.ok).toBe(true);
    expect(renderSetupReport(report)).toContain("Result: ready to run.");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Agent A model", status: "pass" }),
        expect.objectContaining({ name: "Agent A auth", status: "pass" }),
        expect.objectContaining({ name: "Agent B model", status: "pass" })
      ])
    );
  });

  it("fails with setup guidance when a saved openai-codex default lacks OAuth auth", async () => {
    const root = createTempRoot();
    process.env.PI_DUAL_COORDINATOR_HOME = root;
    const projectDir = join(root, "project");
    const agentDir = join(root, "agent");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(join(root, "dual-agent-coordinator"), { recursive: true });

    writeFileSync(
      join(root, "dual-agent-coordinator", "config.json"),
      JSON.stringify({
        version: 1,
        defaults: {
          modelA: "openai-codex/gpt-5.4"
        }
      })
    );

    const report = await inspectRuntimeSetup({
      cwd: projectDir,
      agentDir,
      mcpEnabled: false
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Agent A model", status: "pass" }),
        expect.objectContaining({
          name: "Agent A auth",
          status: "fail",
          detail: expect.stringContaining("browser window will open for ChatGPT login")
        })
      ])
    );
  });

  it("fails with setup guidance when openai auth is missing", async () => {
    const root = createTempRoot();
    process.env.PI_DUAL_COORDINATOR_HOME = root;
    const projectDir = join(root, "project");
    const agentDir = join(root, "agent");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(agentDir, { recursive: true });

    const report = await inspectRuntimeSetup({
      cwd: projectDir,
      agentDir,
      modelA: "openai/gpt-5.4",
      mcpEnabled: false
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Agent A auth",
          status: "fail",
          detail: expect.stringContaining("Run `pi-dual setup`")
        })
      ])
    );
  });

  it("passes when valid subscription auth exists", async () => {
    const root = createTempRoot();
    process.env.PI_DUAL_COORDINATOR_HOME = root;
    const projectDir = join(root, "project");
    const agentDir = join(root, "agent");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(agentDir, { recursive: true });

    writeFileSync(
      join(agentDir, "auth.json"),
      JSON.stringify({
        "openai-codex": {
          type: "oauth",
          access: "token",
          refresh: "refresh",
          expires: Date.now() + 60_000,
          accountId: "acct_123"
        }
      })
    );

    const report = await inspectRuntimeSetup({
      cwd: projectDir,
      agentDir,
      modelA: "openai-codex/gpt-5.4",
      mcpEnabled: false
    });

    expect(report.ok).toBe(true);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Agent A auth", status: "pass" })
      ])
    );
  });

  it("warns instead of crashing when the coordinator config is invalid", async () => {
    const root = createTempRoot();
    process.env.PI_DUAL_COORDINATOR_HOME = root;
    const projectDir = join(root, "project");
    const agentDir = join(root, "agent");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(join(root, "dual-agent-coordinator"), { recursive: true });

    writeFileSync(join(root, "dual-agent-coordinator", "config.json"), "{not-json", "utf8");

    const report = await inspectRuntimeSetup({
      cwd: projectDir,
      agentDir,
      mcpEnabled: false
    });

    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Coordinator config",
          status: "warn"
        })
      ])
    );
  });
});
