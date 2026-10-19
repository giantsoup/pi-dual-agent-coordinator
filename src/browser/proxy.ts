import { lookup } from "node:dns/promises";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { request as secureRequest } from "node:https";
import { createSecureContext, TLSSocket } from "node:tls";
import { randomBytes } from "node:crypto";
import { createServer, request, type ClientRequest, type IncomingHttpHeaders } from "node:http";
import { isIP, type Socket } from "node:net";
import type { BrowserConfiguration } from "./policy.js";

const limit = 8 * 1024 * 1024;
export function isLoopbackAddress(address: string): boolean {
  return address === "::1" || isIP(address) === 4 && address.startsWith("127.");
}

function headersWithoutProxy(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const blocked = new Set(["connection", "proxy-connection", "proxy-authorization", "proxy-authenticate", "transfer-encoding", "upgrade", "keep-alive", "te", "trailer"]);
  for (const name of headers.connection?.split(",") ?? []) blocked.add(name.trim().toLowerCase());
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !blocked.has(name)));
}

export async function startLocalBrowserProxy(config: BrowserConfiguration) {
  const grants = new Map<string, { address: string; family: number }>();
  const deadline = Date.now() + 5_000;
  for (const origin of config.allowedOrigins) {
    const hostname = new URL(origin).hostname.replace(/^\[|\]$/g, "");
    const addresses = await Promise.race([lookup(hostname, { all: true }), new Promise<never>((_resolve, reject) => { const timer = setTimeout(() => reject(new Error("Project DNS lookup timed out.")), Math.max(1, deadline - Date.now())); timer.unref(); })]);
    if (!addresses.length || addresses.some(item => !isLoopbackAddress(item.address))) {
      throw new Error("Browser project DNS must resolve exclusively to loopback addresses.");
    }
    const address = addresses.find(item => item.family === 4) ?? addresses[0];
    if (!address) throw new Error("Local browser origin has no address.");
    grants.set(origin, address);
  }
  const username = "pi-browser";
  const password = randomBytes(24).toString("hex");
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const sockets = new Set<Socket>();
  const secureOrigins = new WeakMap<Socket, string>();
  // Terminate local TLS here so encrypted traffic cannot tunnel to another virtual host.
  let secureContext: ReturnType<typeof createSecureContext> | undefined;
  if (config.allowedOrigins.some(origin => origin.startsWith("https:"))) {
    const directory = mkdtempSync("/tmp/pi-browser-tls-");
    try {
      const configuration = join(directory, "openssl.cnf");
      writeFileSync(configuration, "[req]\ndistinguished_name=dn\nprompt=no\ndefault_md=sha256\n[dn]\nCN=pi-local-project-browser\n", { mode: 0o600 });
      execFileSync("/usr/bin/openssl", ["req", "-config", configuration, "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(directory, "key.pem"), "-out", join(directory, "cert.pem"), "-days", "1", "-subj", "/CN=pi-local-project-browser"], { stdio: "ignore", timeout: 10_000, env: { PATH: "/usr/bin:/bin", HOME: directory, TMPDIR: directory, LANG: "C", OPENSSL_CONF: configuration } });
      secureContext = createSecureContext({ key: readFileSync(join(directory, "key.pem")), cert: readFileSync(join(directory, "cert.pem")) });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
  const requests = new Set<ClientRequest>();
  const server = createServer({ maxHeaderSize: 16 * 1024, requestTimeout: 15_000, headersTimeout: 5_000 }, (incoming, response) => {
    const secureOrigin = secureOrigins.get(incoming.socket);
    if (!secureOrigin && incoming.headers["proxy-authorization"] !== authorization) {
      response.writeHead(407, { "Proxy-Authenticate": "Basic realm=pi-browser" }).end(); return;
    }
    let url: URL;
    try { url = secureOrigin ? new URL(incoming.url ?? "", secureOrigin) : new URL(incoming.url ?? ""); }
    catch { response.writeHead(400).end(); return; }
    const grant = grants.get(url.origin);
    if (!grant || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash
      || secureOrigin && (url.origin !== secureOrigin || incoming.headers.host !== new URL(secureOrigin).host)) {
      response.writeHead(403).end("Browser origin is outside this project's local project grant."); return;
    }
    const headers = headersWithoutProxy(incoming.headers);
    headers.host = url.host;
    const servername = url.hostname.replace(/^\[|\]$/g, "");
    const upstreamRequest = url.protocol === "https:" ? secureRequest : request;
    const upstream = upstreamRequest(url, { hostname: grant.address, family: grant.family, headers, method: incoming.method, agent: false, timeout: 15_000,
      // This capability is explicitly for local development servers, including Herd's private CA.
      ...(url.protocol === "https:" ? { ...(isIP(servername) ? {} : { servername }), rejectUnauthorized: false } : {}) }, reply => {
      response.writeHead(reply.statusCode ?? 502, headersWithoutProxy(reply.headers));
      let bytes = 0;
      reply.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > limit) { reply.destroy(); response.destroy(); } });
      reply.on("error", () => response.destroy());
      reply.pipe(response);
    });
    requests.add(upstream); upstream.on("close", () => requests.delete(upstream));
    response.on("close", () => upstream.destroy());
    let bytes = 0;
    incoming.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > limit) { incoming.destroy(); upstream.destroy(); } });
    incoming.on("aborted", () => upstream.destroy());
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", () => { if (!response.headersSent) response.writeHead(502).end("Local project is unavailable."); else response.destroy(); });
    incoming.pipe(upstream);
  });
  server.on("connect", (incoming, socket, head) => {
    let origin: string;
    try { origin = new URL(`https://${incoming.url ?? ""}`).origin; }
    catch { socket.destroy(); return; }
    if (incoming.headers["proxy-authorization"] !== authorization) {
      socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="pi-browser"\r\nConnection: close\r\n\r\n'); return;
    }
    if (!grants.has(origin) || !secureContext || incoming.url !== new URL(origin).host + (new URL(origin).port ? "" : ":443")) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return;
    }
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) socket.unshift(head);
    const secure = new TLSSocket(socket, { isServer: true, secureContext, ALPNProtocols: ["http/1.1"] });
    secure.setTimeout(15_000, () => secure.destroy());
    secure.on("error", () => secure.destroy());
    secure.once("secure", () => {
      if (secure.servername && secure.servername !== new URL(origin).hostname) { secure.destroy(); return; }
      secureOrigins.set(secure, origin);
      server.emit("connection", secure);
    });
  });
  server.on("upgrade", (_request, socket) => socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"));
  server.on("connection", socket => {
    if (sockets.size >= 32) { socket.destroy(); return; }
    sockets.add(socket); socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Browser proxy did not bind a local TCP port.");
  let closing: Promise<void> | undefined;
  return {
    port: address.port, server: `http://127.0.0.1:${address.port}`, username, password,
    close(): Promise<void> {
      return closing ??= new Promise<void>((resolve, reject) => {
        for (const upstream of requests) upstream.destroy();
        for (const socket of sockets) socket.destroy();
        server.close(error => error ? reject(error) : resolve());
      });
    }
  };
}
