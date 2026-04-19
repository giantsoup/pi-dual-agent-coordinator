import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { Coordinator } from "../../src/coordinator/coordinator.js";
import type { CreateRoleRuntimeOptions } from "../../src/runtime/create-role-runtime.js";
import {
  assistantTurnEnd,
  createFakeBinding,
  FakeRuntime,
  FakeSession
} from "../helpers/fakes.js";
import { SessionLedger } from "../../src/persistence/session-ledger.js";

describe("workflow review loop", () => {
  it("runs A handoff -> B completion -> A final", async () => {
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
                async (promptText) => {
                  const workflowId = extractField(promptText, "Workflow ID");
                  if (promptText.includes("Coordinator review prompt")) {
                    await session.emit(
                      assistantTurnEnd(`
\`\`\`pi-final
{"schemaVersion":1,"workflowId":"${workflowId}","iteration":1,"decision":"approved","summary":"Complete","userResponse":"Implemented the feature.","changedPaths":["src/index.ts"]}
\`\`\`
`)
                    );
                    return;
                  }
                  await session.emit(
                    assistantTurnEnd(`
\`\`\`pi-handoff
{"schemaVersion":1,"workflowId":"${workflowId}","handoffId":"handoff-1","iteration":1,"objective":"Implement feature","summary":"Need edits","acceptanceCriteria":["tests pass"],"relevantPaths":["src/index.ts"]}
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
    const result = await coordinator.submitUserTask("Implement the feature");

    expect(result.status).toBe("completed");
    expect(result.userResponse).toContain("Implemented the feature.");
    expect(runtimes.get("B")?.session.prompts).toHaveLength(1);

    const handoff = await coordinator.getLastHandoff();
    expect(handoff.workflow?.status).toBe("completed");
    expect(handoff.state.workflows[handoff.workflow?.workflowId ?? ""]?.latestCompletion?.summary).toBe("Done");

    await coordinator.dispose();
  });

  it("repairs an invalid B completion once and then succeeds", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-handoff-"));
    let bPromptCount = 0;

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
                async (promptText) => {
                  const workflowId = extractField(promptText, "Workflow ID");
                  if (promptText.includes("Coordinator review prompt")) {
                    await session.emit(
                      assistantTurnEnd(`
\`\`\`pi-final
{"schemaVersion":1,"workflowId":"${workflowId}","iteration":1,"decision":"approved","summary":"Complete","userResponse":"Done after repair.","changedPaths":["src/index.ts"]}
\`\`\`
`)
                    );
                    return;
                  }
                  await session.emit(
                    assistantTurnEnd(`
\`\`\`pi-handoff
{"schemaVersion":1,"workflowId":"${workflowId}","handoffId":"handoff-1","iteration":1,"objective":"Implement feature","summary":"Need edits","acceptanceCriteria":["tests pass"],"relevantPaths":["src/index.ts"]}
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
                  bPromptCount += 1;
                  if (bPromptCount === 1) {
                    await session.emit(assistantTurnEnd("no machine block"));
                    return;
                  }
                  await session.emit(
                    assistantTurnEnd(`
\`\`\`pi-completion
{"schemaVersion":1,"workflowId":"${workflowId}","handoffId":"${handoffId}","iteration":${iteration},"summary":"Done","changedPaths":["src/index.ts"]}
\`\`\`
`)
                  );
                }
              );
        return createFakeBinding(options.role, new FakeRuntime(process.cwd(), session, options.role));
      }
    });

    await coordinator.start();
    const result = await coordinator.submitUserTask("Implement the feature");

    expect(result.status).toBe("completed");
    const state = (await coordinator.getLastHandoff()).state;
    const workflow = state.workflows[state.latestWorkflowId ?? ""];
    expect(workflow?.repairCount).toBe(1);

    await coordinator.dispose();
  });

  it("rejects a new task while a recovered workflow is still active", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-active-workflow-"));
    const ledger = new SessionLedger(join(root, "ledger", "handoffs.jsonl"));
    await ledger.append({
      workflowId: "wf-active",
      handoffId: "h-1",
      iteration: 1,
      status: "prepared",
      role: "A",
      requestId: "req-1",
      sessionId: "a-1",
      timestamp: new Date().toISOString()
    });

    const coordinator = new Coordinator({
      cwd: process.cwd(),
      sessionRoot: root,
      sessionMode: "persistent",
      jsonLogs: false,
      verbose: false,
      createRoleRuntime: async (options: CreateRoleRuntimeOptions) =>
        createFakeBinding(
          options.role,
          new FakeRuntime(
            process.cwd(),
            new FakeSession(`${options.role}-session-1`, join(root, `${options.role}.jsonl`)),
            options.role
          )
        )
    });

    await coordinator.start();

    await expect(coordinator.submitUserTask("Implement the feature")).rejects.toThrow(
      "Cannot start a new task while workflow wf-active is still active"
    );

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
