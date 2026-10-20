import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { AgentASummarizer } from '../dist/src/runtime/agent-a-summarizer.js';
import { renderHandoffMessage } from '../dist/src/handoff/render-handoff-message.js';
import { createRoleRuntime } from '../dist/src/runtime/create-role-runtime.js';
import { createSecureModelCatalog, SMART_MODEL, EXECUTION_MODEL } from '../dist/src/security/models.js';
import { LmStudioModels } from '../dist/src/security/lm-studio.js';
import { loadCoordinatorConfig, resolveEffectiveModelB, resolveEffectiveThinkingB } from '../dist/src/app/coordinator-config.js';
// Run only from a verified trusted installation. The argument scopes Keychain access.
assert(process.argv[2], 'Supply the credential project path.');
await import('./verify-installation.mjs');
const project = resolve(process.argv[2]);
const original = process.cwd();
const root = await mkdtemp(join(tmpdir(), 'pi-live-compaction-'));
let binding; let summarizer; let timer;
try {
  const cwd = join(root, 'workspace'); await mkdir(cwd);
  const config = await loadCoordinatorConfig();
  assert.equal(config.warnings.length, 0);
  const canonicalA = config.config?.defaults?.modelA ?? SMART_MODEL;
  const modelA = createSecureModelCatalog().getAll().find(model => `${model.provider}/${model.id}` === canonicalA);
  assert(modelA?.provider === 'openai');
  const canonicalB = resolveEffectiveModelB({}, config.config).value ?? EXECUTION_MODEL;
  const local = (await new LmStudioModels().listModels()).find(item => canonicalB === `lm-studio/${item.model.id}`);
  assert(local?.loaded && !local.disabledReason);
  summarizer = new AgentASummarizer({ cwd: project, model: modelA, thinking: 'low' });
  const manager = SessionManager.inMemory(cwd);
  manager.appendMessage({ role: 'user', content: 'Retain the verification objective. Tools write only within this temporary workspace.', timestamp: 1 });
  for (let index=0; index<20; index++) manager.appendMessage({ role: 'user', content: 'Earlier verified context. '.repeat(600), timestamp: 1 });
  binding = await createRoleRuntime({ role: 'B', cwd, sessionRoot: join(root, 'state'), sessionMode: 'memory', initialSessionManager: manager,
    localModel: local.model, modelOverride: canonicalB, thinkingOverride: resolveEffectiveThinkingB({}, config.config).value, summarizeCompaction: summarizer.summarize, summaryModel: () => modelA.id });
  const events = []; const calls = []; const budgets = [];
  binding.session.subscribeCompaction(event => events.push(event.type));
  binding.session.subscribe(event => {
    if (event.type === 'message_end' && event.message.role === 'assistant' && event.message.stopReason !== 'error' && event.message.stopReason !== 'aborted') {
      const admitted = binding.session.requestBudget;
      assert(admitted, 'Missing actual payload admission');
      const actualInput = event.message.usage.input + event.message.usage.cacheRead + event.message.usage.cacheWrite;
      assert(actualInput <= admitted.inputTokens + 4096, 'Template/tokenizer parity exceeds safety margin');
      assert(actualInput + admitted.outputTokens <= admitted.contextWindow, 'Actual prompt/output budget exceeds window');
      budgets.push({ admittedInput: admitted.inputTokens, actualInput, outputAllowance: admitted.outputTokens });
    }
    if (event.type === 'tool_execution_end') calls.push({ name: event.toolName, isError: event.isError }); });
  timer = setTimeout(() => { void binding.session.abort(); }, 180000);
  for (let round = 1; round <= 2; round++) {
    if (round === 2) for (let index=0; index<20; index++) manager.appendMessage({ role: 'user', content: 'Additional completed-context notes. '.repeat(500), timestamp: Date.now() });
    // Public manual compaction is performed inside ManagedSession's owned preflight when needed.
    await binding.session.prompt(renderHandoffMessage({ schemaVersion: 1, workflowId: 'verify-compaction', handoffId: `verify-${round}`, iteration: round,
      objective: `Create proof-${round}.txt containing exactly COMPACTION_OK_${round}.`, summary: 'Verify actual native tools after history compaction.',
      acceptanceCriteria: [`proof-${round}.txt contains COMPACTION_OK_${round}.`], relevantPaths: [`proof-${round}.txt`],
      executionPlan: [`Call write with path proof-${round}.txt and content COMPACTION_OK_${round}.`, `Call read on proof-${round}.txt to verify the actual bytes.`, 'Only then emit pi-completion.'],
      constraints: ['Use actual native tools; do not simulate tool markup.', 'Only write the requested proof file in this temporary workspace.'] }));
    assert.equal((await readFile(join(cwd, `proof-${round}.txt`), 'utf8')).trim(), `COMPACTION_OK_${round}`);
  }
  assert(events.filter(event => event === 'completed').length >= 2, 'Expected two persisted compactions');
  assert(calls.some(call => call.name === 'write' && !call.isError));
  assert(calls.some(call => call.name === 'read' && !call.isError));
  process.stdout.write(JSON.stringify({ outcome: 'passed', summarizer: canonicalA, executor: canonicalB, events, budgets, tools: calls, filesVerified: 2 })+'\n');
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : 'Compaction verification failed')+'\n');process.exitCode = 1;
} finally { clearTimeout(timer); await binding?.dispose(); await summarizer?.dispose(); process.chdir(original); await rm(root,{recursive:true,force:true}); }
