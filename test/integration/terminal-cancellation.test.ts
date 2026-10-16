import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Coordinator, type CoordinatorOptions } from "../../src/coordinator/coordinator.js";
import { createFakeBinding, FakeRuntime, FakeSession, assistantTurnEnd } from "../helpers/fakes.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const plan = '```pi-plan\n{"schemaVersion":1,"objective":"Task","summary":"Plan","acceptanceCriteria":["done"],"relevantPaths":["file.txt"],"executionPlan":["work"]}\n```';
function field(text: string, name: string): string {
  const value = text.match(new RegExp(`${name}: ([^\\n]+)`))?.[1];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function setup(stage: "planning" | "execution" | "review", timeoutMs = 10_000) {
  const root = await mkdtemp(join(tmpdir(), "pi-terminal-cancel-")); roots.push(root);
  let arrived = () => {};
  const ready = new Promise<void>((resolve) => { arrived = resolve; });
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let stall = true;
  const sessions = new Map<string, FakeSession>();
  const options: CoordinatorOptions = { cwd: root, sessionRoot: join(root, "state"), sessionMode: "memory",
    jsonLogs: false, verbose: false, timeoutMs,
    createRoleRuntime: async (options) => {
      const session = new FakeSession(`${options.role}-session`, undefined, async (text) => {
        const current = options.role === "B" ? "execution" : text.includes("Coordinator review") ? "review" : "planning";
        if (stall && current === stage) { arrived(); await gate; return; }
        if (options.role === "B") {
          await session.emit(assistantTurnEnd('```pi-completion\n' + JSON.stringify({schemaVersion:1,workflowId:field(text,"Workflow ID"),handoffId:field(text,"Handoff ID"),iteration:1,summary:"Done",changedPaths:[]}) + '\n```'));
        } else if (current === "review") {
          await session.emit(assistantTurnEnd('```pi-final\n' + JSON.stringify({schemaVersion:1,workflowId:field(text,"Workflow ID"),iteration:1,decision:"approved",summary:"Done",userResponse:"Done",changedPaths:[]}) + '\n```'));
        } else await session.emit(assistantTurnEnd(plan));
      });
      vi.spyOn(session, "abort").mockImplementation(async () => { stall = false; release(); });
      sessions.set(options.role, session);
      return createFakeBinding(options.role, new FakeRuntime(root, session, options.role));
    }
  };
  const coordinator = new Coordinator(options);
  await coordinator.start();
  return { coordinator, sessions, ready, options };
}

describe("terminal operation cancellation", () => {
  it.each(["planning", "execution", "review"] as const)("cancels %s without starting another stage, then accepts new work", async (stage) => {
    const { coordinator, sessions, ready } = await setup(stage);
    try {
      if (stage !== "planning") await coordinator.submitUserInput("plan");
      const work = stage === "planning" ? coordinator.submitUserInput("plan") : coordinator.approvePendingPlan();
      await ready;
      await expect(coordinator.submitUserInput("concurrent")).rejects.toThrow("Work is running");
      const counts = [...sessions.values()].map((session) => session.prompts.length);
      await Promise.all([coordinator.cancelActive(), coordinator.cancelActive()]);
      expect((await work).userResponse).toContain("cancelled");
      expect([...sessions.values()].map((session) => session.prompts.length)).toEqual(counts);
      expect(coordinator.getStatus().operation?.kind).toBe("cancelled");
      const state = await coordinator.getWorkflowStatus();
      expect(state.ledgerTail?.status).toBe("cancelled");
      expect(state.state.activeWorkflowId).toBeUndefined();
      expect((await coordinator.submitUserInput("new plan")).pendingPlan).toBeDefined();
      expect((await coordinator.approvePendingPlan()).workflow?.status).toBe("completed");
      await coordinator.cancelActive();
      expect(coordinator.getStatus().operation?.kind).toBe("completed");
    } finally { await coordinator.dispose(); }
  });

  it("routes total deadlines through abort and records a replayable timeout", async () => {
    const { coordinator, sessions } = await setup("planning", 30);
    try {
      const result = await coordinator.submitUserInput("plan");
      expect(result.userResponse).toContain("Deadline exceeded");
      expect(sessions.get("A")?.abort).toHaveBeenCalledOnce();
      expect((await coordinator.getWorkflowStatus()).ledgerTail?.status).toBe("timed_out");
      expect(coordinator.getStatus().operation?.kind).toBe("timed_out");
      expect((await coordinator.submitUserInput("plan again")).pendingPlan).toBeDefined();
    } finally { await coordinator.dispose(); }
  });

  it("drains both roles and records failure when one runtime abort rejects", async () => {
    const {coordinator,sessions,ready} = await setup("planning");
    const session = sessions.get("A");
    if (!session) throw new Error("missing session");
    const abort = session.abort.bind(session);
    vi.spyOn(session,"abort").mockImplementation(async () => {await abort(); throw new Error("abort failed");});
    try {
      const work = coordinator.submitUserInput("plan");
      const rejection = expect(work).rejects.toThrow("cancellation cleanup failed");
      await ready; await coordinator.cancelActive(); await rejection;
      expect(sessions.get("B")?.abort).toHaveBeenCalledOnce();
      expect(coordinator.getStatus().operation?.kind).toBe("failed");
      expect((await coordinator.getWorkflowStatus()).ledgerTail?.status).toBe("failed");
    } finally {await coordinator.dispose();}
  });

  it("restarts from a cancelled operation without prompting either runtime", async () => {
    const { coordinator, ready, options, sessions } = await setup("planning");
    const work = coordinator.submitUserInput("plan");
    await ready;
    await coordinator.cancelActive(); await work;
    await coordinator.dispose();
    const restarted = new Coordinator(options);
    await restarted.start();
    try {
      expect(restarted.getStatus().workflowStatus).toBe("cancelled");
      expect(restarted.getStatus().pendingPlan).toBeUndefined();
      expect([...sessions.values()].every((session) => session.prompts.length === 0)).toBe(true);
      await expect(restarted.approvePendingPlan()).rejects.toThrow("No pending plan");
      expect((await restarted.submitUserInput("fresh plan")).pendingPlan).toBeDefined();
    } finally { await restarted.dispose(); }
  });

  it("settles prompt rejection before turn_end and permits explicit retry", async () => {
    const { coordinator, sessions } = await setup("planning");
    try {
      const session = sessions.get("A");
      if (!session) throw new Error("missing session");
      vi.spyOn(session, "prompt").mockRejectedValueOnce(new Error("provider failed"));
      await expect(coordinator.submitUserInput("plan")).rejects.toThrow("provider failed");
      expect((await coordinator.getWorkflowStatus()).ledgerTail?.status).toBe("failed");
      expect((await coordinator.submitUserInput("retry")).pendingPlan).toBeDefined();
    } finally { await coordinator.dispose(); }
  });
});
