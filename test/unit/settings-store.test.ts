import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { writeCoordinatorConfig } from "../../src/app/coordinator-config.js";
import {
  resolveUiSettingsState,
  saveUiSettings
} from "../../src/app/settings-store.js";

const ORIGINAL_HOME = process.env.PI_DUAL_COORDINATOR_HOME;

afterEach(() => {
  if (ORIGINAL_HOME === undefined) {
    delete process.env.PI_DUAL_COORDINATOR_HOME;
  } else {
    process.env.PI_DUAL_COORDINATOR_HOME = ORIGINAL_HOME;
  }
});

describe("settings store", () => {
  it("resolves CLI, thread, project, global, and legacy precedence", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-settings-store-"));
    process.env.PI_DUAL_COORDINATOR_HOME = root;

    await writeCoordinatorConfig({
      version: 1,
      defaults: {
        modelA: "openai/gpt-5.4",
        thinkingA: "low"
      }
    });
    await saveUiSettings({
      scope: "project",
      projectPath: "/tmp/project",
      values: {
        modelA: "anthropic/claude-sonnet-4",
        thinkingA: "medium",
        mcpEnabled: false
      }
    });
    await saveUiSettings({
      scope: "thread",
      projectPath: "/tmp/project",
      threadId: "thread-1",
      values: {
        modelA: "openai/gpt-5.4-mini",
        thinkingA: "high"
      }
    });

    const resolved = await resolveUiSettingsState({
      cli: {
        cwd: "/tmp/project",
        modelB: "local/qwen3-coder-next"
      },
      projectPath: "/tmp/project",
      threadId: "thread-1"
    });

    expect(resolved.effective.values.modelA).toBe("openai/gpt-5.4-mini");
    expect(resolved.effective.sources.modelA).toBe("thread");
    expect(resolved.effective.values.modelB).toBe("local/qwen3-coder-next");
    expect(resolved.effective.sources.modelB).toBe("cli");
    expect(resolved.effective.values.thinkingA).toBe("high");
    expect(resolved.effective.sources.thinkingA).toBe("thread");
    expect(resolved.effective.values.thinkingB).toBe("medium");
    expect(resolved.effective.sources.thinkingB).toBe("legacy");
    expect(resolved.effective.values.mcpEnabled).toBe(false);
    expect(resolved.effective.sources.mcpEnabled).toBe("project");
  });
});
