import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { Coordinator } from "../../src/coordinator/coordinator.js";
import { selectLastValidatedRecord } from "../../src/coordinator/coordinator.js";
import type { CreateRoleRuntimeOptions } from "../../src/runtime/create-role-runtime.js";
import {
  assistantTurnEnd,
  createFakeBinding,
  FakeRuntime,
  FakeSession
} from "../helpers/fakes.js";
import type { WorkflowState } from "../../src/types/workflow.js";

describe("coordinator workflow selection", () => {
  it("prefers the newest persisted workflow record", () => {
    const state: WorkflowState = {
      activeWorkflowId: undefined,
      latestWorkflowId: "wf-1",
      workflows: {
        "wf-1": {
          workflowId: "wf-1",
          status: "completed",
          currentIteration: 1,
          iterations: [],
          repairCount: 0,
          capCount: 0
        }
      },
      records: [
        {
          workflowId: "wf-1",
          handoffId: "h-1",
          iteration: 1,
          status: "prepared",
          role: "A",
          sessionId: "a-1",
          timestamp: "2026-04-18T20:00:00.000Z"
        },
        {
          workflowId: "wf-1",
          iteration: 1,
          status: "finalized",
          role: "A",
          sessionId: "a-1",
          timestamp: "2026-04-18T20:00:02.000Z",
          finalDecision: {
            schemaVersion: 1,
            workflowId: "wf-1",
            iteration: 1,
            decision: "approved",
            summary: "Complete",
            userResponse: "Done",
            changedPaths: ["src/index.ts"]
          }
        }
      ]
    };

    expect(selectLastValidatedRecord(state)?.status).toBe("finalized");
  });

  it("keeps planning turns on Agent A and does not prompt Agent B", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-planning-unit-"));
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
                  await session.emit(assistantTurnEnd("Here is the plan to consider next."));
                }
              )
            : new FakeSession("B-session-1", join(root, "B.jsonl"));
        const runtime = new FakeRuntime(process.cwd(), session, options.role);
        runtimes.set(options.role, runtime);
        return createFakeBinding(options.role, runtime);
      }
    });

    await coordinator.start();
    const result = await coordinator.submitUserInput("Talk through the approach first.");

    expect(result.mode).toBe("planning");
    expect(result.userResponse).toContain("Here is the plan");
    expect(runtimes.get("B")?.session.prompts).toHaveLength(0);

    await coordinator.dispose();
  });

  it("repairs a malformed pi-execute once before starting execution", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-planning-repair-unit-"));
    const runtimes = new Map<string, FakeRuntime>();

    const coordinator = new Coordinator({
      cwd: process.cwd(),
      sessionRoot: root,
      sessionMode: "memory",
      jsonLogs: false,
      verbose: false,
      createRoleRuntime: async (options: CreateRoleRuntimeOptions) => {
        let aPromptCount = 0;
        const session =
          options.role === "A"
            ? new FakeSession(
                "A-session-1",
                join(root, "A.jsonl"),
                async (promptText) => {
                  aPromptCount += 1;
                  if (promptText.includes("Coordinator review prompt")) {
                    const workflowId = extractField(promptText, "Workflow ID");
                    await session.emit(
                      assistantTurnEnd(`
\`\`\`pi-final
{"schemaVersion":1,"workflowId":"${workflowId}","iteration":1,"decision":"approved","summary":"Complete","userResponse":"Execution finished after repair.","changedPaths":["src/index.ts"]}
\`\`\`
`)
                    );
                    return;
                  }
                  if (aPromptCount === 1) {
                    await session.emit(
                      assistantTurnEnd(`
\`\`\`pi-execute
{"schemaVersion":1,"objective":"Implement feature","summary":"Ready","acceptanceCriteria":["tests pass"],"relevantPaths":["src/index.ts"],"executionPlan":[]}
\`\`\`
`)
                    );
                    return;
                  }
                  await session.emit(
                    assistantTurnEnd(`
\`\`\`pi-execute
{"schemaVersion":1,"objective":"Implement feature","summary":"Ready","acceptanceCriteria":["tests pass"],"relevantPaths":["src/index.ts"],"executionPlan":["Update the implementation","Run tests"]}
\`\`\`
`)
                  );
                }
              )
            : new FakeSession(
                "B-session-1",
                join(root, "B.jsonl"),
                async (promptText) => {
                  const workflowId = extractField(promptText, "Workflow ID");
                  const handoffId = extractField(promptText, "Handoff ID");
                  const iteration = extractField(promptText, "Iteration");
                  await session.emit(
                    assistantTurnEnd(`
\`\`\`pi-completion
{"schemaVersion":1,"workflowId":"${workflowId}","handoffId":"${handoffId}","iteration":${iteration},"summary":"Done","changedPaths":["src/index.ts"]}
\`\`\`
`)
                  );
                }
              );
        const runtime = new FakeRuntime(process.cwd(), session, options.role);
        runtimes.set(options.role, runtime);
        return createFakeBinding(options.role, runtime);
      }
    });

    await coordinator.start();
    const result = await coordinator.submitUserInput("Start execution now.");

    expect(result.workflow?.status).toBe("completed");
    expect(runtimes.get("A")?.session.prompts[1]).toContain("Planning repair prompt");
    expect(runtimes.get("B")?.session.prompts).toHaveLength(1);

    await coordinator.dispose();
  });

  it("repairs non-execute machine blocks in planning mode", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-planning-block-unit-"));
    const runtimes = new Map<string, FakeRuntime>();

    const coordinator = new Coordinator({
      cwd: process.cwd(),
      sessionRoot: root,
      sessionMode: "memory",
      jsonLogs: false,
      verbose: false,
      createRoleRuntime: async (options: CreateRoleRuntimeOptions) => {
        let aPromptCount = 0;
        const session =
          options.role === "A"
            ? new FakeSession(
                "A-session-1",
                join(root, "A.jsonl"),
                async () => {
                  aPromptCount += 1;
                  if (aPromptCount === 1) {
                    await session.emit(
                      assistantTurnEnd(`
\`\`\`pi-final
{"schemaVersion":1,"workflowId":"wf-wrong","iteration":1,"decision":"approved","summary":"Wrong block","userResponse":"Wrong block","changedPaths":[]}
\`\`\`
`)
                    );
                    return;
                  }
                  await session.emit(assistantTurnEnd("Continuing in planning mode."));
                }
              )
            : new FakeSession("B-session-1", join(root, "B.jsonl"));
        const runtime = new FakeRuntime(process.cwd(), session, options.role);
        runtimes.set(options.role, runtime);
        return createFakeBinding(options.role, runtime);
      }
    });

    await coordinator.start();
    const result = await coordinator.submitUserInput("Keep planning.");

    expect(result.mode).toBe("planning");
    expect(result.userResponse).toContain("Continuing in planning mode");
    expect(runtimes.get("A")?.session.prompts[1]).toContain("Planning repair prompt");
    expect(runtimes.get("B")?.session.prompts).toHaveLength(0);

    await coordinator.dispose();
  });
});

function extractField(text: string, label: string): string {
  const match = text.match(new RegExp(`${label}:\\s*(.+)`));
  if (match?.[1]) {
    return match[1].trim();
  }
  const attrName =
    label === "Workflow ID"
      ? "workflowId"
      : label === "Handoff ID"
        ? "handoffId"
        : label === "Iteration"
          ? "iteration"
          : label;
  const attrMatch = text.match(new RegExp(`${attrName}="([^"]+)"`));
  if (!attrMatch?.[1]) {
    throw new Error(`Missing ${label} in prompt: ${text}`);
  }
  return attrMatch[1].trim();
}
