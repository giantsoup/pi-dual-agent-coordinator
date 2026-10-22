import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Coordinator } from "../../src/coordinator/coordinator.js";
import { createRoleRuntime } from "../../src/runtime/create-role-runtime.js";
import { fixtureResponse, fixtureChatResponse, fixtureChatToolResponse } from "../../src/security/fixture-provider.js";
import { responsesInput } from "../helpers/provider.js";
import type { NormalizedTelemetryEvent } from "../../src/types/telemetry.js";

const roots: string[] = [];
const originalCwd = process.cwd();
afterEach(async () => {
  process.chdir(originalCwd);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const malformed = "<tool_call>\n[\n]\n[END_TOOL_REQUEST]";
const bracketed = 'Let me first check the current state of both files to see what needs fixing:\n\n[TOOL_CALL]{"name":"read","path":"reading-list-test/README.md"}[END_TOOL_CALL]';
const block = (name: string, value: unknown) => `\`\`\`${name}\n${JSON.stringify(value)}\n\`\`\``;

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).join("\n");
  if (value && typeof value === "object") return Object.values(value).map(textOf).join("\n");
  return "";
}
function field(text: string, name: string): string {
  const value = new RegExp(`${name}: ([^\n]+)`).exec(text)?.[1];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function scenario(mode: "recover" | "recover-prose" | "recover-completion" | "recover-after-markup" | "revision-recovery" | "repeat" | "fabricate" | "repair-fabrication" | "format" | "cancel", printedRequest = malformed) {
  const root = await mkdtemp(join(tmpdir(), "pi-tool-recovery-")); roots.push(root);
  const cwd = join(root, "workspace"); await mkdir(cwd);
  let requests = 0;
  let reviews = 0;
  const roundRequests = new Map<number, number>();
  const bodies: Array<{ tools: number; text: string }> = [];
  const events: NormalizedTelemetryEvent[] = [];
  const coordinator = new Coordinator({
    cwd, sessionRoot: join(root, "state"), sessionMode: "memory", jsonLogs: false, verbose: false,
    createRoleRuntime: (options) => createRoleRuntime({ ...options, providerTestBackend: {
      cwd, modelIds: [], load: async () => "fixture-key", request: async (_url, init) => {
        const body: unknown = JSON.parse(String(init?.body));
        const text = textOf(body);
        if (options.role === "B") {
          requests++;
          const handoff = text.slice(text.lastIndexOf("Coordinator handoff for Agent B."));
          const iteration = Number(field(handoff, "Iteration"));
          const step = (roundRequests.get(iteration) ?? 0) + 1;
          roundRequests.set(iteration, step);
          const tools = body && typeof body === "object" && "tools" in body && Array.isArray(body.tools) ? body.tools.length : 0;
          bodies.push({ tools, text });
          if (mode === "repair-fabrication" && requests === 1) return fixtureChatToolResponse("read", { path: "missing.txt" }, "failed-read");
          if (mode === "revision-recovery") {
            if (iteration === 1 && step === 1) return fixtureChatToolResponse("write", { path: "result.txt", content: "ACTUAL_WRITE" }, "initial-write");
            if (iteration === 1 && step === 2 || iteration === 2 && step === 4) return fixtureChatToolResponse("read", { path: "result.txt" }, `read-${iteration}`);
            if (iteration === 1 && step === 3) return fixtureChatResponse(block("pi-completion", { summary: "Done, but missing required fields" }));
            if (iteration === 2 && step === 1) return fixtureChatResponse(printedRequest);
            if (iteration === 2 && step === 3) return fixtureChatToolResponse("write", { path: "result.txt", content: "REVISED_WRITE" }, "revision-write");
          }
          if (mode === "recover-prose" && requests === 1) return fixtureChatResponse("Let me inspect the file and run the checks.");
          if (mode === "repeat" || (mode === "recover" || mode === "recover-after-markup" || mode === "cancel") && requests === 1) return fixtureChatResponse(printedRequest);
          if (mode === "cancel") {
            void coordinator.cancelActive();
            return fixtureChatResponse(malformed);
          }
          const writeAt = mode === "recover-after-markup" ? 3 : 2;
          if ((["recover", "recover-prose", "recover-completion", "recover-after-markup"].includes(mode) && requests === writeAt) || mode === "format" && requests === 1) {
            expect(tools).toBeGreaterThan(0);
            return fixtureChatToolResponse("write", { path: "result.txt", content: "ACTUAL_WRITE" });
          }
          if (["recover", "recover-prose", "recover-completion", "recover-after-markup"].includes(mode) && requests === writeAt + 1) return fixtureChatToolResponse("read", { path: "result.txt" }, "read-back");
          if ((mode === "format" || mode === "repair-fabrication") && requests === 2) return fixtureChatResponse(block("pi-completion", { summary: "Done, but missing required fields" }));
          return fixtureChatResponse(block("pi-completion", { schemaVersion: 1,
            workflowId: field(handoff, "Workflow ID"), handoffId: field(handoff, "Handoff ID"), iteration,
            summary: "Wrote result.txt", changedPaths: ["result.txt"], verification: ["Read result.txt"] }));
        }
        const prompt = textOf(responsesInput(body).prompt);
        if (prompt.includes("Coordinator review prompt")) {
          reviews++;
          const iteration = Number(field(prompt, "Current iteration"));
          expect(await readFile(join(cwd, "result.txt"), "utf8")).toBe(mode === "revision-recovery" && iteration === 2 ? "REVISED_WRITE" : "ACTUAL_WRITE");
          if (mode === "revision-recovery" && iteration === 1) return fixtureResponse(block("pi-handoff", {
            schemaVersion: 1, workflowId: field(prompt, "Workflow ID"), handoffId: "revision-handoff", iteration: 2,
            objective: "Revise result.txt", summary: "Update the actual file", relevantPaths: ["result.txt"],
            acceptanceCriteria: ["result.txt contains REVISED_WRITE"], reviewNotes: ["Use native write and read tools; report observed results"]
          }));
          return fixtureResponse(block("pi-final", { schemaVersion: 1, workflowId: field(prompt, "Workflow ID"),
            iteration, decision: "approved", summary: "Read back the real file", userResponse: "Verified real work", changedPaths: ["result.txt"] }));
        }
        return fixtureResponse(block("pi-plan", { schemaVersion: 1, objective: "Write result.txt", summary: "Write and read the file",
          acceptanceCriteria: ["result.txt contains ACTUAL_WRITE"], relevantPaths: ["result.txt"], executionPlan: ["Write result.txt, then read it"] }));
      }
    } })
  });
  try {
    await coordinator.start();
    coordinator.subscribeEvents((event) => events.push(event));
    await coordinator.submitUserInput("Create the file");
    const result = await coordinator.approvePendingPlan();
    return { result, requests, reviews, bodies, events, contents: await readFile(join(cwd, "result.txt"), "utf8").catch(() => undefined) };
  } finally { await coordinator.dispose(); }
}

describe("malformed tool text through the real Pi execution loop", () => {
  it("continues an unfinished prose-only execution with native tools instead of formatting a report", async () => {
    const run = await scenario("recover-prose");
    expect(run.result.workflow?.status).toBe("completed");
    expect(run.contents).toBe("ACTUAL_WRITE");
    expect(run.requests).toBe(4);
    expect(run.bodies.every((body) => body.tools > 0)).toBe(true);
    expect(run.events.filter((event) => event.eventType === "workflow.tool_recovery_redirected").map((event) => event.details.reason)).toEqual(["incomplete_execution"]);
    expect(run.events.some((event) => event.eventType === "workflow.repair_requested")).toBe(false);
  }, 30_000);

  it("recovers the screenshot's bracketed read request during revision with tools still enabled", async () => {
    const run = await scenario("revision-recovery", bracketed);
    expect(run.result.workflow?.status).toBe("completed");
    expect(run.contents).toBe("REVISED_WRITE");
    expect(run.reviews).toBe(2);
    expect(run.requests).toBe(9);
    expect(run.bodies[3]?.tools).toBe(0);
    expect(run.bodies.slice(4).every((body) => body.tools > 0)).toBe(true);
    expect(run.bodies[5]?.text).toContain("No tool call was executed by that text");
    expect(run.events.filter((event) => event.eventType === "workflow.tool_recovery_redirected").map((event) => event.details)).toMatchObject([
      { iteration: 2, reason: "printed_tool_markup", redirect: 1 },
      { iteration: 2, reason: "unsupported_completion", redirect: 2 }
    ]);
    expect(run.events.filter((event) => event.eventType === "pi.tool_execution_start" && event.details.toolName === "write")).toHaveLength(2);
    expect(run.events.filter((event) => event.eventType === "workflow.repair_requested")).toHaveLength(1);
  }, 30_000);

  it("keeps tools through separate formatting and rejects stale evidence during a later revision", async () => {
    const run = await scenario("revision-recovery");
    expect(run.result.workflow?.status).toBe("completed");
    expect(run.contents).toBe("REVISED_WRITE");
    expect(run.requests).toBe(9);
    expect(run.reviews).toBe(2);
    expect(run.bodies[3]?.tools).toBe(0);
    expect(run.bodies.slice(4).every((body) => body.tools > 0)).toBe(true);
    expect(run.events.filter((event) => event.eventType === "workflow.tool_recovery_redirected").map((event) => event.details)).toMatchObject([
      { iteration: 2, reason: "printed_tool_markup", redirect: 1, successfulToolResults: 0 },
      { iteration: 2, reason: "unsupported_completion", redirect: 2, successfulToolResults: 0 }
    ]);
    expect(run.events.filter((event) => event.eventType === "pi.tool_execution_start" && event.details.toolName === "write")).toHaveLength(2);
  }, 30_000);

  it.each(["recover-completion", "recover-after-markup"] as const)("recovers a false completion before review, mode=%s", async (mode) => {
    const run = await scenario(mode);
    expect(run.result.workflow?.status).toBe("completed");
    expect(run.contents).toBe("ACTUAL_WRITE");
    expect(run.requests).toBe(mode === "recover-after-markup" ? 5 : 4);
    expect(run.reviews).toBe(1);
    expect(run.events.filter((event) => event.eventType === "workflow.iteration_completed")).toHaveLength(1);
    const redirects = run.events.filter((event) => event.eventType === "workflow.tool_recovery_redirected");
    expect(redirects.at(-1)?.details.reason).toBe("unsupported_completion");
    expect(run.bodies.every((body) => body.tools > 0)).toBe(true);
    expect(run.events.some((event) => event.eventType === "workflow.repair_requested")).toBe(false);
  }, 30_000);

  it("keeps tools enabled, steers B to native calls, and reviews the actual written file", async () => {
    const run = await scenario("recover");
    expect(run.result.workflow?.status).toBe("completed");
    expect(run.contents).toBe("ACTUAL_WRITE");
    expect(run.requests).toBe(4);
    expect(run.bodies[1]?.tools).toBeGreaterThan(0);
    expect(run.bodies[1]?.text).toContain("No tool call was executed by that text");
    expect(run.events.filter((event) => event.eventType === "workflow.repair_requested")).toHaveLength(0);
  }, 30_000);

  it.each([malformed, bracketed])("stops repeated malformed text after two redirects without formatting a fictional completion, case=%#", async (printedRequest) => {
    const run = await scenario("repeat", printedRequest);
    expect(run.result.workflow?.status).toBe("blocked");
    expect(run.requests).toBe(3);
    expect(run.reviews).toBe(0);
    expect(run.result.userResponse).toContain("tool-call recovery exhausted");
    expect(run.events.some((event) => event.eventType === "workflow.iteration_completed")).toBe(false);
  }, 30_000);

  it.each(["fabricate", "repair-fabrication"] as const)("rejects unsupported completion claims, mode=%s", async (mode) => {
    const run = await scenario(mode);
    expect(run.result.workflow?.status).toBe("blocked");
    expect(run.result.userResponse).toContain(mode === "fabricate" ? "tool-call recovery exhausted" : "no successful native tool results");
    expect(run.reviews).toBe(0);
    expect(run.contents).toBeUndefined();
    expect(run.requests).toBe(3);
  }, 30_000);

  it("formats a report separately after real execution, without replaying the write", async () => {
    const run = await scenario("format");
    expect(run.result.workflow?.status).toBe("completed");
    expect(run.requests).toBe(3);
    expect(run.bodies[2]?.tools).toBe(0);
    expect(run.contents).toBe("ACTUAL_WRITE");
    expect(run.events.filter((event) => event.eventType === "pi.tool_execution_start" && event.details.toolName === "write")).toHaveLength(1);
  }, 30_000);

  it.each([malformed, bracketed])("cancels recovery without writing or starting review, case=%#", async (printedRequest) => {
    const run = await scenario("cancel", printedRequest);
    expect(run.result.userResponse).toContain("Work cancelled");
    expect(run.contents).toBeUndefined();
    expect(run.reviews).toBe(0);
    expect(run.requests).toBe(2);
  }, 30_000);
});

it.each(["pass", "fail", "fail-print", "fail-format", "repair", "misleading", "pipeline"] as const)("reviews native verification and stops without unauthorized repair: %s", async (mode) => {
  const { writeFile, readdir } = await import("node:fs/promises");
  const { SessionLedger } = await import("../../src/persistence/session-ledger.js");
  const { RecoveryLoader } = await import("../../src/persistence/recovery-loader.js");
  const { renderReviewMessage } = await import("../../src/workflow/render-review-message.js");
  const root = await mkdtemp(join(tmpdir(), "pi-native-verification-")); roots.push(root);
  const cwd = join(root, "workspace"); await mkdir(cwd);
  const passing = mode === "pass" || mode === "repair";
  const contents = `import test from 'node:test'; import assert from 'node:assert/strict';\ntest('ascending assertion', () => assert.equal(1, ${passing ? 1 : 2}));\n`;
  await writeFile(join(cwd, "check.test.mjs"), mode === "repair" ? contents.replace("assert.equal(1, 1)", "assert.equal(1, 2)") : contents);
  const command = "node --test --test-reporter=tap check.test.mjs" + (mode === "pipeline" ? " | cat" : "");
  const calls: string[] = [];
  let reviewPrompt = "";
  let bRequests = 0;
  const events: NormalizedTelemetryEvent[] = [];
  const coordinator = new Coordinator({ cwd, sessionRoot: join(root, "state"), sessionMode: "persistent", jsonLogs: false, verbose: false,
    createRoleRuntime: (options) => createRoleRuntime({ ...options, loadProjectResources: false, providerTestBackend: {
      cwd, modelIds: [], load: async () => "dummy-verification-key", request: async (_url, init) => {
        const body: unknown = JSON.parse(String(init?.body)); const text = textOf(body);
        if (options.role === "B") {
          bRequests++;
          const handoff = text.slice(text.lastIndexOf("Coordinator handoff for Agent B."));
          if (mode === "repair" && bRequests === 1) return fixtureChatToolResponse("write", { path: "check.test.mjs", content: contents }, "authorized-repair");
          if (bRequests === (mode === "repair" ? 2 : 1)) return fixtureChatToolResponse("read", { path: "check.test.mjs" }, "read-test");
          if (bRequests === (mode === "repair" ? 3 : 2)) return fixtureChatToolResponse("bash", { command }, "run-check");
          if (bRequests === 3 && mode === "fail-print") return fixtureChatResponse(bracketed);
          if (bRequests === 3 && mode === "fail-format") return fixtureChatResponse(block("pi-completion", { summary: "Observed failed verification." }));
          return fixtureChatResponse(block("pi-completion", { schemaVersion: 1, workflowId: field(handoff, "Workflow ID"), handoffId: field(handoff, "Handoff ID"), iteration: 1,
            summary: mode === "misleading" ? "All tests passed; the descending sort was broken." : passing ? "Observed a passing check." : "Observed failed verification; causes unresolved.",
            changedPaths: mode === "repair" ? ["check.test.mjs"] : [], verification: [mode === "misleading" ? "30 passed, exit 0" : `${command}: exit ${mode === "pipeline" || passing ? 0 : 1}`] }));
        }
        const prompt = textOf(responsesInput(body).prompt);
        if (prompt.includes("Coordinator review prompt")) {
          reviewPrompt = prompt;
          const nativeLine = prompt.split("\n").find(line => line.startsWith('{"schemaVersion":1,"observations"'));
          if (!nativeLine) throw new Error("Review lacks native facts");
          const { nativeEvidenceSchema } = await import("../../src/coordinator/native-verification.js");
          const evidence = nativeEvidenceSchema.parse(JSON.parse(nativeLine));
          expect(evidence.observations.map((item) => item.toolName)).toEqual(calls);
          const check = evidence.observations.at(-1);
          if (!check) throw new Error("Missing native check result");
          expect(check.toolCallId).toBe("run-check");
          expect(check.command).toBe(command);
          expect(check.exitCode).toBe(passing || mode === "pipeline" ? 0 : 1);
          expect(check.output).toContain(passing ? "# pass 1" : "# fail 1");
          expect(check.output).toContain("ascending assertion");
          // The fixture reviewer uses observed output, not B's misleading totals or direction.
          return fixtureResponse(block("pi-final", { schemaVersion: 1, workflowId: field(prompt, "Workflow ID"), iteration: 1,
            decision: mode === "misleading" || mode === "pipeline" ? "blocked" : "approved",
            summary: passing ? "Passing check observed" : "Failed check observed",
            userResponse: passing ? "Check passed." : "Verification completed with one failed ascending assertion. Application correctness remains unresolved.", changedPaths: mode === "repair" ? ["check.test.mjs"] : [] }));
        }
        return fixtureResponse(block("pi-plan", { schemaVersion: 1, objective: mode === "repair" ? "Repair then verify" : "Record verification only", summary: "Read the test and run the exact check once",
          acceptanceCriteria: [mode === "repair" ? "Test passes" : "Observed exit and failed checks accurately reported"], relevantPaths: ["check.test.mjs"],
          executionPlan: [...(mode === "repair" ? ["Correct assert.equal(1, 2) to assert.equal(1, 1)"] : []), `Read check.test.mjs once, run ${command} once, report and stop including on failure`],
          constraints: [mode === "repair" ? "Only repair check.test.mjs" : "No writes, diagnosis, repair, or reruns"] }));
      }
    } }) });
  try {
    await coordinator.start(); coordinator.subscribeEvents(event => {
      events.push(event);
      if (event.eventType === "pi.tool_execution_start") calls.push(String(event.details.toolName));
    });
    await coordinator.submitUserInput(mode === "repair" ? "Repair the assertion and verify" : "Record the check without repair");
    expect(calls).toEqual([]); // Only the operator API corresponding to /approve may start B.
    const result = await coordinator.approvePendingPlan();
    expect(result.workflow?.status).toBe(mode === "misleading" || mode === "pipeline" ? "blocked" : "completed");
    expect(calls).toEqual(mode === "repair" ? ["write", "read", "bash"] : ["read", "bash"]);
    expect(bRequests).toBe(mode === "repair" || mode === "fail-print" || mode === "fail-format" ? 4 : 3);
    expect(await readFile(join(cwd, "check.test.mjs"), "utf8")).toBe(contents);
    expect(await readdir(cwd)).toEqual(["check.test.mjs"]);
    expect(reviewPrompt).toContain("Native observations");
    if (!passing) expect(result.userResponse).toContain("one failed ascending assertion");
    expect(events.filter(event => event.eventType === "workflow.tool_recovery_redirected")).toHaveLength(mode === "fail-print" ? 1 : 0);
    expect(events.filter(event => event.eventType === "workflow.repair_requested")).toHaveLength(mode === "fail-format" ? 1 : 0);
    expect(events.some(event => event.eventType === "provider.first_body_chunk" && event.runId && event.requestId)).toBe(true);
    if (mode === "fail-format") {
      const formattingRuns = new Set(events.filter(event => event.eventType === "runtime.run_started" && event.details.formatOnly === true).map(event => event.runId));
      const formattingDiagnostics = events.filter(event => event.eventType.startsWith("provider.") && formattingRuns.has(event.runId));
      expect(formattingDiagnostics.length).toBeGreaterThan(0);
      expect(formattingDiagnostics.every(event => event.details.requestBudget === undefined)).toBe(true);
    }
    const ledger = new SessionLedger(join(root, "state", "ledger", "handoffs.jsonl"));
    const before = await readFile(join(root, "state", "ledger", "handoffs.jsonl"), "utf8");
    const recovered = await new RecoveryLoader(ledger).load();
    const workflow = Object.values(recovered.workflows)[0];
    if (!workflow?.latestCompletion) throw new Error("Missing reconstructed completion");
    expect(renderReviewMessage(workflow, workflow.latestCompletion)).toContain('"toolCallId":"run-check"');
    expect(await readFile(join(root, "state", "ledger", "handoffs.jsonl"), "utf8")).toBe(before);
    const completed = workflow.latestIteration?.completed;
    if (!completed?.sessionFile) throw new Error("Missing native archive reference");
    const { readSessionArchive } = await import("../../src/runtime/session-history.js");
    const { projectHistoryDetail } = await import("../../src/app/interactive/history-detail.js");
    const archiveBytes = await readFile(completed.sessionFile);
    const archive = readSessionArchive(completed.sessionFile);
    const historyCall = { kind: "tool", id: "history-check", parentId: "run", role: "B", sessionId: completed.sessionId,
      callId: "run-check", toolName: "bash", request: command, preview: "", title: "Observed check", timestamp: completed.timestamp,
      outcome: { kind: "completed", endedAt: completed.timestamp } } satisfies import("../../src/types/history.js").HistoryRecord;
    const detail = projectHistoryDetail(historyCall, [historyCall], archive.entries, "output", 0, 100);
    expect(detail.lines.join("\n")).toContain(`Observed shell exit code: ${passing || mode === "pipeline" ? 0 : 1}`);
    const legacy = structuredClone(archive.entries);
    const legacyResult = legacy.find(entry => entry.message?.role === "toolResult" && entry.message.toolCallId === "run-check");
    if (legacyResult?.message) delete legacyResult.message.details;
    expect(projectHistoryDetail(historyCall, [historyCall], legacy, "output", 0, 100).reason).toContain("exit code is unknown");
    expect(await readFile(completed.sessionFile)).toEqual(archiveBytes);
  } finally { await coordinator.dispose(); }
}, 30_000);
