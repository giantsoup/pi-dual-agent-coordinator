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
  it("supports multiple planning turns before execution and returns to planning afterward", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-handoff-"));
    const runtimes = new Map<string, FakeRuntime>();
    let planningTurnCount = 0;

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
                  if (promptText.includes("Coordinator review prompt")) {
                    const workflowId = extractField(promptText, "Workflow ID");
                    await session.emit(
                      assistantTurnEnd(`
\`\`\`pi-final
{"schemaVersion":1,"workflowId":"${workflowId}","iteration":1,"decision":"approved","summary":"Complete","userResponse":"Implemented the feature.","changedPaths":["src/index.ts"]}
\`\`\`
`)
                    );
                    return;
                  }

                  planningTurnCount += 1;
                  if (planningTurnCount === 1) {
                    await session.emit(assistantTurnEnd("First, inspect the requirements and edge cases."));
                    return;
                  }
                  if (planningTurnCount === 2) {
                    await session.emit(assistantTurnEnd("Still planning. I am not starting execution yet."));
                    return;
                  }
                  if (planningTurnCount === 3) {
                    await session.emit(
                      assistantTurnEnd(`
\`\`\`pi-execute
{"schemaVersion":1,"objective":"Implement the feature","summary":"The feature is planned and ready for execution.","acceptanceCriteria":["Tests pass"],"relevantPaths":["src/index.ts"],"executionPlan":["Update the implementation","Run focused tests"],"constraints":["Keep the diff scoped"]}
\`\`\`
`)
                    );
                    return;
                  }
                  await session.emit(assistantTurnEnd("Back in planning mode for the next change."));
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

    expect(coordinator.getStatus().conversationMode).toBe("planning");

    const first = await coordinator.submitUserInput("Talk through the plan.");
    const second = await coordinator.submitUserInput("Keep planning for now.");

    expect(first.mode).toBe("planning");
    expect(first.userResponse).toContain("inspect the requirements");
    expect(second.userResponse).toContain("Still planning");
    expect(runtimes.get("B")?.session.prompts).toHaveLength(0);

    const execution = await coordinator.submitUserInput("Start execution now.");

    expect(execution.workflow?.status).toBe("completed");
    expect(execution.userResponse).toContain("Implemented the feature.");
    expect(runtimes.get("B")?.session.prompts).toHaveLength(1);
    expect((await coordinator.getLastHandoff()).workflow?.status).toBe("completed");
    expect(coordinator.getStatus().conversationMode).toBe("planning");

    const afterCompletion = await coordinator.submitUserInput("What should we do next?");

    expect(afterCompletion.mode).toBe("planning");
    expect(afterCompletion.userResponse).toContain("Back in planning mode");
    expect(runtimes.get("A")?.session.sessionId).toBe("A-session-1");

    await coordinator.dispose();
  });

  it("repairs an invalid pi-execute once and then proceeds through the workflow", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-handoff-repair-"));
    const runtimes = new Map<string, FakeRuntime>();
    let planningPromptCount = 0;

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
                  if (promptText.includes("Coordinator review prompt")) {
                    const workflowId = extractField(promptText, "Workflow ID");
                    await session.emit(
                      assistantTurnEnd(`
\`\`\`pi-final
{"schemaVersion":1,"workflowId":"${workflowId}","iteration":1,"decision":"approved","summary":"Complete","userResponse":"Done after repair.","changedPaths":["src/index.ts"]}
\`\`\`
`)
                    );
                    return;
                  }

                  planningPromptCount += 1;
                  if (planningPromptCount === 1) {
                    await session.emit(
                      assistantTurnEnd(`
\`\`\`pi-execute
{"schemaVersion":1,"objective":"Implement the feature","summary":"Ready","acceptanceCriteria":["Tests pass"],"relevantPaths":["src/index.ts"],"executionPlan":[]}
\`\`\`
`)
                    );
                    return;
                  }

                  await session.emit(
                    assistantTurnEnd(`
\`\`\`pi-execute
{"schemaVersion":1,"objective":"Implement the feature","summary":"Ready","acceptanceCriteria":["Tests pass"],"relevantPaths":["src/index.ts"],"executionPlan":["Update the implementation","Run focused tests"]}
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

  it("reports planning before execution and executing while a workflow is active", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-handoff-status-"));
    const bGate = createDeferred<void>();

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
                  if (promptText.includes("Coordinator review prompt")) {
                    const workflowId = extractField(promptText, "Workflow ID");
                    await session.emit(
                      assistantTurnEnd(`
\`\`\`pi-final
{"schemaVersion":1,"workflowId":"${workflowId}","iteration":1,"decision":"approved","summary":"Complete","userResponse":"Done.","changedPaths":["src/index.ts"]}
\`\`\`
`)
                    );
                    return;
                  }
                  await session.emit(
                    assistantTurnEnd(`
\`\`\`pi-execute
{"schemaVersion":1,"objective":"Implement the feature","summary":"Ready","acceptanceCriteria":["Tests pass"],"relevantPaths":["src/index.ts"],"executionPlan":["Update the implementation","Run focused tests"]}
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
                  await bGate.promise;
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
    expect(coordinator.getStatus().conversationMode).toBe("planning");

    const pending = coordinator.submitUserInput("Start execution now.");
    await waitFor(() => coordinator.getStatus().conversationMode === "executing");

    expect(coordinator.getStatus().conversationMode).toBe("executing");

    bGate.resolve();
    const result = await pending;

    expect(result.workflow?.status).toBe("completed");
    expect(coordinator.getStatus().conversationMode).toBe("planning");

    await coordinator.dispose();
  });

  it("rejects new input while a recovered workflow is still active", async () => {
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

    await expect(coordinator.submitUserInput("Implement the feature")).rejects.toThrow(
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

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
