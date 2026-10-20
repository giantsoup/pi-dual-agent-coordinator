import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { Coordinator } from "../../src/coordinator/coordinator.js";
import { selectLastValidatedRecord } from "../../src/coordinator/coordinator.js";
import type { CreateRoleRuntimeOptions } from "../../src/runtime/create-role-runtime.js";
import {
  assistantMessage,
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

  it("stores a pending plan, exposes it in status, and clears it on discard", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-plan-ready-unit-"));
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
Proposed approach below.
\n\`\`\`pi-plan
{"schemaVersion":1,"objective":"Implement feature","summary":"Ready for approval","acceptanceCriteria":["tests pass"],"relevantPaths":["src/index.ts"],"executionPlan":["Update the implementation","Run tests"],"constraints":["Keep the diff scoped"]}
\`\`\`
`)
                  );
                }
              )
            : new FakeSession("B-session-1", join(root, "B.jsonl"));
        const runtime = new FakeRuntime(process.cwd(), session, options.role);
        runtimes.set(options.role, runtime);
        return createFakeBinding(options.role, runtime);
      }
    });

    await coordinator.start();
    const result = await coordinator.submitUserInput("Plan it, but do not start yet.");

    expect(result.mode).toBe("planning");
    expect(result.userResponse).toContain("Proposed approach below");
    expect(result.pendingPlan?.summary).toBe("Ready for approval");
    expect(result.nextActionHint).toContain("/approve");
    expect(coordinator.getStatus().pendingPlanReady).toBe(true);
    expect(coordinator.getStatus().pendingPlan?.executionPlan).toEqual([
      "Update the implementation",
      "Run tests"
    ]);
    expect(runtimes.get("B")?.session.prompts).toHaveLength(0);

    coordinator.discardPendingPlan();

    expect(coordinator.getStatus().pendingPlanReady).toBe(false);
    expect(coordinator.getStatus().pendingPlan).toBeUndefined();

    await coordinator.dispose();
  });

  it("approves the latest pending plan and starts execution from it", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-approve-unit-"));
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
{"schemaVersion":1,"workflowId":"${workflowId}","iteration":1,"decision":"approved","summary":"Complete","userResponse":"Approved pending-plan execution.","changedPaths":["src/index.ts"]}
\`\`\`
`)
                    );
                    return;
                  }

                  planningTurnCount += 1;
                  if (planningTurnCount === 1) {
                    await session.emit(
                      assistantTurnEnd(`
\`\`\`pi-plan
{"schemaVersion":1,"objective":"Implement feature","summary":"Draft one","acceptanceCriteria":["tests pass"],"relevantPaths":["src/index.ts"],"executionPlan":["Inspect the file","Update the implementation"]}
\`\`\`
`)
                    );
                    return;
                  }

                  await session.emit(
                    assistantTurnEnd(`
\`\`\`pi-plan
{"schemaVersion":1,"objective":"Implement feature","summary":"Draft two","acceptanceCriteria":["tests pass"],"relevantPaths":["src/index.ts"],"executionPlan":["Update the implementation","Run focused tests"]}
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
    await coordinator.submitUserInput("Draft a plan.");
    const replacement = await coordinator.submitUserInput("Revise the plan.");

    expect(replacement.pendingPlan?.summary).toBe("Draft two");
    expect(coordinator.getStatus().pendingPlan?.summary).toBe("Draft two");

    const approved = await coordinator.approvePendingPlan();

    expect(approved.workflow?.status).toBe("completed");
    expect(approved.userResponse).toContain("Approved pending-plan execution");
    expect(coordinator.getStatus().pendingPlanReady).toBe(false);
    expect(runtimes.get("B")?.session.prompts).toHaveLength(1);
    expect(runtimes.get("B")?.session.prompts[0]).toContain("Update the implementation");
    expect(runtimes.get("B")?.session.prompts[0]).not.toContain("Inspect the file");

    await coordinator.dispose();
  });

  it("errors when approving without a pending plan", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-approve-missing-unit-"));
    const coordinator = new Coordinator({
      cwd: process.cwd(),
      sessionRoot: root,
      sessionMode: "memory",
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
    await expect(coordinator.approvePendingPlan()).rejects.toThrow(
      "No pending plan is available"
    );
    await coordinator.dispose();
  });

  it("repairs a malformed pi-execute and waits for explicit approval", async () => {
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
    const planned = await coordinator.submitUserInput("Start execution now.");
    expect(planned.pendingPlan).toBeDefined();
    const result = await coordinator.approvePendingPlan();

    expect(result.workflow?.status).toBe("completed");
    expect(runtimes.get("A")?.session.prompts[1]).toContain("Planning repair prompt");
    expect(runtimes.get("B")?.session.prompts).toHaveLength(1);

    await coordinator.dispose();
  });

  it("repairs a malformed pi-plan once before storing it", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-plan-repair-unit-"));
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
\`\`\`pi-plan
{"schemaVersion":1,"objective":"Implement feature","summary":"Ready","acceptanceCriteria":["tests pass"],"relevantPaths":["src/index.ts"],"executionPlan":[]}
\`\`\`
`)
                    );
                    return;
                  }
                  await session.emit(
                    assistantTurnEnd(`
\`\`\`pi-plan
{"schemaVersion":1,"objective":"Implement feature","summary":"Ready","acceptanceCriteria":["tests pass"],"relevantPaths":["src/index.ts"],"executionPlan":["Update the implementation","Run focused tests"]}
\`\`\`
`)
                  );
                }
              )
            : new FakeSession("B-session-1", join(root, "B.jsonl"));
        const runtime = new FakeRuntime(process.cwd(), session, options.role);
        runtimes.set(options.role, runtime);
        return createFakeBinding(options.role, runtime);
      }
    });

    await coordinator.start();
    const result = await coordinator.submitUserInput("Create a plan only.");

    expect(result.pendingPlan?.executionPlan).toEqual([
      "Update the implementation",
      "Run focused tests"
    ]);
    expect(runtimes.get("A")?.session.prompts[1]).toContain("Planning repair prompt");
    expect(runtimes.get("B")?.session.prompts).toHaveLength(0);

    await coordinator.dispose();
  });

  it("repairs an empty planning response instead of returning a blank turn", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-empty-planning-repair-unit-"));
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
                    await session.emit(assistantTurnEnd(""));
                    return;
                  }
                  await session.emit(
                    assistantTurnEnd(`
\`\`\`pi-plan
{"schemaVersion":1,"objective":"Implement feature","summary":"Ready after empty response repair","acceptanceCriteria":["tests pass"],"relevantPaths":["src/index.ts"],"executionPlan":["Update the implementation","Run focused tests"]}
\`\`\`
`)
                  );
                }
              )
            : new FakeSession("B-session-1", join(root, "B.jsonl"));
        const runtime = new FakeRuntime(process.cwd(), session, options.role);
        runtimes.set(options.role, runtime);
        return createFakeBinding(options.role, runtime);
      }
    });

    await coordinator.start();
    const result = await coordinator.submitUserInput("Create a plan.");

    expect(result.pendingPlan?.summary).toBe("Ready after empty response repair");
    expect(runtimes.get("A")?.session.prompts[1]).toContain("Planning repair prompt");
    expect(runtimes.get("B")?.session.prompts).toHaveLength(0);

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

  it("shows bounded planning response attempts while remaining in planning conversation mode", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-plan-repair-status-unit-"));
    const repairGate = createDeferred<void>();

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
                  await repairGate.promise;
                  await session.emit(assistantTurnEnd("Recovered planning response."));
                }
              )
            : new FakeSession("B-session-1", join(root, "B.jsonl"));
        return createFakeBinding(options.role, new FakeRuntime(process.cwd(), session, options.role));
      }
    });

    await coordinator.start();
    const pending = coordinator.submitUserInput("Keep planning.");

    await waitFor(
      () =>
        coordinator.getStatus().phase === "repair" &&
        coordinator.getStatus().coordinatorActivity ===
          "Agent A planning response attempt 2/10" &&
        coordinator.getStatus().conversationMode === "planning"
    );

    const duringRepair = coordinator.getStatus();
    expect(duringRepair.phase).toBe("repair");
    expect(duringRepair.conversationMode).toBe("planning");
    expect(duringRepair.activeRole).toBe("A");
    expect(duringRepair.activeWorkflowId).toBeUndefined();
    expect(duringRepair.coordinatorActivity).toBe("Agent A planning response attempt 2/10");
    expect(duringRepair.coordinatorReason).toContain("planning mode only accepts");

    repairGate.resolve();
    const result = await pending;
    expect(result.userResponse).toContain("Recovered planning response.");

    await coordinator.dispose();
  });

  it("rejects mixed pi-plan and pi-execute blocks in planning mode", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-plan-mixed-unit-"));
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
\`\`\`pi-plan
{"schemaVersion":1,"objective":"Implement feature","summary":"Ready for approval","acceptanceCriteria":["tests pass"],"relevantPaths":["src/index.ts"],"executionPlan":["Update the implementation"]}
\`\`\`
\n\`\`\`pi-execute
{"schemaVersion":1,"objective":"Implement feature","summary":"Ready now","acceptanceCriteria":["tests pass"],"relevantPaths":["src/index.ts"],"executionPlan":["Update the implementation","Run tests"]}
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
    expect(coordinator.getStatus().pendingPlanReady).toBe(false);
    expect(runtimes.get("A")?.session.prompts[1]).toContain("Planning repair prompt");
    expect(runtimes.get("B")?.session.prompts).toHaveLength(0);

    await coordinator.dispose();
  });

  it("clears pending plan state when a runtime is replaced", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-plan-runtime-replace-unit-"));
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
\`\`\`pi-plan
{"schemaVersion":1,"objective":"Implement feature","summary":"Ready for approval","acceptanceCriteria":["tests pass"],"relevantPaths":["src/index.ts"],"executionPlan":["Update the implementation","Run tests"]}
\`\`\`
`)
                  );
                }
              )
            : new FakeSession("B-session-1", join(root, "B.jsonl"));
        const runtime = new FakeRuntime(process.cwd(), session, options.role);
        runtimes.set(options.role, runtime);
        return createFakeBinding(options.role, runtime);
      }
    });

    await coordinator.start();
    await coordinator.submitUserInput("Plan only.");

    expect(coordinator.getStatus().pendingPlanReady).toBe(true);

    await coordinator.replaceRuntime("A", { type: "new", role: "A" });

    expect(coordinator.getStatus().pendingPlanReady).toBe(false);
    expect(runtimes.get("A")?.newSessionCount).toBe(1);
    await coordinator.dispose();
  });

  it("does not recover pending plan state after restart", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-plan-restart-unit-"));

    const createCoordinator = () =>
      new Coordinator({
        cwd: process.cwd(),
        sessionRoot: root,
        sessionMode: "persistent",
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
\`\`\`pi-plan
{"schemaVersion":1,"objective":"Implement feature","summary":"Ready for approval","acceptanceCriteria":["tests pass"],"relevantPaths":["src/index.ts"],"executionPlan":["Update the implementation","Run tests"]}
\`\`\`
`)
                    );
                  }
                )
              : new FakeSession("B-session-1", join(root, "B.jsonl"));
          return createFakeBinding(options.role, new FakeRuntime(process.cwd(), session, options.role));
        }
      });

    const first = createCoordinator();
    await first.start();
    await first.submitUserInput("Plan only.");
    expect(first.getStatus().pendingPlanReady).toBe(true);
    await first.dispose();

    const restarted = createCoordinator();
    await restarted.start();
    expect(restarted.getStatus().pendingPlanReady).toBe(false);
    expect(restarted.getStatus().pendingPlan).toBeUndefined();
    await restarted.dispose();
  });

  it("exposes current activity during execution and clears stale runtime activity after finalization", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-status-activity-unit-"));
    const runtimes = new Map<string, FakeRuntime>();
    let releaseExecution: (() => void) | undefined;
    const executionGate = new Promise<void>((resolve) => {
      releaseExecution = resolve;
    });

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
{"schemaVersion":1,"workflowId":"${workflowId}","iteration":1,"decision":"approved","summary":"Complete","userResponse":"Done","changedPaths":["src/index.ts"]}
\`\`\`
`)
                    );
                    return;
                  }

                  await session.emit(
                    assistantTurnEnd(`
\`\`\`pi-execute
{"schemaVersion":1,"objective":"Implement feature","summary":"Ready","acceptanceCriteria":["tests pass"],"relevantPaths":["src/index.ts"],"executionPlan":["Inspect the target file","Make the change"]}
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
                  const path = join(process.cwd(), "src/app/repl-progress.ts");
                  await session.emit({
                    type: "tool_execution_start",
                    toolCallId: "tool-read-1",
                    toolName: "read",
                    args: { path }
                  });
                  await executionGate;
                  await session.emit({
                    type: "tool_execution_end",
                    toolCallId: "tool-read-1",
                    toolName: "read",
                    result: {
                      content: [{ type: "text", text: "rendered file" }]
                    },
                    isError: false
                  });
                  await session.emit({
                    type: "turn_end",
                    message: {
                      ...assistantMessage(`
\`\`\`pi-completion
{"schemaVersion":1,"workflowId":"${workflowId}","handoffId":"${handoffId}","iteration":${iteration},"summary":"Done","changedPaths":["src/index.ts"]}
\`\`\`
`),
                      stopReason: "stop"
                    },
                    toolResults: []
                  });
                }
              );
        const runtime = new FakeRuntime(process.cwd(), session, options.role);
        runtimes.set(options.role, runtime);
        return createFakeBinding(options.role, runtime);
      }
    });

    await coordinator.start();
    await coordinator.submitUserInput("Start execution now.");
    const pending = coordinator.approvePendingPlan();

    await waitFor(() => coordinator.getStatus().currentActivity === "reading src/app/repl-progress.ts");
    const inProgress = coordinator.getStatus();
    const runtimeB = inProgress.runtimes.find((runtime) => runtime.role === "B");
    expect(inProgress.phase).toBe("execution");
    expect(inProgress.currentActivity).toBe("reading src/app/repl-progress.ts");
    expect(inProgress.currentReason).toBeUndefined();
    expect(runtimeB?.currentActivity).toBe("reading src/app/repl-progress.ts");
    expect(runtimeB?.currentReason).toBeUndefined();
    expect(runtimeB?.lastToolName).toBe("read");

    releaseExecution?.();
    await pending;

    const finalized = coordinator.getStatus();
    expect(finalized.currentActivity).toBeUndefined();
    expect(finalized.currentReason).toBeUndefined();
    expect(finalized.coordinatorActivity).toBeUndefined();
    expect(finalized.coordinatorReason).toBeUndefined();
    expect(finalized.runtimes.find((runtime) => runtime.role === "B")?.currentActivity).toBeUndefined();

    await coordinator.dispose();
  });

  it("blocks the workflow when Agent B repeatedly calls pi-completion as a tool", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-pseudo-tool-loop-unit-"));

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
                    throw new Error("Agent A should not receive a review prompt in this scenario.");
                  }
                  await session.emit(
                    assistantTurnEnd(`
\`\`\`pi-execute
{"schemaVersion":1,"objective":"Implement feature","summary":"Ready","acceptanceCriteria":["tests pass"],"relevantPaths":["src/index.ts"],"executionPlan":["Update the implementation","Run focused tests"]}
\`\`\`
`)
                  );
                }
              )
            : new FakeSession(
                "B-session-1",
                join(root, "B.jsonl"),
                async () => {
                  for (let index = 0; index < 3; index += 1) {
                    await session.emit({
                      type: "tool_execution_start",
                      toolCallId: `pseudo-${index}`,
                      toolName: "pi-completion",
                      args: {}
                    });
                    await session.emit({
                      type: "tool_execution_end",
                      toolCallId: `pseudo-${index}`,
                      toolName: "pi-completion",
                      result: { content: [{ type: "text", text: "not a real tool" }] },
                      isError: true
                    });
                  }
                }
              );
        return createFakeBinding(options.role, new FakeRuntime(process.cwd(), session, options.role));
      }
    });

    await coordinator.start();

    const planned = await coordinator.submitUserInput("Start execution now.");
    expect(planned.pendingPlan).toBeDefined();
    const result = await coordinator.approvePendingPlan();

    expect(result.workflow?.status).toBe("blocked");
    expect(result.userResponse).toContain(
      "Tools are disabled during response formatting."
    );
    expect(coordinator.getStatus().workflowStatus).toBe("blocked");
    expect(coordinator.getStatus().activeWorkflowId).toBeUndefined();

    await coordinator.dispose();
  });
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1_000
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for predicate");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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
