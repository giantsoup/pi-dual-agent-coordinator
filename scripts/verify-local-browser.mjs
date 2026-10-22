// Real Chrome + real Pi sessions, deterministic inference, disposable local app.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRoleRuntime } from '../dist/src/runtime/create-role-runtime.js';
import { fixtureResponse, fixtureToolResponse, fixtureChatResponse, fixtureChatToolResponse } from '../dist/src/security/fixture-provider.js';

const root = await mkdtemp(join(tmpdir(), 'pi-browser-proof-'));
const cwd = join(root, 'workspace'); await mkdir(cwd);
let blockedHits = 0;
const blocked = createServer((_req, res) => { blockedHits++; res.end('FORBIDDEN_ORIGIN'); });
await new Promise(resolve => blocked.listen(0, '127.0.0.1', resolve));
const blockedOrigin = `http://127.0.0.1:${blocked.address().port}`;
const received = [];
let uncertainSubmissions = 0;
const initialCookies = [];
let hangStarted = () => {}; let hangClosed = () => {};
const hanging = new Promise(resolve => { hangStarted = resolve; });
const disconnected = new Promise(resolve => { hangClosed = resolve; });
const handler = (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  if (req.url === '/hang') { res.on('close', hangClosed); hangStarted(); return; }
  if (req.url === '/?role=A' || req.url === '/?role=B') initialCookies.push({ path: req.url, cookie: req.headers.cookie });
  if (req.url === '/redirect') { res.writeHead(302, { Location: blockedOrigin }); res.end(); return; }
  if (req.url === '/submitted-uncertain') { uncertainSubmissions++; res.end(Array.from({ length: 2000 }, (_, index) => `<button>APPLICATION_WRITE_COMPLETED_${index}</button>`).join('')); return; }
  if (req.url === '/uncertain') { res.end('<form action="/submitted-uncertain"><button>Commit once</button></form>'); return; }
  if (req.url.startsWith('/submitted?')) received.push(req.url);
  res.setHeader('Content-Type', 'text/html');
  res.end(`<body style="color-scheme:dark;background:#161b22;color:white"><h1>LOCAL_PROJECT_BROWSER_OK</h1><form action="/submitted"><label>Evidence<input name="evidence"></label><button>Submit proof</button></form><img src="${blockedOrigin}/unapproved.png"><script>document.cookie='roleProof='+new URLSearchParams(location.search).get('role')</script></body>`);
};
execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(root, 'key.pem'), '-out', join(root, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
const secureApp = createSecureServer({ key: await readFile(join(root, 'key.pem')), cert: await readFile(join(root, 'cert.pem')) }, handler);
await new Promise(resolve => secureApp.listen(0, '127.0.0.1', resolve));
const origin = `https://127.0.0.1:${secureApp.address().port}`;
const app = createServer((_req, res) => { res.writeHead(302, { Location: `${origin}/?role=A` }); res.end(); });
await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
const httpOrigin = `http://127.0.0.1:${app.address().port}`;
try {
  for (const role of ['A', 'B']) {
    let calls = 0;
    const results = [];
    let snapshot;
    const binding = await createRoleRuntime({ role, cwd, agentDir: join(root, 'agent'), sessionRoot: join(root, role), sessionMode: 'memory',
      browser: { workspace: cwd, allowedOrigins: [httpOrigin, origin] },
      providerTestBackend: { cwd, modelIds: [], load: async () => 'dummy-local-browser-proof', request: async (_url, init) => {
        calls++;
        if (calls >= 3) {
          const body = String(init?.body);
          assert.ok(body.includes('Image evidence retained in the session archive'));
          assert.ok(body.includes('Do not claim visual verification'));
          assert.ok(!body.includes('"image_url"') && !body.includes('"input_image"'), 'Screenshot pixels escaped text-only replay');
        }
        const call = args => role === 'A' ? fixtureToolResponse('browser', args) : fixtureChatToolResponse('browser', args);
        if (calls === 1) return call({ action: 'navigate', url: role === 'A' ? httpOrigin : `${origin}/?role=${role}` });
        if (calls === 2) {
          snapshot = JSON.parse(results[0].result.content.find(c => c.type === 'text').text);
          assert.ok(snapshot.snapshot.includes('LOCAL_PROJECT_BROWSER_OK'));
          return call({ action: 'screenshot' });
        }
        if (calls === 3 && role === 'B') {
          const ref = /textbox[^\n]*\[ref=(e\d+)\]/.exec(snapshot.snapshot)?.[1];
          assert.ok(ref, snapshot.snapshot);
          return call({ action: 'type', ref, snapshotId: snapshot.snapshotId, text: 'B_NATIVE_BROWSER_PROOF' });
        }
        if (calls === 4 && role === 'B') {
          snapshot = JSON.parse(results.at(-1).result.content.find(c => c.type === 'text').text);
          const ref = /button[^\n]*\[ref=(e\d+)\]/.exec(snapshot.snapshot)?.[1]; assert.ok(ref, snapshot.snapshot);
          return call({ action: 'click', ref, snapshotId: snapshot.snapshotId });
        }
        return role === 'A' ? fixtureResponse('Local browser verified') : fixtureChatResponse('Local browser verified');
      } }
    });
    binding.session.subscribe(event => { if (event.type === 'tool_execution_end') results.push(event); });
    try {
      await binding.session.prompt('Verify the disposable local project in your own browser.');
      for (const result of results) assert.equal(result.isError, false, JSON.stringify(result.result));
      const screenshot = results[1].result.content.find(c => c.type === 'image' && c.mimeType === 'image/jpeg');
      assert.ok(screenshot);
      assert.ok(binding.session.messages.some(message => message.role === 'toolResult' && message.content.some(part => part.type === 'image' && part.data === screenshot.data)), 'Original screenshot was not archived');
      if (process.env.PI_BROWSER_EVIDENCE_DIR) { await mkdir(process.env.PI_BROWSER_EVIDENCE_DIR, { recursive: true }); await writeFile(join(process.env.PI_BROWSER_EVIDENCE_DIR, `agent-${role}.jpeg`), Buffer.from(screenshot.data, 'base64')); }
      if (role === 'A') {
        calls = 0; results.length = 0;
        await binding.runtime.newSession(); await binding.rebind();
        binding.session.subscribe(event => { if (event.type === 'tool_execution_end') results.push(event); });
        await binding.session.prompt('Verify the fresh session also opens its project browser.');
        for (const result of results) assert.equal(result.isError, false, JSON.stringify(result.result));
      }
      console.log(JSON.stringify({ role, nativeBrowserResults: results.length, screenshot: true, realChrome: true, localHTTPS: true, inference: 'fixture', outcome: 'passed' }));
    } finally { await binding.dispose(); }
  }
  const uncertainResults = []; let uncertainCalls = 0;
  const uncertain = await createRoleRuntime({ role: 'B', cwd, agentDir: join(root, 'agent'), sessionRoot: join(root, 'uncertain'), sessionMode: 'memory', browser: { workspace: cwd, allowedOrigins: [origin] }, providerTestBackend: { cwd, modelIds: [], load: async () => 'dummy-uncertain-proof', request: async () => {
    if (++uncertainCalls === 1) return fixtureChatToolResponse('browser', { action: 'navigate', url: `${origin}/uncertain` });
    if (uncertainCalls === 2) { const snapshot = JSON.parse(uncertainResults[0].result.content.find(c => c.type === 'text').text); const ref = /button[^\n]*\[ref=(e\d+)\]/.exec(snapshot.snapshot)?.[1]; assert.ok(ref); return fixtureChatToolResponse('browser', { action: 'click', ref, snapshotId: snapshot.snapshotId }); }
    return fixtureChatResponse('Inspect application state before repeating the uncertain action.');
  } } });
  uncertain.session.subscribe(event => { if (event.type === 'tool_execution_end') uncertainResults.push(event); });
  try {
    await uncertain.session.prompt('Exercise the uncertain-outcome fixture exactly once.');
    assert.equal(uncertainSubmissions, 1, JSON.stringify(uncertainResults));
    assert.equal(uncertainResults[1].isError, true);
    assert.match(JSON.stringify(uncertainResults[1].result), /outcome is uncertain/);
    console.log(JSON.stringify({ completedWriteSnapshotFailure: 'uncertain', submissions: uncertainSubmissions, replayed: false }));
  } finally { await uncertain.dispose(); }
  const cancellation = await createRoleRuntime({ role: 'A', cwd, agentDir: join(root, 'agent'), sessionRoot: join(root, 'cancel'), sessionMode: 'memory', browser: { workspace: cwd, allowedOrigins: [origin] }, providerTestBackend: { cwd, modelIds: [], load: async () => 'dummy-cancel-proof', request: async () => fixtureToolResponse('browser', { action: 'navigate', url: `${origin}/hang` }) } });
  try {
    const prompt = cancellation.session.prompt('Open the slow local fixture.').then(
      () => ({ status: 'fulfilled' }), error => ({ status: 'rejected', error }));
    await Promise.race([hanging, new Promise((_resolve, reject) => { const timer = setTimeout(() => reject(new Error('Slow browser did not reach fixture')), 20_000); timer.unref(); })]);
    await cancellation.session.abort();
    const settled = await prompt;
    if (settled.status === 'rejected') assert.ok(settled.error instanceof Error && settled.error.name === 'AbortError', 'Browser cancellation failed for an unexpected reason');
    await disconnected;
  } finally { await cancellation.dispose(); }
  assert.ok(initialCookies.length >= 3);
  for (const request of initialCookies) assert.equal(request.cookie, undefined, 'New role/session reused another browser cookie');
  console.log(JSON.stringify({ cancellationDrained: true, newSessionReset: true, roleCookiesIsolated: true }));
  assert.equal(blockedHits, 0, 'Unapproved subresource reached its server');
  assert.deepEqual(received, ['/submitted?evidence=B_NATIVE_BROWSER_PROOF']);
} finally {
  await new Promise(resolve => app.close(resolve));
  await new Promise(resolve => secureApp.close(resolve));
  await new Promise(resolve => blocked.close(resolve));
  await rm(root, { recursive: true, force: true });
}
