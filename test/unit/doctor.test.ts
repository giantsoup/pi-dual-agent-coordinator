import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { inspectRuntimeSetup, renderSetupReport } from "../../src/app/doctor.js";

function createTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "pi-dual-doctor-"));
}

describe("setup doctor", () => {
  it("reports a ready setup when required Pi files exist", async () => {
    const root = createTempRoot();
    const projectDir = join(root, "project");
    const agentDir = join(root, "agent");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(agentDir, { recursive: true });

    writeFileSync(
      join(agentDir, "auth.json"),
      JSON.stringify({
        openai: {
          type: "api_key",
          key: "OPENAI_API_KEY"
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
        expect.objectContaining({ name: "Agent B model", status: "pass" })
      ])
    );
  });

  it("reports missing auth and models files as failures", async () => {
    const root = createTempRoot();
    const projectDir = join(root, "project");
    const agentDir = join(root, "agent");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(agentDir, { recursive: true });

    const report = await inspectRuntimeSetup({
      cwd: projectDir,
      agentDir,
      mcpEnabled: false
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Pi auth file", status: "fail" }),
        expect.objectContaining({ name: "Pi models file", status: "fail" })
      ])
    );
  });
});
