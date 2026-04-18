import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { Coordinator } from "../../src/coordinator/coordinator.js";
import type { CreateRoleRuntimeOptions } from "../../src/runtime/create-role-runtime.js";
import { createFakeBinding, FakeRuntime, FakeSession } from "../helpers/fakes.js";

describe("runtime bootstrap", () => {
  it("boots both runtimes independently", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-bootstrap-"));
    const runtimes = new Map<string, FakeRuntime>();

    const coordinator = new Coordinator({
      cwd: process.cwd(),
      sessionRoot: root,
      sessionMode: "memory",
      jsonLogs: false,
      verbose: false,
      createRoleRuntime: async (options: CreateRoleRuntimeOptions) => {
        const session = new FakeSession(
          `${options.role}-session-1`,
          join(root, `${options.role}.jsonl`)
        );
        const runtime = new FakeRuntime(process.cwd(), session, options.role);
        runtimes.set(options.role, runtime);
        return createFakeBinding(options.role, runtime);
      }
    });

    await coordinator.start();
    const status = coordinator.getStatus();
    const runtimeStatus = status.runtimes as Array<{ role: string; sessionId: string }>;

    expect(runtimeStatus).toHaveLength(2);
    expect(runtimeStatus[0]?.sessionId).not.toBe(runtimeStatus[1]?.sessionId);
    expect(runtimes.get("A")?.createdSessions).toHaveLength(1);
    expect(runtimes.get("B")?.createdSessions).toHaveLength(1);

    await coordinator.dispose();
  });
});
