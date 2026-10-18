import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Coordinator } from "../../src/coordinator/coordinator.js";
import { ResponseRepairExhaustedError } from "../../src/coordinator/response-repair.js";
import { assistantTurnEnd, createFakeBinding, FakeRuntime, FakeSession } from "../helpers/fakes.js";
import { SessionLedger } from "../../src/persistence/session-ledger.js";
import { replayHandoffState } from "../../src/coordinator/handoff-state-machine.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
describe("planning repair budget and approval boundary", () => {
  it.each([1, 2, 10, Infinity])("preserves approval and original input with success at %s", async (successAt) => {
    const root = await mkdtemp(join(tmpdir(), "pi-planning-budget-")); roots.push(root);
    let attempts = 0;
    const sessions: FakeSession[] = [];
    const coordinator = new Coordinator({ cwd: root, sessionRoot: join(root, "state"), sessionMode: "memory", jsonLogs: false, verbose: false,
      createRoleRuntime: async (options) => {
        const session = new FakeSession(options.role, undefined, async () => {
          attempts++;
          await session.emit(assistantTurnEnd(attempts < successAt ? '```pi-plan\n{}\n```'
            : 'Valid planning prose.\n```pi-plan\n{"schemaVersion":1,"objective":"Work","summary":"Requires approval","acceptanceCriteria":["done"],"relevantPaths":["file"],"executionPlan":["Work"]}\n```'));
        }); sessions.push(session);
        return createFakeBinding(options.role, new FakeRuntime(root, session, options.role));
      }
    });
    try {
      await coordinator.start();
      const result = coordinator.submitUserInput("ORIGINAL_TASK_ONLY_ONCE");
      if (successAt === Infinity) await expect(result).rejects.toBeInstanceOf(ResponseRepairExhaustedError);
      else {
        const turn = await result;
        expect(turn.userResponse).toContain("Valid planning prose");
        expect(turn.pendingPlan?.summary).toBe("Requires approval");
      }
      expect(attempts).toBe(Math.min(successAt, 10));
      expect(sessions[0]?.prompts.filter((prompt) => prompt.includes("ORIGINAL_TASK_ONLY_ONCE"))).toHaveLength(1);
      expect(sessions[1]?.prompts).toHaveLength(0);
      const records = await new SessionLedger(join(root, "state", "ledger", "handoffs.jsonl")).loadAll();
      expect(records.filter((record) => record.status === "repair_requested")).toHaveLength(Math.min(successAt, 10) - 1);
      expect(replayHandoffState(records).activeWorkflowId).toBeUndefined();
      if (successAt === Infinity) expect(records.at(-1)?.details).toMatchObject({ attempt: 10, repairCount: 9, reason: expect.stringContaining("invalid") });
    } finally { await coordinator.dispose(); }
  });
});

it("cannot turn a broken proposal into execution approval during format repair", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-repair-approval-")); roots.push(root);
  const payload = '{"schemaVersion":1,"objective":"Work","summary":"Proposal","acceptanceCriteria":["done"],"relevantPaths":["file"],"executionPlan":["Work"]}';
  let attempts = 0; let bRequests = 0;
  const coordinator = new Coordinator({ cwd: root, sessionRoot: join(root, "state"), sessionMode: "memory", jsonLogs: false, verbose: false,
    createRoleRuntime: async (options) => {
      const session = new FakeSession(options.role, undefined, async () => {
        if (options.role === "B") { bRequests++; throw new Error("Approval bypassed"); }
        attempts++;
        await session.emit(assistantTurnEnd(attempts === 1 ? '```pi-plan\n{}\n```' : `\`\`\`${attempts === 2 ? "pi-execute" : "pi-plan"}\n${payload}\n\`\`\``));
      });
      return createFakeBinding(options.role, new FakeRuntime(root, session, options.role));
    }
  });
  try {
    await coordinator.start();
    const result = await coordinator.submitUserInput("Propose a plan for approval");
    expect(result.pendingPlan).toBeDefined(); expect(attempts).toBe(3); expect(bRequests).toBe(0);
  } finally { await coordinator.dispose(); }
});

import { HistoryIndex } from "../../src/app/interactive/history.js";
import type { CoordinatorOptions } from "../../src/coordinator/coordinator.js";
it("restores exhausted response counts and validation reasons without dispatching on restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-repair-restart-")); roots.push(root);
  let requests = 0;
  const options: CoordinatorOptions = { cwd: root, sessionRoot: join(root, "state"), sessionMode: "memory", jsonLogs: false, verbose: false,
    createRoleRuntime: async (input) => {
      const session = new FakeSession(input.role, undefined, async () => { requests++; await session.emit(assistantTurnEnd('```pi-plan\n{}\n```')); });
      return createFakeBinding(input.role, new FakeRuntime(root, session, input.role));
    }
  };
  const first = new Coordinator(options);
  try { await first.start(); await expect(first.submitUserInput("Propose a plan")).rejects.toBeInstanceOf(ResponseRepairExhaustedError); }
  finally { await first.dispose(); }
  const restarted = new Coordinator(options);
  try {
    await restarted.start();
    expect(requests).toBe(10);
    expect(restarted.getStatus().responseProgress).toMatchObject({ attempt: 10, repairCount: 9, reason: "invalid `pi-plan` block" });
    const history = new HistoryIndex(); history.restore(restarted.getHistoryEvents());
    expect(history.snapshot().records.find((record) => record.kind === "turn")).toMatchObject({ outcome: { kind: "failed" }, responseProgress: { attempt: 10, reason: "invalid `pi-plan` block" } });
  } finally { await restarted.dispose(); }
});
