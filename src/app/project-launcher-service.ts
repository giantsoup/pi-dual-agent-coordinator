import { constants } from "node:fs";
import { access, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";

import type { PortalCliOptions } from "./cli.js";
import {
  applyCoordinatorDefaultsToCliOptions,
  getCoordinatorConfigDir,
  loadCoordinatorConfig
} from "./coordinator-config.js";
import { applyScopedSettingsToCliOptions } from "./settings-store.js";
import type { UiRecentProject } from "../types/ui.js";

const RECENT_PROJECTS_VERSION = 1;
const MAX_RECENT_PROJECTS = 20;

interface RecentProjectsFile {
  version: typeof RECENT_PROJECTS_VERSION;
  projects: Array<{
    path: string;
    lastOpenedAt: string;
  }>;
}

export interface ProjectPathValidationResult {
  ok: boolean;
  normalizedPath?: string | undefined;
  error?: string | undefined;
}

export class ProjectLauncherService {
  public normalizeProjectPath(input: string, currentCwd: string): string {
    const trimmed = input.trim();
    if (!trimmed) {
      throw new Error("Project path cannot be empty.");
    }

    const expanded = expandHomePath(trimmed);
    if (!isAbsolute(expanded)) {
      throw new Error(
        `Project path must be absolute or start with "~/" so PI Dual knows exactly which directory to open. Relative paths like ${resolve(currentCwd, expanded)} are not allowed here.`
      );
    }

    return resolve(expanded);
  }

  public async validateProjectPath(
    path: string,
    currentCwd = process.cwd()
  ): Promise<ProjectPathValidationResult> {
    let normalizedPath: string;
    try {
      normalizedPath = this.normalizeProjectPath(path, currentCwd);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }

    try {
      const resolvedPath = await realpath(normalizedPath);
      const target = await stat(resolvedPath);
      if (!target.isDirectory()) {
        return {
          ok: false,
          normalizedPath: resolvedPath,
          error: "Project path was not valid: it points to a file, not a directory."
        };
      }
      await access(resolvedPath, constants.R_OK);
      return {
        ok: true,
        normalizedPath: resolvedPath
      };
    } catch (error) {
      return {
        ok: false,
        normalizedPath,
        error: this.formatValidationError(error)
      };
    }
  }

  public async loadRecentProjects(): Promise<UiRecentProject[]> {
    const parsed = await this.readRecentProjectsFile();
    return parsed.projects.map((project) => ({
      path: project.path,
      name: basename(project.path) || project.path,
      lastOpenedAt: project.lastOpenedAt
    }));
  }

  public async recordRecentProject(path: string): Promise<void> {
    const normalizedPath = await realpath(path);
    const parsed = await this.readRecentProjectsFile();
    const lastOpenedAt = new Date().toISOString();
    const projects = [
      {
        path: normalizedPath,
        lastOpenedAt
      },
      ...parsed.projects.filter((project) => project.path !== normalizedPath)
    ].slice(0, MAX_RECENT_PROJECTS);

    await this.writeRecentProjectsFile({
      version: RECENT_PROJECTS_VERSION,
      projects
    });
  }

  public async resolvePortalThreadOptions(
    basePortalOptions: PortalCliOptions,
    newCwd: string
  ): Promise<PortalCliOptions> {
    const loadedConfig = await loadCoordinatorConfig();
    const nextOptions = await applyScopedSettingsToCliOptions({
      ...basePortalOptions,
      cwd: newCwd
    });
    return applyCoordinatorDefaultsToCliOptions(nextOptions, loadedConfig.config);
  }

  public getRecentProjectsPath(): string {
    return join(getCoordinatorConfigDir(), "recent-projects.json");
  }

  private async readRecentProjectsFile(): Promise<RecentProjectsFile> {
    try {
      const raw = await readFile(this.getRecentProjectsPath(), "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return normalizeRecentProjectsFile(parsed);
    } catch {
      return {
        version: RECENT_PROJECTS_VERSION,
        projects: []
      };
    }
  }

  private async writeRecentProjectsFile(file: RecentProjectsFile): Promise<void> {
    await mkdir(getCoordinatorConfigDir(), {
      recursive: true,
      mode: 0o700
    });
    await writeFile(this.getRecentProjectsPath(), `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }

  private formatValidationError(error: unknown): string {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return "Project path was not valid: directory does not exist.";
    }
    if (isNodeErrorWithCode(error, "ENOTDIR")) {
      return "Project path was not valid: one of the path segments is not a directory.";
    }
    if (isNodeErrorWithCode(error, "EACCES") || isNodeErrorWithCode(error, "EPERM")) {
      return "Project path was not valid: directory is not readable.";
    }
    return error instanceof Error
      ? `Project path was not valid: ${error.message}`
      : `Project path was not valid: ${String(error)}`;
  }
}

function expandHomePath(path: string): string {
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

function normalizeRecentProjectsFile(value: unknown): RecentProjectsFile {
  if (!isRecord(value) || value.version !== RECENT_PROJECTS_VERSION || !Array.isArray(value.projects)) {
    return {
      version: RECENT_PROJECTS_VERSION,
      projects: []
    };
  }

  const projects: RecentProjectsFile["projects"] = [];
  const seen = new Set<string>();
  for (const entry of value.projects) {
    if (!isRecord(entry) || typeof entry.path !== "string" || typeof entry.lastOpenedAt !== "string") {
      continue;
    }
    const normalizedPath = resolve(entry.path);
    if (seen.has(normalizedPath)) {
      continue;
    }
    seen.add(normalizedPath);
    projects.push({
      path: normalizedPath,
      lastOpenedAt: entry.lastOpenedAt
    });
    if (projects.length >= MAX_RECENT_PROJECTS) {
      break;
    }
  }

  return {
    version: RECENT_PROJECTS_VERSION,
    projects
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeErrorWithCode(
  error: unknown,
  code: string
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
