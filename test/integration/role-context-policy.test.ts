import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import { createRoleRuntime } from "../../src/runtime/create-role-runtime.js";
import { SUMMARY_OUTPUT_TOKENS } from "../../src/runtime/context-budget.js";
import { fixtureResponse, fixtureToolResponse, fixtureChatResponse, fixtureChatToolResponse } from "../../src/security/fixture-provider.js";
import { assistantMessage } from "../helpers/fakes.js";

it.each([20000, 240000])("keeps A's %i-token history through repeated reads despite large serialized reasoning", async inputTokens => {
  const original = process.cwd();
  const root = await mkdtemp(join(tmpdir(), "pi-a-context-policy-"));
  const cwd = join(root, "workspace"); await mkdir(cwd);
  await writeFile(join(cwd, "evidence.txt"), "verified evidence\n".repeat(300));
  const manager = SessionManager.inMemory(cwd);
  manager.appendMessage({ role: "user", content: "Review the observed work. " + "x".repeat(80000), timestamp: 0 });
  manager.appendMessage({ ...assistantMessage("Keep the objective and observed evidence."), model: "gpt-6-luna", content: [
    { type: "thinking", thinking: "", thinkingSignature: JSON.stringify({ type: "reasoning", id: "rs_fixture", summary: [], encrypted_content: "opaque-" + "a".repeat(320000) }) },
    { type: "text", text: "Keep the objective and observed evidence." }
  ] });
  let summaries = 0; let requests = 0; let counts = 0; let reads = 0;
  const binding = await createRoleRuntime({ role: "A", cwd, agentDir: join(root, "agent"), sessionRoot: join(root, "state"), sessionMode: "memory", initialSessionManager: manager,
    providerTestBackend: { cwd, modelIds: [], load: async () => "dummy-a-policy",
      countRequest: async (url, init) => {
        expect(String(url)).toBe("https://api.openai.com/v1/responses/input_tokens");
        expect(String(init?.body)).not.toContain("max_output_tokens");
        counts++;
        return Response.json({ object: "response.input_tokens", input_tokens: inputTokens });
      },
      request: async (_url, init) => {
        if (String(init?.body).includes(`"max_output_tokens":${SUMMARY_OUTPUT_TOKENS}`)) { summaries++; return fixtureResponse("Objective retained."); }
        requests++;
        return requests <= 4 ? fixtureToolResponse("read", { path: "evidence.txt" }) : fixtureResponse("Review complete.");
      } } });
  const unsubscribe = binding.session.subscribe(event => { if (event.type === "tool_execution_start") reads++; });
  try {
    await binding.session.prompt("Continue reviewing the evidence.");
    expect(summaries).toBe(0);
    expect(requests).toBe(5);
    expect(reads).toBe(4);
    expect(counts).toBeGreaterThan(0);
    expect(binding.session.requestBudget).toMatchObject({ inputTokens, outputTokens: 16384, contextWindow: 272000 });
    expect(manager.getEntries().filter(entry => entry.type === "compaction")).toHaveLength(0);
  } finally { unsubscribe(); await binding.dispose(); process.chdir(original); await rm(root, { recursive: true, force: true }); }
});

it("compacts B near 32k input tokens and preserves its completed write", async () => {
  const original = process.cwd();
  const root = await mkdtemp(join(tmpdir(), "pi-b-context-policy-"));
  const cwd = join(root, "workspace"); await mkdir(cwd);
  const manager = SessionManager.inMemory(cwd);
  manager.appendMessage({ role: "user", content: "Preserve this objective. " + "x".repeat(100000), timestamp: 0 });
  manager.appendMessage(assistantMessage("Ready to write exactly once."));
  let summaries = 0; let executions = 0; let writes = 0;
  const a = await createRoleRuntime({ role: "A", cwd, agentDir: join(root, "agent"), sessionRoot: join(root, "state"), sessionMode: "memory",
    providerTestBackend: { cwd, modelIds: [], load: async () => "dummy-b-summary", request: async () => { summaries++; return fixtureResponse("The approved file was written. Report its observed result without repeating the write."); } } });
  const b = await createRoleRuntime({ role: "B", cwd, agentDir: join(root, "agent"), sessionRoot: join(root, "state"), sessionMode: "memory", initialSessionManager: manager,
    summarizeCompaction: a.summarizeCompaction, onMutation: () => { writes++; },
    providerTestBackend: { cwd, modelIds: [], load: async () => { throw new Error("No B cloud credentials"); }, request: async () => {
      executions++;
      return executions === 1 ? fixtureChatToolResponse("write", { path: "result.txt", content: "y".repeat(40000) }) : fixtureChatResponse("Finished.");
    } } });
  try {
    await b.session.prompt("Write result.txt once, then report.");
    expect(summaries).toBe(1);
    expect(executions).toBe(2);
    expect(writes).toBe(1);
    expect(await readFile(join(cwd, "result.txt"), "utf8")).toBe("y".repeat(40000));
    expect(b.session.requestBudget?.inputTokens).toBeLessThan(32768);
    expect(b.session.requestBudget?.contextWindow).toBe(65536);
    expect(manager.getEntries().filter(entry => entry.type === "compaction")).toHaveLength(1);
  } finally { await b.dispose(); await a.dispose(); process.chdir(original); await rm(root, { recursive: true, force: true }); }
});
