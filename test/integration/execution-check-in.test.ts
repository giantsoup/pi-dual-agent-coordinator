import { responsesInput } from "../helpers/provider.js";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { Coordinator } from "../../src/coordinator/coordinator.js";
import { createRoleRuntime } from "../../src/runtime/create-role-runtime.js";
import { fixtureResponse, fixtureChatResponse, fixtureChatToolResponse } from "../../src/security/fixture-provider.js";
import type { NormalizedTelemetryEvent } from "../../src/types/telemetry.js";
import { SUMMARY_OUTPUT_TOKENS } from "../../src/runtime/context-budget.js";
import { HistoryIndex } from "../../src/app/interactive/history.js";

const roots: string[] = [];
const originalCwd = process.cwd();
afterEach(async () => {
  process.chdir(originalCwd);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function allText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(allText).join("\n");
  if (value && typeof value === "object") return Object.values(value).map(allText).join("\n");
  return "";
}

function field(text: string, name: string): string {
  const value = new RegExp(`${name}: ([^\n]+)`).exec(text)?.[1];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function scenario(options: {
  toolTurns: number;
  oversizedPlanningHistory?: boolean;
  failedRequests?: number[];
  decision?: "redirect" | "blocked";
  checkIn?: (turnCount: number, coordinator: Coordinator) => Promise<string | undefined>;
}) {
  const root = await mkdtemp(join(tmpdir(), "pi-check-in-"));
  roots.push(root);
  const cwd = join(root, "workspace");
  await mkdir(cwd);
  let workerRequests = 0;
  let plannerRequests = 0;
  const checkIns: number[] = [];
  const events: NormalizedTelemetryEvent[] = [];
  const order: string[] = [];
  const workerBodies: string[] = [];
  const coordinator: Coordinator = new Coordinator({
    cwd, sessionRoot: join(root, "state"), sessionMode: "memory", jsonLogs: false, verbose: false,
    timeoutMs: 90_000,
    createRoleRuntime: async (runtimeOptions) => createRoleRuntime({
      ...runtimeOptions,
      providerTestBackend: {
        cwd, modelIds: [], load: async () => "fixture-key",
        request: async (_url, init) => {
          const body: unknown = JSON.parse(String(init?.body));
          const text = allText(body);
          if (runtimeOptions.role === "B") {
            workerRequests += 1;
            workerBodies.push(text);
            order.push(`B${workerRequests}`);
            if (options.failedRequests?.includes(workerRequests)) return fixtureChatToolResponse("read", { path: "missing.txt" }, `failed-${workerRequests}`);
            if (workerRequests <= options.toolTurns) return fixtureChatToolResponse("write", {
              path: "progress.txt", content: `step ${workerRequests}`
            }, `step-${workerRequests}`);
            return fixtureChatResponse("```pi-completion\n" + JSON.stringify({
              schemaVersion: 1, workflowId: field(text, "Workflow ID"), handoffId: field(text, "Handoff ID"),
              iteration: 1, summary: "Wrote progress.txt", changedPaths: ["progress.txt"], verification: ["Wrote the requested step"]
            }) + "\n```");
          }
          plannerRequests += 1;
          if (body && typeof body === "object" && "max_output_tokens" in body && body.max_output_tokens === SUMMARY_OUTPUT_TOKENS) {
            order.push("A-summary");
            expect(text).not.toContain("opaque-reasoning-");
            return fixtureResponse("Approved objective: write progress.txt, then report the observed result. Only change progress.txt.");
          }
          // The last input item is the current coordinator prompt; earlier check-ins remain in history.
          if (!body || typeof body !== "object" || !("input" in body) || !Array.isArray(body.input)) throw new Error("Missing Responses input");
          const prompt = allText(responsesInput(body).prompt);
          if (prompt.includes("Coordinator process check-in") || prompt.includes("Agent A check-in response attempt")) {
            const turnCount = Number(/after (\d+) (?:completed|successful) model turns/.exec(prompt)?.[1]);
            checkIns.push(turnCount);
            order.push(`A${turnCount}`);
            expect(await readFile(join(cwd, "progress.txt"), "utf8")).toBe(`step ${workerRequests}`);
            expect(text).toContain(`Turn ${turnCount}:`);
            const override = await options.checkIn?.(turnCount, coordinator);
            if (override !== undefined) return fixtureResponse(override);
            return fixtureResponse("```pi-check-in\n" + JSON.stringify({
              schemaVersion: 1, workflowId: field(prompt, "Workflow ID"), handoffId: field(prompt, "Handoff ID"),
              iteration: 1, turnCount, decision: options.decision ?? "redirect", reason: "Use the approved next step.",
              nextSteps: ["Finish the requested file and report the observed result. Stop after the acceptance criteria pass."]
            }) + "\n```");
          }
          if (prompt.includes("Coordinator review prompt")) return fixtureResponse("```pi-final\n" + JSON.stringify({
            schemaVersion: 1, workflowId: field(prompt, "Workflow ID"), iteration: 1,
            decision: "approved", summary: "Verified progress.txt", userResponse: "Completed the approved work.", changedPaths: ["progress.txt"]
          }) + "\n```");
          expect(prompt).toContain("specific examples of expected behavior");
          const response = fixtureResponse("```pi-execute\n" + JSON.stringify({
            schemaVersion: 1, objective: "Write progress.txt", summary: "Write the requested step.",
            acceptanceCriteria: ["progress.txt contains the requested step."], relevantPaths: ["progress.txt"],
            executionPlan: ["Write progress.txt, for example step 1, then report the result."], constraints: ["Only change progress.txt."]
          }) + "\n```");
          if (!options.oversizedPlanningHistory) return response;
          const item = { type: "reasoning", id: "rs_fixture", summary: [], encrypted_content: "opaque-reasoning-" + "a".repeat(320000) };
          const reasoning = ["response.output_item.added", "response.output_item.done"].map((type) =>
            `event: ${type}\ndata: ${JSON.stringify({ type, output_index: 0, item })}\n\n`).join("");
          const events = (await response.text()).replaceAll('"output_index":0', '"output_index":1');
          return new Response(events.replace("event: response.output_item.added\n", reasoning + "event: response.output_item.added\n"), { headers: response.headers });
        }
      }
    })
  });
  try {
    await coordinator.start();
    const unsubscribe = coordinator.subscribeEvents((event) => events.push(event));
    try {
      await coordinator.submitUserInput("Execute the approved file change now.");
      const result = await coordinator.approvePendingPlan();
      return { result, workerRequests, plannerRequests, checkIns, events, order, workerBodies, status: coordinator.getStatus() };
    } finally { unsubscribe(); }
  } finally { await coordinator.dispose(); }
}

describe("execution process check-ins through real Pi sessions and tools", () => {
  it("pauses at turns 10 and 20, steers before the next request, and keeps the same workflow iteration", async () => {
    const run = await scenario({ toolTurns: 20 });
    expect(run.result.workflow?.status).toBe("completed");
    expect(run.checkIns).toEqual([10, 20]);
    expect(run.workerRequests).toBe(21);
    expect(run.plannerRequests).toBe(4);
    expect(run.order.slice(9, 12)).toEqual(["B10", "A10", "B11"]);
    expect(run.order.slice(20, 23)).toEqual(["B20", "A20", "B21"]);
    expect(run.workerBodies[10]).toContain("Finish the requested file");
    expect(run.workerBodies[20]).toContain("after turn 20: redirect");
    expect(run.result.workflow?.iterations).toBe(1);
    const checkEvents = run.events.filter((event) => event.eventType === "workflow.check_in_completed");
    expect(checkEvents.map((event) => event.details.turnCount)).toEqual([10, 20]);
    expect(new Set(checkEvents.map((event) => event.details.handoffId)).size).toBe(1);
    expect(checkEvents.every((event) => event.requestId && event.details.workflowId)).toBe(true);
    const progress = run.events.filter((event) => event.eventType === "workflow.execution_progress");
    expect(progress.filter((event) => event.details.completedTurns === 10).map((event) => event.details.checkIn)).toEqual([
      { kind: "checking", afterTurn: 10 }, { kind: "scheduled", afterTurn: 20 }
    ]);
    expect(progress.at(-1)?.details).toMatchObject({ completedTurns: 21, checkIn: { kind: "final_review" } });
    const history = new HistoryIndex(); history.restore({ events: run.events, warnings: [] });
    expect(history.snapshot().records.find((record) => record.kind === "turn")).toMatchObject({
      execution: { completedTurns: 21, checkIn: { kind: "final_review" } }
    });
  }, 120_000);

  it("compacts A's oversized latest planning response before the ten-turn check-in and resumes B once", async () => {
    const run = await scenario({ toolTurns: 10, oversizedPlanningHistory: true });
    expect(run.result.workflow?.status).toBe("completed");
    expect(run.checkIns).toEqual([10]);
    expect(run.workerRequests).toBe(11);
    expect(run.order.slice(9, 13)).toEqual(["B10", "A-summary", "A10", "B11"]);
    expect(run.events.filter((event) => event.eventType === "compaction.completed")).toHaveLength(1);
    expect(run.events.some((event) => event.eventType === "workflow.check_in_failed")).toBe(false);
  }, 120_000);

  it("does not count a real failed B tool call toward the ten successful turns", async () => {
    const run = await scenario({ toolTurns: 11, failedRequests: [5] });
    expect(run.result.workflow?.status).toBe("completed");
    expect(run.checkIns).toEqual([10]);
    expect(run.order.slice(9, 13)).toEqual(["B10", "B11", "A10", "B12"]);
    expect(run.events.find((event) => event.eventType === "workflow.execution_turn_failed")?.details.completedTurns).toBe(4);
  }, 120_000);

  it("sends a final response on turn 10 directly to the normal review", async () => {
    const run = await scenario({ toolTurns: 9 });
    expect(run.result.workflow?.status).toBe("completed");
    expect(run.checkIns).toEqual([]);
    expect(run.plannerRequests).toBe(2);
  }, 120_000);

  it("blocks malformed check-ins before another worker request", async () => {
    const run = await scenario({ toolTurns: 20, checkIn: async () => "No machine block" });
    expect(run.result.workflow?.status).toBe("blocked");
    expect(run.workerRequests).toBe(10);
    expect(run.result.userResponse).toContain("requires exactly one pi-check-in block");
    expect(run.checkIns).toHaveLength(10);
    expect(run.events.filter((event) => event.eventType === "workflow.repair_requested")).toHaveLength(9);
    expect(run.events.filter((event) => event.eventType === "response.exhausted")).toHaveLength(1);
    expect(run.status.responseProgress).toMatchObject({ responseKind: "check-in", attempt: 10, repairCount: 9 });
    expect(run.events.find((event) => event.eventType === "workflow.blocked")?.role).toBe("A");
  }, 120_000);

  it("keeps B paused through nine wrong handoffs and resumes only after the tenth valid check-in", async () => {
    let attempt = 0;
    const run = await scenario({ toolTurns: 10, checkIn: async () => ++attempt < 10
      ? '```pi-handoff\n{"schemaVersion":1,"iteration":3}\n```' : undefined });
    expect(run.result.workflow?.status).toBe("completed");
    expect(run.workerRequests).toBe(11);
    expect(run.checkIns).toEqual(Array(10).fill(10));
    expect(run.order.slice(9, 21)).toEqual(["B10", ...Array(10).fill("A10"), "B11"]);
    const attempts = run.events.filter((event) => event.eventType === "response.attempt_started" && event.details.responseKind === "check-in");
    expect(attempts.map((event) => event.details.attempt)).toEqual([1,2,3,4,5,6,7,8,9,10]);
  }, 120_000);

  it("cancels a paused check-in without starting the next worker request", async () => {
    const run = await scenario({ toolTurns: 20, checkIn: async (_turnCount, coordinator) => {
      void coordinator.cancelActive();
      return undefined;
    } });
    expect(run.workerRequests).toBe(10);
    expect(run.result.userResponse).toContain("Work cancelled");
  }, 120_000);

  it("records an intentional block as an Agent A decision without a failed check-in", async () => {
    const run = await scenario({ toolTurns: 20, decision: "blocked" });
    expect(run.workerRequests).toBe(10);
    expect(run.result.workflow?.status).toBe("blocked");
    expect(run.events.find((event) => event.eventType === "workflow.blocked")?.role).toBe("A");
    expect(run.events.find((event) => event.eventType === "workflow.check_in_completed")?.details.decision).toBe("blocked");
    expect(run.events.some((event) => event.eventType === "workflow.check_in_failed")).toBe(false);
  }, 120_000);
});
