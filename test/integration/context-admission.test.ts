import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertToLlm, SessionManager } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import { createRoleRuntime } from "../../src/runtime/create-role-runtime.js";
import { AGENT_A_OUTPUT_TOKENS, CONTEXT_SAFETY_TOKENS, SUMMARY_OUTPUT_TOKENS, textPayloadAllowance } from "../../src/runtime/context-budget.js";
import { fixtureResponse, fixtureToolResponse } from "../../src/security/fixture-provider.js";
import { createBrokerModelRuntime } from "../../src/security/model-runtime.js";
import { assistantMessage } from "../helpers/fakes.js";

it("compacts before A's first request when prompt and tool declarations exceed admission", async () => {
  const original = process.cwd();
  const root = await mkdtemp(join(tmpdir(), "pi-context-admission-"));
  const cwd = join(root, "workspace");
  await mkdir(cwd);
  const manager = SessionManager.inMemory(cwd);
  manager.appendMessage({ role: "user", content: "Preserve this objective. " + "x".repeat(247000), timestamp: 1 });
  manager.appendMessage(assistantMessage("The completed work is ready for review."));
  let summaries = 0;
  let reviews = 0;
  const binding = await createRoleRuntime({ role: "A", cwd, agentDir: join(root, "agent"), sessionRoot: join(root, "state"), sessionMode: "memory", initialSessionManager: manager,
    providerTestBackend: { cwd, modelIds: [], load: async () => "dummy-admission-key", request: async (_url, init) => {
      const body = String(init?.body);
      if (body.includes(`"max_output_tokens":${SUMMARY_OUTPUT_TOKENS}`)) {
        summaries++;
        return fixtureResponse("Preserve this objective. The completed work is ready for review.");
      }
      reviews++;
      return fixtureResponse("Review completed.");
    } } });
  try {
    await binding.session.prompt("Review the completed work.");
    expect(summaries).toBe(1);
    expect(reviews).toBe(1);
    expect(manager.getEntries().filter(entry => entry.type === "compaction")).toHaveLength(1);
  } finally { await binding.dispose(); process.chdir(original); await rm(root, { recursive: true, force: true }); }
});

it.each(["submission", "tool continuation", "prompt refresh"])("counts the prepared request before %s admission", async (stage) => {
  const original = process.cwd();
  const root = await mkdtemp(join(tmpdir(), "pi-reasoning-admission-"));
  const cwd = join(root, "workspace");
  await mkdir(cwd);
  await writeFile(join(cwd, "evidence.txt"), "read evidence ".repeat(70));
  const manager = SessionManager.inMemory(cwd);
  let summaries = 0;
  let requests = 0;
  const createBinding = () => createRoleRuntime({ role: "A", cwd, agentDir: join(root, "agent"), sessionRoot: join(root, "state"), sessionMode: "memory", initialSessionManager: manager,
    thinkingOverride: "high",
    providerTestBackend: { cwd, modelIds: [], load: async () => "dummy-reasoning-key", request: async (_url, init) => {
      const body = String(init?.body);
      if (body.includes(`"max_output_tokens":${SUMMARY_OUTPUT_TOKENS}`)) {
        summaries++;
        return fixtureResponse("Review the completed work. Preserve the observed evidence and do not repeat completed tools.");
      }
      requests++;
      if (stage === "tool continuation" && requests === 2) return fixtureToolResponse("read", { path: "evidence.txt" });
      return fixtureResponse("Review completed.");
    } } });
  let binding = await createBinding();
  const tools: string[] = [];
  const observeTools = () => binding.session.subscribe(event => { if (event.type === "tool_execution_start") tools.push(event.toolName); });
  let unsubscribe = observeTools();
  try {
    await binding.session.prompt("Prepare to review completed work.");
    const model = binding.session.model;
    if (!model) throw new Error("Missing fixture model");
    for (let index = 0; index < 5; index++) manager.appendMessage({ ...assistantMessage(`Verified observation ${index}.`),
      model: model.id, providerThinkingLevel: "high" });
    const prompt = "Review the completed work.";
    const preview = await createBrokerModelRuntime(model, "dummy-measurement-key");
    let inputAllowance: number | undefined;
    await preview.streamSimple(model, { messages: convertToLlm([...manager.buildSessionProjection().messages,
      { role: "user", content: "", timestamp: 0 }, { role: "user", content: prompt, timestamp: 0 }]) },
    { apiKey: "dummy-measurement-key", reasoning: "high", maxRetries: 0, onPayload: payload => {
      inputAllowance = textPayloadAllowance(payload);
      throw new Error("Measurement only; inference forbidden.");
    } }).result();
    if (inputAllowance === undefined) throw new Error("Fixture request was not measured");
    const limit = model.contextWindow - Math.min(model.maxTokens, AGENT_A_OUTPUT_TOKENS) - CONTEXT_SAFETY_TOKENS;
    // Keep the gap smaller than the configuration items omitted by the old preview.
    const target = limit + (stage === "submission" ? 100 : -1500);
    manager.appendMessage({ role: "user", content: "x".repeat(target - inputAllowance), timestamp: 0 });
    const archived = structuredClone(manager.getEntries());
    if (stage === "prompt refresh") {
      unsubscribe();
      await binding.dispose();
      await writeFile(join(cwd, "AGENTS.md"), "Additional operator constraints. ".repeat(150));
      binding = await createBinding();
      unsubscribe = observeTools();
    }
    await binding.session.prompt(prompt);
    expect(summaries).toBe(1);
    expect(requests).toBe(stage === "tool continuation" ? 3 : 2);
    expect(tools).toEqual(stage === "tool continuation" ? ["read"] : []);
    expect(manager.getEntries().slice(0, archived.length)).toEqual(archived);
    expect(manager.getEntries().filter(entry => entry.type === "compaction")).toHaveLength(1);
    expect(binding.session.messages?.at(-1)).toMatchObject({ role: "assistant", stopReason: "stop" });
  } finally { unsubscribe(); await binding.dispose(); process.chdir(original); await rm(root, { recursive: true, force: true }); }
});
