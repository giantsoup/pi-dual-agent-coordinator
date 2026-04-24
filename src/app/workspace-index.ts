import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { getCoordinatorConfigDir } from "./coordinator-config.js";
import type { CoordinatorStatusSnapshot } from "../types/status.js";
import type {
  UiActivityState,
  UiConversationEntry,
  UiNotification,
  UiPendingPlanState,
  UiTimelineItem,
  UiWorkspaceProject,
  UiWorkspaceState
} from "../types/ui.js";

const PERSISTED_THREAD_VIEW_VERSION = 1;

export interface PersistedThreadManifest {
  threadId: string;
  threadTitle: string;
  projectPath: string;
  projectHash: string;
  projectName: string;
  sessionRoot?: string | undefined;
  threadStartedAt: string;
  threadUpdatedAt: string;
  latestStatus: string;
  latestSummary?: string | undefined;
  activeModelA?: string | undefined;
  activeModelB?: string | undefined;
  resumable: boolean;
}

export interface PersistedThreadView {
  version: typeof PERSISTED_THREAD_VIEW_VERSION;
  savedAt: string;
  status: CoordinatorStatusSnapshot;
  conversation: UiConversationEntry[];
  timeline: UiTimelineItem[];
  activity: UiActivityState;
  pendingPlan?: UiPendingPlanState | undefined;
  notification?: UiNotification | undefined;
  lastError?: UiNotification | undefined;
}

export interface WorkspaceIndexSnapshot {
  manifests: PersistedThreadManifest[];
  workspace: UiWorkspaceState;
}

export function createProjectHash(projectPath: string): string {
  return createHash("sha256")
    .update(resolve(projectPath))
    .digest("hex")
    .slice(0, 16);
}

export function getWorkspaceProjectsDir(): string {
  return join(getCoordinatorConfigDir(), "projects");
}

export function getWorkspaceProjectDir(projectPath: string): string {
  return join(getWorkspaceProjectsDir(), createProjectHash(projectPath));
}

export function getWorkspaceThreadsDir(): string {
  return join(getCoordinatorConfigDir(), "threads");
}

export function getWorkspaceThreadDir(threadId: string): string {
  return join(getWorkspaceThreadsDir(), threadId);
}

export function getThreadManifestPath(threadId: string): string {
  return join(getWorkspaceThreadDir(threadId), "manifest.json");
}

export function getThreadViewPath(threadId: string): string {
  return join(getWorkspaceThreadDir(threadId), "state.json");
}

