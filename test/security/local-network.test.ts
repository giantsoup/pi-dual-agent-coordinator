import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ToolIsolation } from "../../src/security/isolation.js";
import { protectedLocalPorts, providerBrokerPorts } from "../../src/security/local-network.js";
import { createProviderBroker } from "../../src/security/provider-broker.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function probe(role: "A" | "B", network: "none" | "project", source: string): string {
  const cwd = mkdtempSync(join(tmpdir(), "pi-local-network-")); roots.push(cwd);
  const isolation = new ToolIsolation(cwd, role, undefined, network);
  try {
    const launch = isolation.command(process.execPath, ["--input-type=module", "-e", source]);
    const result = spawnSync(launch.command, launch.args, { cwd: launch.cwd, env: launch.env, encoding: "utf8", timeout: 5_000 });
    expect(result.status, result.stderr || String(result.error)).toBe(0);
    return result.stdout.trim();
  } finally { isolation.dispose(); }
}

it("Agent B serves and requests HTTP over IPv4 and IPv6 loopback", () => {
  expect(probe("B", "project", `
    import assert from 'node:assert/strict';
    import { createServer, get } from 'node:http';
    import { execFile } from 'node:child_process';
    for (const host of ['127.0.0.1', '::1']) {
      const server = createServer((_req, res) => res.end('PROJECT_OK'));
      try {
        // The OS can choose a reserved broker port; retry ephemeral allocation.
        for (let attempt = 0; ; attempt++) {
          try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, host, resolve); }); break; }
          catch (error) { if (error.code !== 'EPERM' || attempt === 4) throw error; }
        }
        const body = await new Promise((resolve, reject) => {
          get({ host, port: server.address().port }, res => { let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve(body)); }).on('error', reject);
        });
        assert.equal(body, 'PROJECT_OK');
        const url = 'http://' + (host === '::1' ? '[::1]' : host) + ':' + server.address().port;
        await new Promise((resolve, reject) => execFile('/usr/bin/curl', ['--noproxy', '*', '--max-time', '2', '--fail', '--silent', url], (error, stdout) => {
          try { assert.ifError(error); assert.equal(stdout, 'PROJECT_OK'); resolve(); } catch (failure) { reject(failure); }
        }));
      } finally { await new Promise(resolve => server.close(resolve)); }
    }
    console.log('LOOPBACK_HTTP_OK');
  `)).toBe("LOOPBACK_HTTP_OK");
});

it.each(["A", "B"] as const)("keeps Agent %s's default sandbox network-denied", role => {
  expect(probe(role, "none", `
    import { createServer } from 'node:net';
    const server = createServer();
    server.on('error', error => { if (error.code !== 'EPERM') throw error; console.log('DENIED'); });
    server.listen(0, '127.0.0.1', () => { server.close(); process.exitCode = 1; });
  `)).toBe("DENIED");
});

it("does not grant Agent A network access when project networking is requested", () => {
  expect(probe("A", "project", `
    import { connect } from 'node:net';
    const socket = connect(4173, '127.0.0.1');
    socket.on('error', error => { if (error.code !== 'EPERM') throw error; console.log('DENIED'); });
  `)).toBe("DENIED");
});

it("denies public/LAN TCP, UDP, and protected ports in B and its descendants", () => {
  const source = `
    import assert from 'node:assert/strict';
    import { connect, createServer } from 'node:net';
    import { createSocket } from 'node:dgram';
    assert.throws(() => process.kill(${process.pid}, 0), { code: 'EPERM' });
    const targets = [['192.0.2.1', 80], ['10.255.255.254', 80], ['2001:db8::1', 80], ['::ffff:192.0.2.1', 80],
      ...${JSON.stringify(protectedLocalPorts)}.flatMap(port => [['127.0.0.1', port], ['::1', port], ['::ffff:127.0.0.1', port]])];
    for (const [host, port] of targets) await new Promise((resolve, reject) => {
      const socket = connect({ host, port });
      socket.setTimeout(500, () => { socket.destroy(); reject(new Error('Socket was not denied: ' + host + ':' + port)); });
      socket.on('connect', () => { socket.destroy(); reject(new Error('Forbidden connection succeeded')); });
      socket.on('error', error => { try { assert.equal(error.code, 'EPERM', host + ':' + port); resolve(); } catch (failure) { reject(failure); } });
    });
    for (const port of ${JSON.stringify(protectedLocalPorts)}) await new Promise((resolve, reject) => {
      const server = createServer();
      server.on('error', error => { try { assert.equal(error.code, 'EPERM'); resolve(); } catch (failure) { reject(failure); } });
      server.listen(port, '127.0.0.1', () => server.close(() => reject(new Error('Protected port bind succeeded'))));
    });
    const udp = createSocket('udp4');
    try { await new Promise(resolve => {
      const denied = error => { assert.equal(error?.code, 'EPERM'); resolve(); };
      udp.once('error', denied);
      udp.send('dummy', 4173, '127.0.0.1', denied);
    }); }
    finally { udp.close(); }
    console.log('EGRESS_DENIED');
  `;
  expect(probe("B", "project", source)).toBe("EGRESS_DENIED");
  expect(probe("B", "project", `
    import { execFileSync } from 'node:child_process';
    process.stdout.write(execFileSync(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(source)}]));
  `)).toBe("EGRESS_DENIED");
});

it("reserves all concurrent cloud/local brokers outside project tool access", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-local-brokers-")); roots.push(cwd);
  const brokers: Awaited<ReturnType<typeof createProviderBroker>>[] = [];
  try {
    for (const provider of ["openai", "lm-studio", "openai"] as const) {
      brokers.push(await createProviderBroker({ cwd, provider, modelIds: [], load: async () => "dummy-broker-network" }));
    }
    const ports = brokers.map(broker => Number(new URL(broker.baseUrl).port));
    expect(new Set(ports).size).toBe(brokers.length);
    for (const port of ports) expect(providerBrokerPorts).toContain(port);
    for (const broker of brokers) expect((await fetch(`${broker.baseUrl}/responses`, { method: "POST" })).status).toBe(403);
  } finally { await Promise.all(brokers.map(broker => broker.close())); }
});
