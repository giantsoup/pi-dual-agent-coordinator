import { responsesInput } from "../helpers/provider.js";
import { ManagedSession } from "../../src/runtime/managed-session.js";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Coordinator } from "../../src/coordinator/coordinator.js";
import { createRoleRuntime } from "../../src/runtime/create-role-runtime.js";
import { fixtureResponse, fixtureChatResponse, fixtureChatToolResponse } from "../../src/security/fixture-provider.js";
import type { NormalizedTelemetryEvent } from "../../src/types/telemetry.js";
import { replayHandoffState } from "../../src/coordinator/handoff-state-machine.js";
import { SessionLedger } from "../../src/persistence/session-ledger.js";

const roots: string[] = [];
const originalCwd = process.cwd();
afterEach(async () => {
  process.chdir(originalCwd);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const block = (name: string, value: unknown) => `\`\`\`${name}\n${JSON.stringify(value)}\n\`\`\``;
function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).join("\n");
  if (value && typeof value === "object") return Object.values(value).map(textOf).join("\n");
  return "";
}
function field(text: string, name: string): string {
  const value = new RegExp(`${name}: ([^\n]+)`).exec(text)?.[1];
  if (!value) throw new Error(`Missing fixture identifier ${name}`);
  return value;
}

async function scenario(options: { completionAt?: number; misuse?: boolean; reviewAt?: number; exhausted?: boolean }) {
  const root = await mkdtemp(join(tmpdir(), "pi-repair-real-")); roots.push(root);
  const cwd = join(root, "workspace"); await mkdir(cwd);
  const events: NormalizedTelemetryEvent[] = [];
  const requests: Array<{ role: string; tools: number; prompt: string }> = [];
  const managed: ManagedSession[] = [];
  let completionAttempts = 0; let reviewAttempts = 0; let writes = 0;
  const coordinator = new Coordinator({ cwd, sessionRoot: join(root, "state"), sessionMode: "memory", jsonLogs: false, verbose: false,
    timeoutMs: 30_000, maxReviewRounds: 1,
    createRoleRuntime: (runtimeOptions) => createRoleRuntime({ ...runtimeOptions,
      onMutation: () => { writes++; },
      providerTestBackend: { cwd, modelIds: [], load: async () => "fixture-key", request: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        const prompt = textOf(runtimeOptions.role === "A" ? responsesInput(body).prompt : body.messages.at(-1));
        const context = textOf(body);
        requests.push({ role: runtimeOptions.role, tools: body.tools?.length ?? 0, prompt });
        if (runtimeOptions.role === "A") {
          if (prompt.includes('provenance="planning_user"')) return fixtureResponse(block("pi-execute", {
            schemaVersion: 1, objective: "Write once", summary: "Write progress.txt once.", acceptanceCriteria: ["File says original"], relevantPaths: ["progress.txt"], executionPlan: ["Write once and report."]
          }));
          reviewAttempts++;
          if (reviewAttempts < (options.reviewAt ?? 1)) return fixtureResponse(block("pi-handoff", {}));
          return fixtureResponse(block("pi-final", { schemaVersion: 1, workflowId: /Workflow (\S+) has reached/.exec(prompt)?.[1] ?? field(context, "Workflow ID"), iteration: 1,
            decision: "blocked", summary: "Needs operator review.", userResponse: "Intentional blocker preserved.", changedPaths: ["progress.txt"] }));
        }
        const bRequests = requests.filter((request) => request.role === "B");
        if (bRequests.length === 1) return fixtureChatToolResponse("write", { path: "progress.txt", content: "original" }, "original-write");
        completionAttempts++;
        if (completionAttempts < (options.completionAt ?? 1) || options.exhausted) {
          if (options.misuse) return fixtureChatToolResponse(completionAttempts === 1 ? "pi-completion" : "write", { path: "progress.txt", content: "REPEATED" }, `misuse-${completionAttempts}`);
          return fixtureChatResponse(block("pi-completion", { summary: "Malformed report" }));
        }
        return fixtureChatResponse(block("pi-completion", { schemaVersion: 1, workflowId: field(context, "Workflow ID"), handoffId: field(context, "Handoff ID"), iteration: 1,
          summary: "Wrote once", changedPaths: ["progress.txt"], verification: ["Confirmed original write"] }));
      } }
    }).then((binding) => { if (binding.session instanceof ManagedSession) managed.push(binding.session); return binding; })
  });
  try {
    await coordinator.start(); coordinator.subscribeEvents((event) => events.push(event));
    await coordinator.submitUserInput("Execute the approved write now.");
      const result = await coordinator.approvePendingPlan();
    return { result, events, requests, completionAttempts, reviewAttempts, writes, content: await readFile(join(cwd, "progress.txt"), "utf8"), status: coordinator.getStatus(), activeTools: managed.map((session) => session.piSession.getActiveToolNames()), root };
  } finally { await coordinator.dispose(); }
}

