import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { inspectRuntimeSetup, renderSetupReport } from "../../src/app/doctor.js";

it("reports isolation and missing secure credentials without accepting an environment key", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-doctor-"));
  try {
    const report = await inspectRuntimeSetup({ cwd, agentDir: cwd, modelA: "openai/gpt-5.4", modelB: "openai/gpt-5.4", mcpEnabled: false });
    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.name === "Agent A OS isolation")?.status).toBe("pass");
    expect(report.checks.find((check) => check.name === "OpenAI Keychain credential")?.status).toBe("fail");
    expect(renderSetupReport(report)).toContain("missing, locked, or unavailable");
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
it("rejects subscription models and legacy auth without evaluating secret commands", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-doctor-legacy-"));
  try {
    await writeFile(join(cwd, "auth.json"), JSON.stringify({ openai: { type: "api_key", key: "!echo never-evaluate-this" } }));
    const report = await inspectRuntimeSetup({ cwd, agentDir: cwd, modelA: "openai-codex/gpt-5.4", modelB: "openai/gpt-5.4", mcpEnabled: false });
    expect(report.checks.find((check) => check.name === "Agent A model")?.status).toBe("fail");
    expect(report.checks.find((check) => check.name === "Legacy OpenAI auth")?.status).toBe("fail");
    expect(renderSetupReport(report)).not.toContain("never-evaluate-this");
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
