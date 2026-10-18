// Live local-only switch/readiness/inference proof; restores the previously loaded model.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LmStudioModels, assertLmStudioModelReady } from '../dist/src/security/lm-studio.js';
import { createRoleRuntime } from '../dist/src/runtime/create-role-runtime.js';

const host = new LmStudioModels();
const models = await host.listModels();
const loaded = models.filter(item => item.loaded);
assert.equal(loaded.length, 1, 'Verification needs exactly one currently loaded model to restore.');
const previous = loaded[0];
const target = models.find(item => item.model.id === (process.argv[2] ?? 'google/gemma-4-e4b'));
assert.ok(previous && target && !target.disabledReason && target.model.id !== previous.model.id, 'Choose a different downloaded, tool-capable model.');
const root = await mkdtemp(join(tmpdir(), 'pi-picker-live-'));
const cwd = join(root, 'workspace'); await mkdir(cwd);
const originalCwd = process.cwd();
let prepared;
let binding;
let timer;
const phases = [];
try {
  prepared = await host.prepare(target.model.id, previous.model.id, new AbortController().signal, progress => {
    phases.push(progress.phase); process.stdout.write(`${progress.phase}: ${progress.message}\n`);
  });
  assert.ok(!(await host.listModels()).find(item => item.model.id === previous.model.id)?.loaded, 'Previous model unloaded before selection is ready.');
  const alias = await assertLmStudioModelReady(prepared.model);
  binding = await createRoleRuntime({ role: 'B', cwd, sessionRoot: join(root, 'state'), sessionMode: 'memory',
    modelOverride: `lm-studio/${target.model.id}`, localModel: prepared.model, noTools: true });
  timer = setTimeout(() => { void binding.session.abort(); }, 45_000);
  await binding.session.prompt('Reply with exactly MODEL_SWITCH_READY. Do not explain.');
  const last = binding.session.messages.at(-1);
  assert.equal(last?.role, 'assistant'); assert.equal(last.stopReason, 'stop');
  assert.ok(JSON.stringify(last).includes('MODEL_SWITCH_READY'), 'Real local inference succeeded after the switch.');
  process.stdout.write(`${JSON.stringify({ outcome: 'passed', selected: target.model.id, verifiedInstance: alias, phases, localInference: true })}\n`);
} finally {
  clearTimeout(timer);
  try { await binding?.dispose(); }
  finally {
    try { await prepared?.rollback(); await assertLmStudioModelReady(previous.model); process.stdout.write(`Restored ${previous.model.id} with 65536 context.\n`); }
    finally { process.chdir(originalCwd); await rm(root, { recursive: true, force: true }); }
  }
}