describe("response repairs through real Pi sessions with fixture providers", () => {
  it.each([1, 2, 10])("accepts completion attempt %i without replaying execution", async (completionAt) => {
    const run = await scenario({ completionAt });
    expect(run.completionAttempts).toBe(completionAt);
    expect(run.writes).toBe(1); expect(run.content).toBe("original");
    expect(run.reviewAttempts).toBe(1);
    expect(run.events.filter((event) => event.eventType === "workflow.execution_progress").at(-1)?.details.completedTurns).toBe(completionAt === 1 ? 2 : 1);
    expect(run.requests.filter((request) => request.role === "B").slice(2).every((request) => request.tools === 0)).toBe(true);
    expect(run.events.filter((event) => event.eventType === "workflow.check_in_started")).toHaveLength(0);
    expect(run.result.userResponse).toContain("Intentional blocker preserved");
  }, 60_000);
  it("denies hallucinated writes after protocol misuse, accepts tenth report, and preserves the runtime tools", async () => {
    const run = await scenario({ completionAt: 10, misuse: true, reviewAt: 2 });
    expect(run.completionAttempts).toBe(10); expect(run.writes).toBe(1); expect(run.content).toBe("original");
    expect(run.reviewAttempts).toBe(2);
    expect(run.activeTools.every((tools) => tools.length > 0)).toBe(true);
    expect(run.requests.filter((request) => request.role === "A").at(-1)?.tools).toBe(0);
    expect(run.requests.filter((request) => request.role === "A")[1]?.tools).toBeGreaterThan(0);
    expect(run.events.filter((event) => event.eventType === "response.rejected" && event.role === "B")).toHaveLength(9);
  }, 60_000);
  it("stops after ten invalid completions and persists nine current-iteration repairs and the final error", async () => {
    const run = await scenario({ exhausted: true });
    expect(run.completionAttempts).toBe(10); expect(run.reviewAttempts).toBe(0);
    expect(run.writes).toBe(1); expect(run.result.workflow?.status).toBe("blocked");
    expect(run.status.responseProgress).toMatchObject({ attempt: 10, repairCount: 9, responseKind: "completion" });
    const ledger = new SessionLedger(join(run.root, "state", "ledger", "handoffs.jsonl"));
    // Read the same durable ledger used by the coordinator.
    const records = await ledger.loadAll();
    expect(records.filter((record) => record.status === "repair_requested")).toHaveLength(9);
    expect(records.filter((record) => record.status === "repair_requested").every((record) => record.iteration === 1)).toBe(true);
    expect(records.at(-1)?.details).toMatchObject({ attempt: 10, repairCount: 9, reason: expect.stringContaining("invalid") });
    const state = replayHandoffState(records);
    expect(state.activeWorkflowId).toBeUndefined();
    expect(Object.values(state.workflows)[0]).toMatchObject({ currentIteration: 1, repairCount: 9, status: "blocked" });
  }, 60_000);
});
