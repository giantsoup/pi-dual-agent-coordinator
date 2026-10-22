import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRoleRuntime } from "../dist/src/runtime/create-role-runtime.js";
import { EXECUTION_MODEL } from "../dist/src/security/models.js";
import { LmStudioModels } from "../dist/src/security/lm-studio.js";
import { loadCoordinatorConfig, resolveEffectiveModelB, resolveEffectiveThinkingB } from "../dist/src/app/coordinator-config.js";
import { renderHandoffMessage } from "../dist/src/handoff/render-handoff-message.js";
import { resolveAgentBResponse } from "../dist/src/coordinator/review-cycle.js";

const root = await mkdtemp(join(tmpdir(), "pi-live-local-"));
const cwd = join(root, "workspace");
const originalCwd = process.cwd();
let binding;
let timer;
let selectedModel = EXECUTION_MODEL;
const withToolImage = process.argv.includes("--with-tool-image");
const withFormatRepair = process.argv.includes("--with-format-repair");
const image = { type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" };
try {
  await mkdir(cwd);
  const loaded = await loadCoordinatorConfig();
  if (loaded.warnings.length) throw new Error("Repair invalid coordinator defaults before local verification.");
  selectedModel = resolveEffectiveModelB({}, loaded.config).value ?? EXECUTION_MODEL;
  const selected = (await new LmStudioModels().listModels()).find(({ model }) => selectedModel === model.id || selectedModel === `lm-studio/${model.id}`);
  if (!selected || selected.disabledReason || !selected.loaded) throw new Error("The selected executor must already be loaded with supported tools and sufficient context. Verification does not load or download models.");
  const manager = SessionManager.inMemory(cwd);
  if (withToolImage) {
    // A synthetic completed image read reproduces the failed browser result's replay shape.
    await writeFile(join(cwd, "image.png"), Buffer.from(image.data, "base64"));
    manager.appendMessage({ role: "user", content: "Read image.png as archived evidence only.", timestamp: Date.now() });
    manager.appendMessage({ role: "assistant", api: selected.model.api, provider: selected.model.provider, model: selected.model.id,
      content: [{ type: "toolCall", id: "archived-image", name: "read", arguments: { path: "image.png" } }], stopReason: "toolUse",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: Date.now() });
    manager.appendMessage({ role: "toolResult", toolCallId: "archived-image", toolName: "read", content: [image], isError: false, timestamp: Date.now() });
  }
  binding = await createRoleRuntime({ role: "B", cwd, modelOverride: selectedModel, localModel: selected.model,
    thinkingOverride: resolveEffectiveThinkingB({}, loaded.config).value, sessionRoot: join(root, "state"), sessionMode: "memory", initialSessionManager: manager });
  timer = setTimeout(() => { void binding.session.abort(); }, 120_000);
  const tools = [];
  const continuationTools = [];
  let phase = "execution";
  let formatted;
  binding.session.subscribe((event) => {
    if (event.type === "tool_execution_start") {
      tools.push(event.toolName);
      if (phase === "continuation") continuationTools.push(event.toolName);
    }
    if (phase === "formatting" && event.type === "turn_end" && event.message.role === "assistant") formatted = event.message;
  });
  await binding.session.prompt(renderHandoffMessage({
    schemaVersion: 1, workflowId: "workflow-verify", handoffId: "handoff-verify", iteration: 1,
    objective: "Create verification.txt containing exactly LOCAL_EXECUTOR_OK.",
    summary: "This verifies that your local model can invoke the real sandboxed write tool. The file does not exist yet.",
    acceptanceCriteria: ["The file exists on disk and contains LOCAL_EXECUTOR_OK."], relevantPaths: ["verification.txt"],
    executionPlan: ["Call the write tool with path verification.txt and content LOCAL_EXECUTOR_OK.", "Call the read tool on verification.txt to verify the actual file.", "Only after those tool calls succeed, emit pi-completion."],
    constraints: ["Do not merely describe or simulate tool calls. Actually invoke the provided tools.", "Do not touch other files."]
  }));
  const contents = await readFile(join(cwd, "verification.txt"), "utf8").catch(() => "");
  const last = binding.session.messages?.at(-1);
  let formatVerified = false;
  if (withFormatRepair && last?.role === "assistant" && last.stopReason === "stop" && contents.trim() === "LOCAL_EXECUTOR_OK" && tools.includes("write") && tools.includes("read")) {
    const originalContext = JSON.stringify(binding.session.messages);
    const originalTools = binding.session.piSession.getActiveToolNames();
    const text = last.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
    phase = "formatting";
    await binding.session.prompt("Correct the recorded completion report. Return exactly one fenced pi-completion JSON block with schemaVersion 1, workflowId workflow-verify, handoffId handoff-verify, iteration 1, summary, changedPaths, verification, and openQuestions. Preserve the actual observed results. Do not perform any action.", {
      formatting: { previousResponse: { ...last, content: [{ type: "text", text: text.replaceAll("```pi-completion", "```completion") }] } },
      responseId: "local-format-verification"
    });
    const result = formatted && resolveAgentBResponse({ message: formatted, workflowId: "workflow-verify", handoffId: "handoff-verify", iteration: 1 });
    formatVerified = result?.kind === "completion" && JSON.stringify(binding.session.messages) === originalContext
      && JSON.stringify(binding.session.piSession.getActiveToolNames()) === JSON.stringify(originalTools);
    if (formatVerified) {
      phase = "continuation";
      await binding.session.prompt("Use the native read tool to read verification.txt again. Do not write or edit any file. Then emit pi-completion for workflow-verify, handoff-verify, iteration 1 with changedPaths empty and the observed read result in verification.");
      const continued = binding.session.messages?.at(-1);
      formatVerified = continued?.role === "assistant" && continued.stopReason === "stop"
        && resolveAgentBResponse({ message: continued, workflowId: "workflow-verify", handoffId: "handoff-verify", iteration: 1 }).kind === "completion"
        && continuationTools.includes("read") && continuationTools.every((tool) => tool === "read")
        && tools.every((tool) => tool === "write" || tool === "read") && tools.filter((tool) => tool === "write").length === 1
        && (await readFile(join(cwd, "verification.txt"), "utf8")).trim() === "LOCAL_EXECUTOR_OK";
    }
  }
  const archivedImagePreserved = binding.session.messages.some(message => message.role === "toolResult" && message.content.some(part => part.type === "image" && part.data === image.data));
  const ok = contents.trim() === "LOCAL_EXECUTOR_OK" && tools.includes("write") && last?.role === "assistant" && last.stopReason === "stop" && (!withToolImage || archivedImagePreserved) && (!withFormatRepair || formatVerified);
  process.stdout.write(`${JSON.stringify({ outcome: ok ? "passed" : "failed", model: selectedModel, thinking: binding.session.thinkingLevel, reasoningObserved: binding.session.messages.some(message => message.role === "assistant" && message.content.some(part => part.type === "thinking" && part.thinking.length > 0)), tools, fileVerified: contents.trim() === "LOCAL_EXECUTOR_OK", ...(withToolImage ? { toolImageReplay: true, archivedImagePreserved } : {}), ...(withFormatRepair ? { separateFormattingVerified: formatVerified, continuationTools } : {}) })}\n`);
  if (!ok) process.stderr.write(`${JSON.stringify(last)}\n`);
  if (!ok) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Local verification failed"}\n`);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  await binding?.dispose();
  process.chdir(originalCwd);
  await rm(root, { recursive: true, force: true });
}
