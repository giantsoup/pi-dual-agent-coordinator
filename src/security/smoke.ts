import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ManagedSession } from "../runtime/managed-session.js";
import { AgentSession } from "@mariozechner/pi-coding-agent";
import { SMART_MODEL } from "./models.js";
import { loadCoordinatorConfig, resolveEffectiveModelA } from "../app/coordinator-config.js";
import { createRoleRuntime } from "../runtime/create-role-runtime.js";
import { assertRuntimeSetupReady } from "../app/doctor.js";

async function main(): Promise<void> {
  if (process.argv.length !== 3) throw new Error("Usage: node dist/src/security/smoke.js /absolute/project/workspace");
  const cwd = resolve(process.argv[2]!);
  const loaded = await loadCoordinatorConfig();
  const model = resolveEffectiveModelA({}, loaded.config).value ?? SMART_MODEL;
  const thinking = loaded.config?.defaults.thinkingA ?? "high";
  await assertRuntimeSetupReady({ command: "doctor", cwd, modelA: model, mcpEnabled: false, mcpConfigPaths: [] });
  const state = mkdtempSync(join(tmpdir(), "pi-dual-smoke-"));
  const binding = await createRoleRuntime({ role: "A", cwd, modelOverride: model, thinkingOverride: thinking,
    sessionMode: "memory", sessionRoot: state, loadProjectResources: false, noTools: true });
  const start = Date.now();
  if (!(binding.session instanceof ManagedSession) || !(binding.session.piSession instanceof AgentSession)) throw new Error("Pi integration unavailable.");
  const session = binding.session;
  const timer = setTimeout(() => { void session.abort(); }, 45_000);
  try {
    await session.prompt("Reply exactly LOCAL_API_OK");
    const last = session.messages.at(-1);
    const text = last?.role === "assistant" ? last.content.filter((block) => block.type === "text").map((block) => block.type === "text" ? block.text : "").join("").trim() : "";
    const ok = last?.role === "assistant" && last.stopReason === "stop" && text === "LOCAL_API_OK";
    process.stdout.write(`${JSON.stringify({ provider: "openai", model: session.model?.id, thinking: session.thinkingLevel, outcome: ok ? "passed" : "failed", expected: "LOCAL_API_OK", expectedResponseReceived: ok, elapsedMs: Date.now() - start,
      ...(last?.role === "assistant" ? { inputTokens: last.usage.input, outputTokens: last.usage.output } : {}) })}\n`);
    if (!ok) process.exitCode = 1;
  } finally { clearTimeout(timer); await binding.dispose(); rmSync(state, { recursive: true, force: true }); }
}
void main().catch(() => { process.stderr.write('{"provider":"openai","outcome":"unavailable","expected":"LOCAL_API_OK","diagnostic":"Secure setup or bounded Pi request failed; use doctor for safe diagnostics."}\n'); process.exitCode = 1; });
