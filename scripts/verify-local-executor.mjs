import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRoleRuntime } from "../dist/src/runtime/create-role-runtime.js";
import { EXECUTION_MODEL } from "../dist/src/security/models.js";
import { renderHandoffMessage } from "../dist/src/handoff/render-handoff-message.js";

const root = await mkdtemp(join(tmpdir(), "pi-live-local-"));
const cwd = join(root, "workspace");
const originalCwd = process.cwd();
let binding;
let timer;
try {
  await mkdir(cwd);
  binding = await createRoleRuntime({ role: "B", cwd, sessionRoot: join(root, "state"), sessionMode: "memory" });
  timer = setTimeout(() => { void binding.session.abort(); }, 120_000);
  const tools = [];
  binding.session.subscribe((event) => { if (event.type === "tool_execution_start") tools.push(event.toolName); });
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
  const ok = contents.trim() === "LOCAL_EXECUTOR_OK" && tools.includes("write") && last?.role === "assistant" && last.stopReason === "stop";
  process.stdout.write(`${JSON.stringify({ outcome: ok ? "passed" : "failed", model: EXECUTION_MODEL, tools, fileVerified: contents.trim() === "LOCAL_EXECUTOR_OK" })}\n`);
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