export async function writeThreadManifest(
  manifest: PersistedThreadManifest
): Promise<void> {
  const target = getThreadManifestPath(manifest.threadId);
  await mkdir(getWorkspaceThreadDir(manifest.threadId), {
    recursive: true,
    mode: 0o700
  });
  await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export async function readThreadManifest(
  threadId: string
): Promise<PersistedThreadManifest | undefined> {
  return parseJsonFile<PersistedThreadManifest>(getThreadManifestPath(threadId));
}

export async function writeThreadView(
  threadId: string,
  view: PersistedThreadView
): Promise<void> {
  const target = getThreadViewPath(threadId);
  await mkdir(getWorkspaceThreadDir(threadId), {
    recursive: true,
    mode: 0o700
  });
  await writeFile(target, `${JSON.stringify(view, null, 2)}\n`, "utf8");
}

export async function readThreadView(
  threadId: string
): Promise<PersistedThreadView | undefined> {
  const parsed = await parseJsonFile<PersistedThreadView>(getThreadViewPath(threadId));
  if (!parsed || parsed.version !== PERSISTED_THREAD_VIEW_VERSION) {
    return undefined;
  }
  return parsed;
}

export async function loadWorkspaceIndex(input: {
  activeThreadId?: string | undefined;
  selectedThreadId?: string | undefined;
} = {}): Promise<WorkspaceIndexSnapshot> {
  const manifests = await loadAllThreadManifests();
  const projectEntries = new Map<string, UiWorkspaceProject>();

  for (const manifest of manifests) {
    const existing =
      projectEntries.get(manifest.projectHash) ??
      {
        id: manifest.projectHash,
        projectHash: manifest.projectHash,
        projectName: manifest.projectName,
        projectPath: manifest.projectPath,
        threads: []
      };
    existing.threads.push({
      id: manifest.threadId,
      threadId: manifest.threadId,
      title: manifest.threadTitle,
      projectHash: manifest.projectHash,
      projectName: manifest.projectName,
      projectPath: manifest.projectPath,
      startedAt: manifest.threadStartedAt,
      updatedAt: manifest.threadUpdatedAt,
      latestStatus: manifest.latestStatus,
      latestSummary: manifest.latestSummary,
      activeModelA: manifest.activeModelA,
      activeModelB: manifest.activeModelB,
      resumable: manifest.resumable,
      isActive: manifest.threadId === input.activeThreadId
    });
    projectEntries.set(manifest.projectHash, existing);
  }

  const projects = [...projectEntries.values()]
    .map((project) => ({
      ...project,
      threads: [...project.threads].sort(compareThreadsByUpdatedAtDesc)
    }))
    .sort((left, right) => {
      const leftUpdatedAt = left.threads[0]?.updatedAt ?? "";
      const rightUpdatedAt = right.threads[0]?.updatedAt ?? "";
      return rightUpdatedAt.localeCompare(leftUpdatedAt);
    });

  const threads = projects.flatMap((project) => project.threads);
  const selectedThreadId =
    input.selectedThreadId && threads.some((thread) => thread.threadId === input.selectedThreadId)
      ? input.selectedThreadId
      : input.activeThreadId ?? threads[0]?.threadId;

  return {
    manifests,
    workspace: {
      projects,
      recentProjects: [],
      threads,
      activeThreadId: input.activeThreadId,
      selectedThreadId
    }
  };
}

export function buildThreadManifest(input: {
  status: CoordinatorStatusSnapshot;
  latestSummary?: string | undefined;
}): PersistedThreadManifest {
  return {
    threadId: input.status.threadId,
    threadTitle: input.status.threadTitle,
    projectPath: input.status.cwd,
    projectHash: createProjectHash(input.status.cwd),
    projectName: basename(input.status.cwd) || input.status.cwd,
    sessionRoot: input.status.sessionRoot,
    threadStartedAt: input.status.threadStartedAt,
    threadUpdatedAt: input.status.threadUpdatedAt,
    latestStatus: input.status.workflowStatus ?? input.status.phase,
    latestSummary: input.latestSummary ?? input.status.lastSummary ?? input.status.lastCompletionSummary,
    activeModelA: input.status.runtimes.find((runtime) => runtime.role === "A")?.modelDisplay,
    activeModelB: input.status.runtimes.find((runtime) => runtime.role === "B")?.modelDisplay,
    resumable: Boolean(input.status.pendingPlanReady || input.status.activeWorkflowId)
  };
}

async function loadAllThreadManifests(): Promise<PersistedThreadManifest[]> {
  const threadsDir = getWorkspaceThreadsDir();
  const threadIds = await safeReadDirNames(threadsDir);
  const manifests = await Promise.all(threadIds.map((threadId) => readThreadManifest(threadId)));
  return manifests
    .filter((manifest): manifest is PersistedThreadManifest => Boolean(manifest))
    .sort(compareManifestsByUpdatedAtDesc);
}

async function safeReadDirNames(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, {
      withFileTypes: true
    });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function parseJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function compareManifestsByUpdatedAtDesc(
  left: PersistedThreadManifest,
  right: PersistedThreadManifest
): number {
  return compareThreadsByUpdatedAtDesc(
    {
      updatedAt: left.threadUpdatedAt
    },
    {
      updatedAt: right.threadUpdatedAt
    }
  );
}

function compareThreadsByUpdatedAtDesc(
  left: { updatedAt: string },
  right: { updatedAt: string }
): number {
  return right.updatedAt.localeCompare(left.updatedAt);
}
