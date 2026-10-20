import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRoleRuntime } from '../dist/src/runtime/create-role-runtime.js';
import { ManagedSession } from '../dist/src/runtime/managed-session.js';
import { LmStudioModels } from '../dist/src/security/lm-studio.js';
import { loadCoordinatorConfig, resolveEffectiveModelB, resolveEffectiveThinkingB } from '../dist/src/app/coordinator-config.js';
import { EXECUTION_MODEL } from '../dist/src/security/models.js';
import { renderHandoffMessage } from '../dist/src/handoff/render-handoff-message.js';

// Refuse workspace execution before constructing a credential-capable runtime.
await import('./verify-installation.mjs');
const root = await mkdtemp(join(tmpdir(), 'pi-live-stream-'));
const originalCwd = process.cwd();
let binding;
let timer;
const turns = [];
const tools = [];
let active;
let timedOut = false;
try {
  const cwd = join(root, 'workspace'); await mkdir(cwd);
  const loaded = await loadCoordinatorConfig();
  assert.equal(loaded.warnings.length, 0, 'Repair invalid coordinator defaults first');
  const model = resolveEffectiveModelB({}, loaded.config).value ?? EXECUTION_MODEL;
  const selected = (await new LmStudioModels().listModels()).find(item => model === item.model.id || model === `lm-studio/${item.model.id}`);
  assert(selected?.loaded && !selected.disabledReason, 'The saved executor must already be loaded; this verifier never loads models');
  binding = await createRoleRuntime({ role: 'B', cwd, modelOverride: model, localModel: selected.model,
    thinkingOverride: resolveEffectiveThinkingB({}, loaded.config).value, sessionRoot: join(root, 'state'), sessionMode: 'memory' });
  assert(binding.session instanceof ManagedSession);
  binding.session.piSession.setActiveToolsByName(['write', 'read']);
  binding.session.subscribe(event => {
    if (event.type === 'message_start' && event.message.role === 'assistant') active = { started: performance.now(), deltas: 0 };
    if (event.type === 'message_update' && active && event.assistantMessageEvent.type.endsWith('_delta')) active.deltas++;
    if (event.type === 'message_end' && event.message.role === 'assistant' && active) {
      turns.push({ elapsedMs: Math.round(performance.now() - active.started), deltas: active.deltas, stopReason: event.message.stopReason });
      active = undefined;
    }
    if (event.type === 'tool_execution_end') tools.push({ name: event.toolName, callId: event.toolCallId, isError: event.isError });
  });
  timer = setTimeout(() => { timedOut = true; void binding.session.abort(); }, 420_000);
  const count = 600;
  const expected = Array.from({ length: count }, (_, index) => `LINE ${String(index + 1).padStart(4, '0')}`).join('\n') + '\n';
  await binding.session.prompt(renderHandoffMessage({ schemaVersion: 1, workflowId: 'verify-long-stream', handoffId: 'verify-long-stream-1', iteration: 1,
    objective: `Write marker.txt containing exactly LOCAL_STREAM_OK, then write stream.txt with ${count} numbered lines.`,
    summary: 'Verify native writes and a long streamed tool call. Both files are new in a temporary workspace.',
    acceptanceCriteria: ['marker.txt contains exactly LOCAL_STREAM_OK.', `stream.txt contains exactly ${count} lines, LINE 0001 through LINE 0600, with one newline after every line.`],
    relevantPaths: ['marker.txt', 'stream.txt'],
    executionPlan: ['Call write for marker.txt with content LOCAL_STREAM_OK.',
      `Call write for stream.txt. Generate its entire content directly as the write content argument: ${count} consecutive lines from LINE 0001 to LINE 0600, no omissions, explanations, Markdown, or ellipses. Include a final newline.`,
      'Call read for marker.txt and stream.txt. Then emit pi-completion.'],
    constraints: ['Use only the provided native write and read tools. Do not simulate tool calls.', 'Write only these two files. Do not stop early or abbreviate the numbered content.'] }));
  assert.equal(timedOut, false, 'Live stream verification exceeded its seven-minute bound');
  assert.equal(await readFile(join(cwd, 'marker.txt'), 'utf8'), 'LOCAL_STREAM_OK');
  assert.equal(await readFile(join(cwd, 'stream.txt'), 'utf8'), expected);
  assert(tools.filter(tool => tool.name === 'write' && !tool.isError).length >= 2, 'Missing correlated native writes');
  assert(tools.some(tool => tool.name === 'read' && !tool.isError), 'Missing native verification read');
  assert(turns.some(turn => turn.elapsedMs > 120_000 && turn.deltas > 1 && turn.stopReason !== 'error' && turn.stopReason !== 'aborted'), 'No successful streamed response exceeded two minutes');
  const last = binding.session.messages.at(-1);
  assert(last?.role === 'assistant' && last.stopReason === 'stop', 'Live session did not finish successfully');
  process.stdout.write(JSON.stringify({ outcome: 'passed', model, thinking: binding.session.thinkingLevel, turns, tools, filesVerified: 2, linesVerified: count }) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({ outcome: 'failed', reason: error instanceof Error ? error.message.slice(0, 500) : 'Local stream verification failed', turns, tools }) + '\n');
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  await binding?.dispose();
  process.chdir(originalCwd);
  await rm(root, { recursive: true, force: true });
}
