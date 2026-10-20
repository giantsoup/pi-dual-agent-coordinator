import assert from 'node:assert/strict';
import { localTokenCounter } from '../dist/src/security/local-token-counter.js';
import { assertLmStudioModelReady } from '../dist/src/security/lm-studio.js';
import { assertRequestBudget } from '../dist/src/runtime/context-budget.js';
import { loadCoordinatorConfig, resolveEffectiveModelB } from '../dist/src/app/coordinator-config.js';
import { EXECUTION_MODEL } from '../dist/src/security/models.js';
import { LmStudioModels } from '../dist/src/security/lm-studio.js';
const loaded = await loadCoordinatorConfig();
assert.equal(loaded.warnings.length, 0);
const chosen = resolveEffectiveModelB({}, loaded.config).value ?? EXECUTION_MODEL;
const selected = (await new LmStudioModels().listModels()).find(item => chosen === `lm-studio/${item.model.id}` || chosen === item.model.id);
assert(selected?.loaded && !selected.disabledReason, 'Saved executor must already be loaded; this verifier does not load models.');
const model = selected.model;
const count = localTokenCounter(() => assertLmStudioModelReady(model));
const tools = [{ type: 'function', function: { name: 'read', description: 'Read a file.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } }];
const cases = [
  [{ role: 'user', content: [{ type: 'text', text: 'Unicode 界 😀 and code const result = 42;' }] }],
  [{ role: 'user', content: 'Read result.txt' }, { role: 'assistant', content: null, tool_calls: [{ id: 'one', type: 'function', function: { name: 'read', arguments: '{"path":"result.txt"}' } }] }, { role: 'tool', tool_call_id: 'one', content: 'Verified content.' }]
];
const counts = [];
for (const messages of cases) {
  const payload = { model: model.id, messages, tools, max_tokens: 16384 };
  const counted = await count(payload, AbortSignal.timeout(15000));
  counts.push(assertRequestBudget(model, payload, counted).inputTokens);
  assert(counted.tokens > 0);
}
const large = { model: model.id, max_tokens: 16384, messages: [{ role: 'user', content: 'x '.repeat(50000) }], tools };
const counted = await count(large, AbortSignal.timeout(15000));
assert.throws(() => assertRequestBudget(model, large, counted), /Context budget exceeded/);
process.stdout.write(JSON.stringify({ outcome: 'passed', model: model.id, countingMethod: 'lm-studio-template-tokenizer', counts, refusedInputTokens: counted.tokens, inferenceRequests: 0 })+'\n');
