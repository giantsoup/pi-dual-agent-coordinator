import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import type { FetchLike, Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export function createRemoteMcpTransport(endpoint: string): Transport {
  const sdk = new StreamableHTTPClientTransport(validateRemoteMcpUrl(endpoint), {
    fetch: createRemoteMcpFetch(endpoint),
    reconnectionOptions: { maxReconnectionDelay: 1000, initialReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1, maxRetries: 0 }
  });
  // SDK 1.32.1's optional sessionId getter is incompatible with exactOptionalPropertyTypes.
  // The SDK retains session ownership; forward the public transport contract.
  const transport: Transport = {
    start: () => sdk.start(), close: () => sdk.close(),
    send: (message, options) => sdk.send(message, options),
    setProtocolVersion: version => sdk.setProtocolVersion(version)
  };
  sdk.onclose = () => transport.onclose?.();
  sdk.onerror = error => transport.onerror?.(error);
  sdk.onmessage = message => transport.onmessage?.(message);
  return transport;
}

const denied = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3]
] satisfies Array<[string, number]>) denied.addSubnet(address, prefix, "ipv4");
const publicV6 = new BlockList();
publicV6.addSubnet("2000::", 3, "ipv6");
denied.addSubnet("2001::", 23, "ipv6");
denied.addSubnet("2001:db8::", 32, "ipv6");
denied.addSubnet("2002::", 16, "ipv6");
denied.addSubnet("3fff::", 20, "ipv6");

export function isPublicMcpAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !denied.check(address, "ipv4")
    : family === 6 && publicV6.check(address, "ipv6") && !denied.check(address, "ipv6");
}

export function validateRemoteMcpUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("Remote MCP requires a valid public HTTPS endpoint."); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search || (url.port && url.port !== "443")) {
    throw new Error("Remote MCP requires public HTTPS on port 443 without credentials, query, or fragment.");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || (isIP(hostname) && !isPublicMcpAddress(hostname))) {
    throw new Error("Remote MCP cannot access private, loopback, or reserved addresses.");
  }
  return url;
}

// No shared fetch, proxy, cookie jar, provider capability, or authentication state.
export function createRemoteMcpFetch(endpoint: string): FetchLike {
  const target = validateRemoteMcpUrl(endpoint);
  return async (input, init) => {
    const url = validateRemoteMcpUrl(String(input));
    if (url.href !== target.href) throw new Error("Remote MCP request left its configured endpoint.");
    const method = init?.method ?? "GET";
    if (!["GET", "POST", "DELETE"].includes(method)) throw new Error("Unsupported remote MCP method.");
    if (init?.body !== undefined && init.body !== null && typeof init.body !== "string") throw new Error("Remote MCP requires a JSON string body.");
    const body = typeof init?.body === "string" ? init.body : undefined;
    if (body && Buffer.byteLength(body) > 8 * 1024 * 1024) throw new Error("Remote MCP request exceeded the size limit.");
    const signal = AbortSignal.any([AbortSignal.timeout(60_000), ...(init?.signal ? [init.signal] : [])]);
    signal.throwIfAborted();
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await withAbort(lookup(hostname, { all: true }), signal);
    if (!addresses.length || addresses.some(item => !isPublicMcpAddress(item.address))) throw new Error("Remote MCP DNS resolved to a private or reserved address.");
    const address = addresses[0];
    if (!address) throw new Error("Remote MCP DNS returned no address.");
    const headers = new Headers(init?.headers);
    const permitted = new Set(["accept", "content-type", "mcp-session-id", "mcp-protocol-version", "last-event-id"]);
    for (const name of headers.keys()) if (!permitted.has(name)) throw new Error("Remote MCP authentication and custom headers are not supported.");
    const requestHeaders: Record<string, string> = Object.fromEntries(headers);
    requestHeaders.host = url.host;
    return new Promise<Response>((resolve, reject) => {
      const controller = new AbortController();
      const abort = () => controller.abort(new Error("Remote MCP request cancelled."));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      const cleanup = () => signal.removeEventListener("abort", abort);
      const req = request(url, {
        hostname: address.address, family: address.family, servername: hostname,
        method, headers: requestHeaders, signal: controller.signal, agent: false,
        rejectUnauthorized: true
      }, response => {
        const status = response.statusCode ?? 502;
        if (status >= 300 && status < 400) {
          response.destroy(); cleanup(); reject(new Error("Remote MCP redirects are forbidden.")); return;
        }
        const responseHeaders = new Headers();
        for (const name of ["content-type", "mcp-session-id", "mcp-protocol-version"]) {
          const value = response.headers[name];
          if (typeof value === "string") responseHeaders.set(name, value);
        }
        if ([204, 205, 304].includes(status)) { response.resume(); cleanup(); resolve(new Response(null, { status, headers: responseHeaders })); return; }
        let bytes = 0;
        const stream = new ReadableStream<Uint8Array>({
          start(streamController) {
            response.on("data", (chunk: Buffer) => {
              bytes += chunk.length;
              if (bytes > 8 * 1024 * 1024) { response.destroy(new Error("Remote MCP response exceeded the size limit.")); return; }
              streamController.enqueue(new Uint8Array(chunk));
              response.pause();
            });
            response.on("end", () => { cleanup(); streamController.close(); });
            response.on("error", () => { cleanup(); streamController.error(new Error("Remote MCP response failed.")); });
          },
          pull() { response.resume(); },
          cancel() { response.destroy(); cleanup(); }
        });
        resolve(new Response(stream, { status, headers: responseHeaders }));
      });
      req.on("error", () => { cleanup(); reject(new Error("Remote MCP connection failed or was cancelled.")); });
      req.end(body);
    });
  };
}

async function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error("Remote MCP request cancelled or timed out."));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try { return await Promise.race([promise, cancelled]); }
  finally { signal.removeEventListener("abort", abort); }
}
