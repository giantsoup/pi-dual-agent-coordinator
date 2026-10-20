// Real Pi + sandboxed B bash + separate Chrome, with deterministic inference.
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { createServer } from 'node:net';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRoleRuntime } from '../dist/src/runtime/create-role-runtime.js';
import { fixtureChatResponse, fixtureChatToolResponse } from '../dist/src/security/fixture-provider.js';

const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const root = await mkdtemp(join(tmpdir(), 'pi-local-server-proof-'));
const cwd = join(root, 'workspace');
const app = join(cwd, 'app');
await mkdir(app, { recursive: true });
let binding;
let serverId;
try {
  if (process.argv[2]) await cp(resolve(process.argv[2]), app, { recursive: true });
  else await writeFile(join(app, 'index.html'), '<h1>LOCAL_SERVER_PROJECT_OK</h1><label>Value<input type="number" value="1"></label>');
  const page = await readFile(join(app, 'index.html'), 'utf8');
  const expectedHeading = /<h1[^>]*>([^<]+)<\/h1>/i.exec(page)?.[1];
  assert.ok(expectedHeading, 'Proof page requires a heading');
  let port;
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = randomInt(20000, 45000);
    const available = createServer();
    try {
      await new Promise((resolve, reject) => { available.once('error', reject); available.listen(candidate, '127.0.0.1', resolve); });
      await new Promise(resolve => available.close(resolve));
      port = candidate; break;
    } catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
  }
  assert.ok(port, 'No disposable project port available');
  const origin = `http://127.0.0.1:${port}`;
  await writeFile(join(cwd, 'server.mjs'), `
    import { createServer } from 'node:http';
    import { readFile } from 'node:fs/promises';
    import { resolve, extname, sep } from 'node:path';
    const root = resolve('app');
    const server = createServer(async (req, res) => {
      try {
        const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/\\/$/, '/index.html'));
        if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };
        const bytes = await readFile(path);
        res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }).end(bytes);
      } catch { res.writeHead(404).end(); }
    });
    server.listen(${port}, '127.0.0.1', () => console.log('PROJECT_SERVER_READY'));
    setTimeout(() => { server.closeAllConnections(); server.close(); }, 45000).unref();
  `);
  let calls = 0;
  const results = [];
  binding = await createRoleRuntime({ role: 'B', cwd, agentDir: join(root, 'agent'), sessionRoot: join(root, 'state'), sessionMode: 'memory',
    browser: { workspace: cwd, allowedOrigins: [origin] },
    providerTestBackend: { cwd, modelIds: [], load: async () => 'dummy-local-server-proof', request: async () => {
      switch (++calls) {
        case 1: return fixtureChatToolResponse('local_server', { action: 'start', command: `${quote(process.execPath)} server.mjs` });
        case 2: return fixtureChatToolResponse('bash', { command: `${quote(process.execPath)} --input-type=module -e ${quote(`
          import assert from 'node:assert/strict';
          for(let attempt=0; ; attempt++) {
            try { const response = await fetch(${JSON.stringify(origin)}); assert.equal(response.status,200); assert.ok((await response.text()).includes(${JSON.stringify(expectedHeading)})); break; }
            catch(error) { if(attempt===30) throw error; await new Promise(resolve=>setTimeout(resolve,100)); }
          }
          console.log('B_HTTP_REQUEST_OK');
        `)}` });
        case 3: return fixtureChatToolResponse('browser', { action: 'navigate', url: origin });
        case 4: return fixtureChatToolResponse('browser', { action: 'screenshot' });
        case 5: {
          serverId = JSON.parse(results[0].result.content.find(item => item.type === 'text').text).serverId;
          return fixtureChatToolResponse('local_server', { action: 'stop', serverId });
        }
        default: return fixtureChatResponse('Local server started, requested, opened in Chrome, and stopped.');
      }
    } }
  });
  binding.session.subscribe(event => { if (event.type === 'tool_execution_end') results.push(event); });
  await binding.session.prompt('Start this local project, request it through bash, verify it in your browser, and stop it.');
  assert.equal(results.length, 5);
  for (const result of results) assert.equal(result.isError, false, JSON.stringify(result.result));
  assert.ok(JSON.stringify(results[1].result).includes('B_HTTP_REQUEST_OK'));
  assert.ok(JSON.stringify(results[2].result).includes(expectedHeading));
  const screenshot = results[3].result.content.find(item => item.type === 'image' && item.mimeType === 'image/jpeg');
  assert.ok(screenshot);
  if (process.env.PI_BROWSER_EVIDENCE_DIR) {
    await mkdir(process.env.PI_BROWSER_EVIDENCE_DIR, { recursive: true });
    await writeFile(join(process.env.PI_BROWSER_EVIDENCE_DIR, 'b-local-server.jpeg'), Buffer.from(screenshot.data, 'base64'));
  }
  await assert.rejects(fetch(origin), 'Agent B failed to stop its server');
  console.log(JSON.stringify({ outcome: 'passed', inference: 'fixture', realPi: true, serverStartedByB: true, httpRequestedByB: true,
    realChrome: true, heading: expectedHeading, screenshot: true, serverStoppedByB: true }));
} finally {
  await binding?.dispose();
  await rm(root, { recursive: true, force: true });
}
