import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runSetupWizard, runAuthWizard } from "../../src/app/setup.js";
import type { CoordinatorConfigV1 } from "../../src/app/coordinator-config.js";

describe("secure setup", () => {
  it("verifies isolation before private entry and leaves unrelated credentials intact", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-setup-"));
    const cwd = join(root, "workspace"), agentDir = join(root, "agent");
    await mkdir(cwd); await mkdir(agentDir);
    const auth = JSON.stringify({ unrelated: { type: "api_key", key: "PRESERVE_THIS_REFERENCE" } });
    await writeFile(join(agentDir, "auth.json"), auth);
    const calls: string[] = [];
    let config: CoordinatorConfigV1 | undefined;
    try {
      expect(await runSetupWizard({ command: "setup", cwd, agentDir }, {
        stdout: { write: () => true },
        verify: async () => { calls.push("verify"); return { assertions: 200, categories: {} }; },
        enter: async () => { calls.push("private-entry"); },
        loadConfig: async () => ({ path: "config", exists: false, warnings: [] }),
        writeConfig: async (value) => { config = value; }
      })).toBe(0);
      expect(calls).toEqual(["verify", "private-entry"]);
      expect(config?.defaults).toEqual({ modelA: "openai/gpt-6-luna", modelB: "lm-studio/qwen/qwen3.8-27b", thinkingA: "high", thinkingB: "off" });
      expect(await readFile(join(agentDir, "auth.json"), "utf8")).toBe(auth);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("does not open private entry when isolation is unavailable", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-setup-fail-"));
    let entered = false, message = "";
    try {
      expect(await runAuthWizard({ command: "auth", cwd, agentDir: join(cwd, "missing") }, {
        stdout: { write: () => true }, stderr: { write: (text: string) => { message += text; return true; } },
        verify: async () => { throw new Error("Isolation unavailable"); },
        enter: async () => { entered = true; }
      })).toBe(1);
      expect(entered).toBe(false); expect(message).toContain("Isolation unavailable");
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
  it("rejects legacy plaintext auth without modifying it or repeating its value", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-setup-legacy-"));
    const legacy = JSON.stringify({ openai: { type: "api_key", key: "legacy-dummy-secret" }, other: {} });
    await writeFile(join(cwd, "auth.json"), legacy);
    let output = "";
    try {
      expect(await runAuthWizard({ command: "auth", cwd, agentDir: cwd }, {
        stderr: { write: (text: string) => { output += text; return true; } }
      })).toBe(1);
      expect(output).toContain("Legacy openai"); expect(output).not.toContain("legacy-dummy-secret");
      expect(await readFile(join(cwd, "auth.json"), "utf8")).toBe(legacy);
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
});
