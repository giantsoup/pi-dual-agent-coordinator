import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { Coordinator } from "../../src/coordinator/coordinator.js";
import type { CreateRoleRuntimeOptions } from "../../src/runtime/create-role-runtime.js";
import { assistantTurnEnd, createFakeBinding, FakeRuntime, FakeSession } from "../helpers/fakes.js";

describe("handoff flow", () => {
  it("prepares, delivers, and completes a handoff", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-handoff-"));
    const runtimes = new Map<string, FakeRuntime>();

    const coordinator = new Coordinator({
      cwd: process.cwd(),
      sessionRoot: root,
      sessionMode: "memory",
      jsonLogs: false,
      verbose: false,
      createRoleRuntime: async (options: CreateRoleRuntimeOptions) => {
        const session =
          options.role === "A"
            ? new FakeSession(
                "A-session-1",
                join(root, "A.jsonl"),
                async () => {
                  await session.emit(
                    assistantTurnEnd(`
\`\`\`pi-handoff
{"schemaVersion":1,"handoffId":"handoff-1","objective":"Implement feature","summary":"Need edits","acceptanceCriteria":["tests pass"],"relevantPaths":["src/index.ts"]}
\`\`\`
`)
                  );
                }
              )
            : new FakeSession(
                "B-session-1",
                join(root, "B.jsonl"),
                async () => {
                  await session.emit(
                    assistantTurnEnd(`
\`\`\`pi-completion
{"schemaVersion":1,"handoffId":"handoff-1","summary":"Done","changedPaths":["src/index.ts"]}
\`\`\`
`)
                  );
                  await new Promise((resolve) => setTimeout(resolve, 10));
                }
              );
        const runtime = new FakeRuntime(process.cwd(), session, options.role);
        runtimes.set(options.role, runtime);
        return createFakeBinding(options.role, runtime);
      }
    });

    await coordinator.start();
    const summary = await coordinator.submitUserTask("Implement the feature");

    expect(summary).toContain("Completed handoff-1: Done");
    expect(runtimes.get("B")?.session.prompts).toHaveLength(1);

    const handoff = await coordinator.getLastHandoff();
    expect(handoff.state.lastCompleted?.handoffId).toBe("handoff-1");
    expect(handoff.state.lastDelivered?.handoffId).toBe("handoff-1");

    await coordinator.dispose();
  });
});
