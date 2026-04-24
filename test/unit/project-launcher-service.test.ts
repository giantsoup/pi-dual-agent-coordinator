import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { writeCoordinatorConfig } from "../../src/app/coordinator-config.js";
import { ProjectLauncherService } from "../../src/app/project-launcher-service.js";
import { saveUiSettings } from "../../src/app/settings-store.js";

const ORIGINAL_HOME = process.env.PI_DUAL_COORDINATOR_HOME;
const ORIGINAL_USER_HOME = process.env.HOME;

afterEach(() => {
  if (ORIGINAL_HOME === undefined) {
    delete process.env.PI_DUAL_COORDINATOR_HOME;
  } else {
    process.env.PI_DUAL_COORDINATOR_HOME = ORIGINAL_HOME;
  }

  if (ORIGINAL_USER_HOME === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = ORIGINAL_USER_HOME;
  }
});

describe("project launcher service", () => {
  it("expands ~/ paths during validation", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-project-launcher-home-"));
    const projectDir = join(root, "Sites", "print-for-me");
    mkdirSync(projectDir, { recursive: true });
    process.env.HOME = root;

    const service = new ProjectLauncherService();
    const result = await service.validateProjectPath("~/Sites/print-for-me");

    expect(result).toEqual({
      ok: true,
      normalizedPath: realpathSync(projectDir)
    });
  });

  it("rejects an empty path", async () => {
    const service = new ProjectLauncherService();
    const result = await service.validateProjectPath("   ");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("cannot be empty");
  });

  it("rejects a relative path", async () => {
    const service = new ProjectLauncherService();
    const result = await service.validateProjectPath("./project", "/tmp/current");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("must be absolute");
  });

  it("rejects a non-existent path", async () => {
    const service = new ProjectLauncherService();
    const result = await service.validateProjectPath("/tmp/does-not-exist-project-launcher");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Project path was not valid: directory does not exist.");
  });

  it("rejects a file path", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-project-launcher-file-"));
    const filePath = join(root, "notes.txt");
    writeFileSync(filePath, "hello");

    const service = new ProjectLauncherService();
    const result = await service.validateProjectPath(filePath);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("file, not a directory");
  });

  it("accepts a readable directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-project-launcher-dir-"));
    const projectDir = join(root, "project");
    mkdirSync(projectDir, { recursive: true });

    const service = new ProjectLauncherService();
    const result = await service.validateProjectPath(projectDir);

    expect(result).toEqual({
      ok: true,
      normalizedPath: realpathSync(projectDir)
    });
  });

  it("de-duplicates recent projects and keeps newest first", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-project-launcher-recents-"));
    process.env.PI_DUAL_COORDINATOR_HOME = root;
    const projectA = join(root, "project-a");
    const projectB = join(root, "project-b");
    mkdirSync(projectA, { recursive: true });
    mkdirSync(projectB, { recursive: true });

    const service = new ProjectLauncherService();
    await service.recordRecentProject(projectA);
    await service.recordRecentProject(projectB);
    await service.recordRecentProject(projectA);

    const recent = await service.loadRecentProjects();
    expect(recent.map((project) => project.path)).toEqual([
      realpathSync(projectA),
      realpathSync(projectB)
    ]);
  });

  it("caps recent projects at twenty entries", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-project-launcher-cap-"));
    process.env.PI_DUAL_COORDINATOR_HOME = root;
    const service = new ProjectLauncherService();

    for (let index = 0; index < 22; index += 1) {
      const projectPath = join(root, `project-${index}`);
      mkdirSync(projectPath, { recursive: true });
      await service.recordRecentProject(projectPath);
    }

    const recent = await service.loadRecentProjects();
    expect(recent).toHaveLength(20);
    expect(recent[0]?.path).toBe(realpathSync(join(root, "project-21")));
    expect(recent[19]?.path).toBe(realpathSync(join(root, "project-2")));

    const persisted = JSON.parse(readFileSync(service.getRecentProjectsPath(), "utf8")) as {
      projects: Array<{ path: string }>;
    };
    expect(persisted.projects).toHaveLength(20);
  });

  it("resolves portal thread options with CLI precedence over project and global defaults", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-project-launcher-options-"));
    process.env.PI_DUAL_COORDINATOR_HOME = root;
    const projectDir = join(root, "project");
    mkdirSync(projectDir, { recursive: true });

    await writeCoordinatorConfig({
      version: 1,
      defaults: {
        modelA: "global/model-a",
        modelB: "global/model-b",
        thinkingA: "low",
        thinkingB: "medium"
      }
    });
    await saveUiSettings({
      scope: "project",
      projectPath: projectDir,
      values: {
        modelB: "project/model-b",
        thinkingB: "off",
        mcpEnabled: false
      }
    });

    const service = new ProjectLauncherService();
    const options = await service.resolvePortalThreadOptions(
      {
        command: "portal",
        cwd: "/tmp/original",
        sessionMode: "persistent",
        jsonLogs: false,
        verbose: false,
        modelA: "cli/model-a",
        thinkingA: "high",
        maxReviewRounds: 3,
        mcpEnabled: true,
        port: 4317
      },
      projectDir
    );

    expect(options.cwd).toBe(projectDir);
    expect(options.modelA).toBe("cli/model-a");
    expect(options.modelB).toBe("project/model-b");
    expect(options.thinkingA).toBe("high");
    expect(options.thinkingB).toBe("off");
    expect(options.mcpEnabled).toBe(true);
  });
});
