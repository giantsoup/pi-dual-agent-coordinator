import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SessionManager, convertToLlm } from "@earendil-works/pi-coding-agent";
import { createProviderBroker } from "../dist/src/security/provider-broker.js";
import { createBrokerModelRuntime } from "../dist/src/security/model-runtime.js";
import { createSecureModelCatalog, isRoleModel, SMART_MODEL } from "../dist/src/security/models.js";
import { loadCoordinatorConfig, resolveEffectiveModelA } from "../dist/src/app/coordinator-config.js";
import { AGENT_A_OUTPUT_TOKENS, assertRequestBudget } from "../dist/src/runtime/context-budget.js";
import { textToolImageReplay } from "../dist/src/runtime/tool-image-replay.js";
import { redactValue } from "../dist/src/security/redact.js";

if (process.argv.length < 3 || process.argv.length > 4) throw new Error("Usage: bin/node scripts/verify-openai-context.mjs /credential-project [session.jsonl]");
const cwd = resolve(process.argv[2]);
const root = await mkdtemp(join(tmpdir(), "pi-openai-count-"));
let broker;
try {
  const loaded = await loadCoordinatorConfig();
  const reference = resolveEffectiveModelA({}, loaded.config).value ?? SMART_MODEL;
  const model = createSecureModelCatalog().getAll().find(model => reference === model.id || reference === `${model.provider}/${model.id}`);
  if (!model || !isRoleModel("A", model)) throw new Error("Approved Agent A model required");
  broker = await createProviderBroker({ cwd, modelIds: [model.id] });
  if (!broker.countInputTokens) throw new Error("Private counting capability unavailable");
  let messages = [{ role: "user", content: "Count this short message only.", timestamp: 0 }];
  if (process.argv[3]) {
    const copy = join(root, "session.jsonl");
    await writeFile(copy, await readFile(resolve(process.argv[3])));
    messages = SessionManager.open(copy).buildSessionProjection().messages;
  }
  const runtimeModel = { ...model, baseUrl: broker.baseUrl };
  const runtime = await createBrokerModelRuntime(runtimeModel, broker.token);
  const thinking = model.reasoning ? loaded.config?.defaults.thinkingA ?? "high" : "off";
  const outputTokens = Math.min(model.maxTokens, AGENT_A_OUTPUT_TOKENS, Math.floor(model.contextWindow / 4));
  const signal = AbortSignal.timeout(20000);
  let budget;
  await runtime.streamSimple(runtimeModel, { messages: convertToLlm(textToolImageReplay(redactValue(messages))) }, {
    apiKey: broker.token, signal, maxRetries: 0, maxTokens: outputTokens,
    ...(thinking === "off" ? {} : { reasoning: thinking }),
    onPayload: async payload => {
      budget = assertRequestBudget(model, payload, { tokens: await broker.countInputTokens(payload, signal), contextWindow: model.contextWindow, method: "openai-input-tokens" });
      throw new Error("Counting verification only; inference forbidden.");
    }
  }).result();
  if (!budget) throw new Error("Counting verification did not produce an admitted budget");
  process.stdout.write(JSON.stringify({ outcome: "passed", model: model.id, ...budget, archivedSession: Boolean(process.argv[3]), liveInference: false }) + "\n");
} catch {
  process.stderr.write('{"outcome":"failed","liveInference":false,"diagnostic":"OpenAI counting unavailable, unauthorized, or request exceeds its budget. Check Responses input-token counting access from the trusted installation."}\n');
  process.exitCode = 1;
} finally {
  await broker?.close();
  await rm(root, { recursive: true, force: true });
}
