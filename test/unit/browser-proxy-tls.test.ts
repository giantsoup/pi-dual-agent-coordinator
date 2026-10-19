import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:https";
import { request } from "node:http";
import { connect } from "node:tls";
import { connect as connectTcp } from "node:net";
import { expect, it } from "vitest";
import { startLocalBrowserProxy } from "../../src/browser/proxy.js";

it("terminates local TLS and rejects a different decrypted host even when both origins are granted", async () => {
  const directory = mkdtempSync("/tmp/pi-browser-tls-test-");
  execFileSync("/usr/bin/openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", `${directory}/key`, "-out", `${directory}/cert`, "-days", "1", "-subj", "/CN=localhost"], { stdio: "ignore" });
  const hosts: string[] = [];
  const app = createServer({ key: readFileSync(`${directory}/key`), cert: readFileSync(`${directory}/cert`) }, (req, res) => { hosts.push(req.headers.host ?? ""); res.end("LOCAL_TLS_OK"); });
  await new Promise<void>(resolve => app.listen(0, "127.0.0.1", resolve));
  const address = app.address(); if (!address || typeof address === "string") throw new Error("Expected TCP fixture");
  const origin = `https://127.0.0.1:${address.port}`, alternate = `https://localhost:${address.port}`;
  const proxy = await startLocalBrowserProxy({ workspace: "/fixture", allowedOrigins: [origin, alternate] });
  async function exchange(host: string, target = "/", authorized = true, authority = new URL(origin).host, servername?: string, upgrade = false): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = request(proxy.server, { method: "CONNECT", path: authority, headers: authorized ? { "Proxy-Authorization": `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64")}` } : {} });
      req.on("error", reject);
      req.on("connect", (response, socket) => {
        if (response.statusCode !== 200) { socket.destroy(); resolve(String(response.statusCode)); return; }
        const secure = connect({ socket, rejectUnauthorized: false, ...(servername ? { servername } : {}) }, () => secure.write(`GET ${target} HTTP/1.1\r\nHost: ${host}\r\nConnection: ${upgrade ? "Upgrade" : "close"}\r\n${upgrade ? "Upgrade: websocket\r\n" : ""}\r\n`));
        let text = ""; secure.on("data", data => { text += String(data); }); secure.on("error", error => servername ? resolve("TLS_REJECTED") : reject(error)); secure.on("close", () => resolve(text));
      }); req.end();
    });
  }
  try {
    expect(await exchange(new URL(origin).host, "/", false)).toBe("407");
    expect(await exchange(new URL(origin).host, "/", true, "example.com:443")).toBe("403");
    expect(await exchange(new URL(origin).host)).toContain("LOCAL_TLS_OK");
    expect(await exchange(new URL(alternate).host)).toContain("403 Forbidden");
    expect(await exchange(new URL(origin).host, `${alternate}/other`)).toContain("403 Forbidden");
    expect(await exchange(new URL(origin).host, "https://example.com/other")).toContain("403 Forbidden");
    expect(await exchange("", "/")).toContain("403 Forbidden");
    expect(["", "TLS_REJECTED"]).toContain(await exchange(new URL(origin).host, "/", true, new URL(origin).host, "unapproved.test"));
    expect(await exchange(new URL(origin).host, "/", true, new URL(origin).host, undefined, true)).toContain("403 Forbidden");
    const stalled = connectTcp(new URL(proxy.server).port ? Number(new URL(proxy.server).port) : 80, "127.0.0.1");
    const disconnected = new Promise<void>(resolve => stalled.once("close", () => resolve()));
    stalled.on("error", () => undefined);
    await new Promise<void>(resolve => stalled.once("connect", () => resolve()));
    stalled.write(`CONNECT ${new URL(origin).host} HTTP/1.1\r\nHost: ${new URL(origin).host}\r\nProxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64")}\r\n\r\n`);
    await new Promise<void>(resolve => stalled.once("data", () => resolve()));
    await proxy.close(); await disconnected;
    expect(hosts).toEqual([new URL(origin).host]);
  } finally {
    await proxy.close(); await new Promise<void>(resolve => app.close(() => resolve())); rmSync(directory, { recursive: true, force: true });
  }
});
