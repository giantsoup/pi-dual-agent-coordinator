import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  loadWorkspaceIndex,
  writeThreadManifest
} from "../../src/app/workspace-index.js";

const ORIGINAL_HOME = process.env.PI_DUAL_COORDINATOR_HOME;

afterEach(() => {
  if (ORIGINAL_HOME === undefined) {
    delete process.env.PI_DUAL_COORDINATOR_HOME;
  } else {
    process.env.PI_DUAL_COORDINATOR_HOME = ORIGINAL_HOME;
  }
});

describe("workspace index", () => {
  it("groups local threads by project and sorts by updated time", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-workspace-index-"));
    process.env.PI_DUAL_COORDINATOR_HOME = root;

    await writeThreadManifest({
      threadId: "thread-1",
      threadTitle: "Old Thread",
      projectPath: "/tmp/project-a",
      projectHash: "project-a",
      projectName: "project-a",
      threadStartedAt: "2026-04-20T00:00:00.000Z",
      threadUpdatedAt: "2026-04-20T00:01:00.000Z",
      latestStatus: "planning",
      resumable: false
    });
    await writeThreadManifest({
      threadId: "thread-2",
      threadTitle: "New Thread",
      projectPath: "/tmp/project-a",
      projectHash: "project-a",
      projectName: "project-a",
      threadStartedAt: "2026-04-20T00:02:00.000Z",
      threadUpdatedAt: "2026-04-20T00:03:00.000Z",
      latestStatus: "execution",
      resumable: true
    });

    const index = await loadWorkspaceIndex({
      activeThreadId: "thread-2"
    });

    expect(index.workspace.projects).toHaveLength(1);
    expect(index.workspace.projects[0]?.threads.map((thread) => thread.threadId)).toEqual([
      "thread-2",
      "thread-1"
    ]);
    expect(index.workspace.threads[0]?.isActive).toBe(true);
  });
});
