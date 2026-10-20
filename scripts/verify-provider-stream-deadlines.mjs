import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createProviderBroker } from '../dist/src/security/provider-broker.js';

// Verify the compiled artifact with injected local SSE. No credentials or inference.
const originalSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (callback, milliseconds, ...args) => originalSetTimeout(callback,
  milliseconds === 120_000 || milliseconds === 1_800_000 ? milliseconds / 100 : milliseconds, ...args);
const checks = [];
try {
  for (const mode of ['active', 'idle', 'deadline']) {
    let source;
    let signal;
    let requests = 0;
    const encoder = new TextEncoder();
    const broker = await createProviderBroker({
      provider: 'lm-studio', cwd: '/unused-stream-verification', modelIds: ['fixture-local-model'],
      ...(mode === 'deadline' ? { timeoutMs: 250, idleTimeoutMs: 150 } : mode === 'idle' ? { idleTimeoutMs: 150 } : {}),
      load: async () => { throw new Error('Must not retrieve credentials'); },
      request: async (_url, init) => {
        requests++;
        signal = init.signal;
        return new Response(new ReadableStream({ start(controller) {
          source = controller;
          signal.addEventListener('abort', () => controller.error(new Error('private fixture failure')), { once: true });
          controller.enqueue(encoder.encode(': started\n\n'));
        } }));
      }
    });
    try {
      const response = await fetch(`${broker.baseUrl}/chat/completions`, { method: 'POST', signal: AbortSignal.timeout(5000),
        headers: { Authorization: `Bearer ${broker.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'fixture-local-model' }) });
      const result = response.text().then(text => ({ text }), error => ({ error: error.message }));
      if (mode === 'active') {
        for (let index = 0; index < 5; index++) {
          await delay(300);
          assert.equal(signal.aborted, false, 'Active response aborted at the former fixed deadline');
          source.enqueue(encoder.encode(': progress\n\n'));
        }
        source.enqueue(encoder.encode('data: [DONE]\n\n')); source.close();
      } else if (mode === 'deadline') {
        while (!signal.aborted) {
          await delay(40);
          if (!signal.aborted) source.enqueue(encoder.encode(': progress\n\n'));
        }
      }
      const outcome = await result;
      assert.ok('text' in outcome, 'Broker destroyed SSE instead of returning its safe error');
      assert.ok(outcome.text.includes(mode === 'active' ? '[DONE]' : mode === 'idle' ? 'response stalled' : 'request deadline'));
      assert.ok(!outcome.text.includes('private fixture failure'));
      assert.equal(requests, 1, 'Unexpected request replay');
      checks.push(mode);
    } finally { await broker.close(); }
  }
} finally { globalThis.setTimeout = originalSetTimeout; }
const brokerFile = fileURLToPath(new URL('../dist/src/security/provider-broker.js', import.meta.url));
process.stdout.write(JSON.stringify({ outcome: 'passed', checks, brokerSha256: createHash('sha256').update(readFileSync(brokerFile)).digest('hex') }) + '\n');
