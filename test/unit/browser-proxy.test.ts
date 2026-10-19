import { createServer, request } from "node:http";
import { afterEach, expect, it } from "vitest";
import { isLoopbackAddress, startLocalBrowserProxy } from "../../src/browser/proxy.js";
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
it("requires private proxy authentication, pins the approved origin, and rejects other destinations", async () => {
  let host: string | undefined;
  const app = createServer((req, res) => { host = req.headers.host; res.end("APP_OK"); });
  await new Promise<void>(resolve => app.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>(resolve => app.close(() => resolve())));
  const address = app.address(); if (!address || typeof address === "string") throw new Error("Expected TCP fixture");
  const origin = `http://127.0.0.1:${address.port}`;
  const proxy = await startLocalBrowserProxy({ workspace: "/fixture", allowedOrigins: [origin] }); cleanup.push(() => proxy.close());
  const auth = `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64")}`;
  async function get(url: string, authorized: boolean) {
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request(proxy.server, { path: url, headers: { Host: "untrusted.example", ...(authorized ? { "Proxy-Authorization": auth } : {}) } }, response => {
        let body = ""; response.setEncoding("utf8"); response.on("data", chunk => { body += chunk; }); response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
      }); req.on("error", reject); req.end();
    });
  }
  expect(await get(origin, false)).toMatchObject({ status: 407 });
  expect(await get(origin, true)).toEqual({ status: 200, body: "APP_OK" });
  expect(host).toBe(new URL(origin).host);
  for (const url of ["http://example.com", "http://127.0.0.1:1234", "https://127.0.0.1", `http://user:password@127.0.0.1:${address.port}`]) expect(await get(url, true)).toMatchObject({ status: 403 });
});
it("allows only loopback DNS answers", async () => {
  for (const address of ["127.0.0.1", "127.0.0.2", "::1"]) expect(isLoopbackAddress(address)).toBe(true);
  for (const address of ["127.999.0.1", "0.0.0.0", "10.0.0.1", "169.254.169.254", "192.168.1.1", "8.8.8.8", "::ffff:127.0.0.1"]) expect(isLoopbackAddress(address)).toBe(false);
  await expect(startLocalBrowserProxy({ workspace: "/fixture", allowedOrigins: ["http://8.8.8.8"] })).rejects.toThrow("loopback");
});
it("revokes an upstream response before proxy close settles", async () => {
  let resolveStarted: () => void = () => undefined;
  let resolveClosed: () => void = () => undefined;
  const started = new Promise<void>(resolve => { resolveStarted = resolve; });
  const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
  const app = createServer((_req, response) => { response.on("close", resolveClosed); resolveStarted(); });
  await new Promise<void>(resolve => app.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>(resolve => app.close(() => resolve())));
  const address = app.address(); if (!address || typeof address === "string") throw new Error("Expected TCP fixture");
  const origin = `http://127.0.0.1:${address.port}`;
  const proxy = await startLocalBrowserProxy({ workspace: "/fixture", allowedOrigins: [origin] }); cleanup.push(() => proxy.close());
  const req = request(proxy.server, { path: origin, headers: { "Proxy-Authorization": `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64")}` } });
  req.on("error", () => undefined); req.end();
  await started;
  await proxy.close();
  await closed;
});
