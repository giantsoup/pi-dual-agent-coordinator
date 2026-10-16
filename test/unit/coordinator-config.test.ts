import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyCoordinatorDefaultsToCliOptions,
  getCoordinatorConfigPath,
  loadCoordinatorConfig,
  writeCoordinatorConfig
} from "../../src/app/coordinator-config.js";

describe("coordinator config", () => {
  const previousHome = process.env.PI_DUAL_COORDINATOR_HOME;

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.PI_DUAL_COORDINATOR_HOME;
    } else {
      process.env.PI_DUAL_COORDINATOR_HOME = previousHome;
    }
  });

  it("creates and reads a valid config", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-config-"));
    process.env.PI_DUAL_COORDINATOR_HOME = root;

    await writeCoordinatorConfig({
      version: 1,
      defaults: {
        modelA: "openai/gpt-5.4"
      },
      onboarding: {
        lastSelectedAgentAAuthFlow: "openai-api-key",
        lastCompletedAt: "2026-04-20T00:00:00.000Z"
      }
    });

    const loaded = await loadCoordinatorConfig();
    expect(loaded.exists).toBe(true);
    expect(loaded.path).toBe(getCoordinatorConfigPath());
    expect(loaded.config?.defaults.modelA).toBe("openai/gpt-5.4");
    expect(loaded.warnings).toEqual([]);
  });

  it("returns a warning-safe fallback for invalid JSON", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-config-invalid-"));
    process.env.PI_DUAL_COORDINATOR_HOME = root;
    const configPath = getCoordinatorConfigPath();
    mkdirSync(join(root, "dual-agent-coordinator"), { recursive: true });
    writeFileSync(configPath, "{not valid json", "utf8");

    const loaded = await loadCoordinatorConfig();
    expect(loaded.exists).toBe(true);
    expect(loaded.config).toBeUndefined();
    expect(loaded.warnings[0]).toContain("could not be parsed");
  });

  it("reports invalid deadline and review limits instead of silently defaulting", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-config-limits-"));
    process.env.PI_DUAL_COORDINATOR_HOME = root;
    await writeCoordinatorConfig({version:1,defaults:{maxReviewRounds:4,timeoutMs:12000}});
    expect((await loadCoordinatorConfig()).config?.defaults).toMatchObject({maxReviewRounds:4,timeoutMs:12000});
    writeFileSync(getCoordinatorConfigPath(),JSON.stringify({version:1,defaults:{maxReviewRounds:0,timeoutMs:2147483648}}));
    const loaded = await loadCoordinatorConfig();
    expect(loaded.config?.defaults).toEqual({});
    expect(loaded.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("defaults.maxReviewRounds"),expect.stringContaining("defaults.timeoutMs")
    ]));
  });

  it("lets explicit CLI model-a override the saved default", () => {
    const resolved = applyCoordinatorDefaultsToCliOptions(
      {
        command: "repl",
        cwd: "/tmp/project",
        sessionMode: "memory",
        jsonLogs: false,
        verbose: false,
        maxReviewRounds: 3,
        modelA: "openai-codex/gpt-5.4"
      },
      {
        version: 1,
        defaults: {
          modelA: "openai/gpt-5.4"
        }
      }
    );

    expect(resolved.modelA).toBe("openai-codex/gpt-5.4");
  });

  it("uses the saved default when model-a is omitted", () => {
    const resolved = applyCoordinatorDefaultsToCliOptions(
      {
        command: "doctor",
        cwd: "/tmp/project"
      },
      {
        version: 1,
        defaults: {
          modelA: "openai/gpt-5.4"
        }
      }
    );

    expect(resolved.modelA).toBe("openai/gpt-5.4");
  });

  it("applies saved thinking defaults to terminal runs", () => {
    const resolved = applyCoordinatorDefaultsToCliOptions(
      {
        command: "repl",
        cwd: "/tmp/project",
        sessionMode: "memory",
        jsonLogs: false,
        verbose: false,
        maxReviewRounds: 3
      },
      {
        version: 1,
        defaults: {
          modelA: "openai/gpt-5.4",
          thinkingA: "high"
        }
      }
    );

    expect(resolved).toMatchObject({
      command: "repl",
      modelA: "openai/gpt-5.4",
      thinkingA: "high"
    });
  });
});
