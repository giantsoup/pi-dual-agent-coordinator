import { expect, it, vi, afterEach } from "vitest";
import { createRemoteMcpFetch, isPublicMcpAddress, validateRemoteMcpUrl } from "../../src/mcp/remote-transport.js";
import type { LookupAddress } from "node:dns";
const lookup = vi.hoisted(() => vi.fn<(hostname: string, options: { all: true }) => Promise<LookupAddress[]>>());
import { request, type RequestOptions } from "node:https";
import { createServer, request as httpRequest } from "node:http";
vi.mock("node:dns/promises", () => ({ lookup }));
vi.mock("node:https", () => ({ request: vi.fn() }));
afterEach(() => vi.resetAllMocks());

it.each(["127.0.0.1", "10.1.1.1", "100.64.1.1", "169.254.169.254", "172.16.1.1", "192.168.1.1", "192.0.2.1", "198.18.0.1", "224.0.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2002:7f00:1::", "2001:db8::1", "3fff::1"])("blocks private and reserved address %s", address => {
  expect(isPublicMcpAddress(address)).toBe(false);
});
it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])("accepts public address %s", address => {
  expect(isPublicMcpAddress(address)).toBe(true);
});
it.each(["http://example.com/mcp", "https://localhost/mcp", "https://127.1/mcp", "https://[::ffff:127.0.0.1]/mcp", "https://user:password@example.com/mcp", "https://example.com:1234/mcp", "https://example.com/mcp?key=secret"])("rejects unsafe endpoint without exposing its contents", url => {
  expect(() => validateRemoteMcpUrl(url)).toThrow(/Remote MCP/);
  try { validateRemoteMcpUrl(url); } catch (error) { expect(String(error)).not.toContain("password"); expect(String(error)).not.toContain("key=secret"); }
});
it("rejects changed destinations before DNS or network activity", async () => {
  const fetch = createRemoteMcpFetch("https://example.com/mcp");
  await expect(fetch("https://other.example/mcp")).rejects.toThrow("configured endpoint");
  expect(lookup).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
});
it("rejects mixed public and private DNS answers before opening a socket", async () => {
  lookup.mockResolvedValue([{ address: "1.1.1.1", family: 4 }, { address: "127.0.0.1", family: 4 }]);
  await expect(createRemoteMcpFetch("https://example.com/mcp")("https://example.com/mcp")).rejects.toThrow("private or reserved");
  expect(request).not.toHaveBeenCalled();
});
it("never forwards a provider capability or arbitrary headers", async () => {
  lookup.mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
  await expect(createRemoteMcpFetch("https://example.com/mcp")("https://example.com/mcp", { headers: { Authorization: "Bearer dummy-provider-capability" } })).rejects.toThrow("custom headers");
  expect(request).not.toHaveBeenCalled();
});
it("honors cancellation before opening a socket", async () => {
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  await expect(createRemoteMcpFetch("https://example.com/mcp")("https://example.com/mcp", { signal: controller.signal })).rejects.toThrow("cancelled");
  expect(request).not.toHaveBeenCalled();
});

it("cancels DNS resolution without opening a socket", async () => {
  lookup.mockImplementation(() => new Promise(() => undefined));
  const controller = new AbortController();
  const pending = createRemoteMcpFetch("https://example.com/mcp")("https://example.com/mcp", { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toThrow("cancelled or timed out");
  expect(request).not.toHaveBeenCalled();
});

async function responseFixture(status: number, body: string, location?: string) {
  const server = createServer((_req, res) => {
    res.writeHead(status, { "content-type": "application/json", ...(location ? { location } : {}) });
    res.end(body);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  let options: RequestOptions | undefined;
  vi.mocked(request).mockImplementation((_url, input, listener) => {
    options = input;
    return httpRequest({ hostname: "127.0.0.1", port: address.port, method: input.method ?? "GET", headers: input.headers ?? {}, ...(input.signal ? { signal: input.signal } : {}) }, listener);
  });
  lookup.mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
  return {
    options: () => options,
    close: () => new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close(error => error ? reject(error) : resolve());
    })
  };
}

it("pins the validated address and original TLS identity while streaming a response", async () => {
  const fixture = await responseFixture(200, '{"ok":true}');
  try {
    const response = await createRemoteMcpFetch("https://example.com/mcp")("https://example.com/mcp", { method: "POST", body: "{}" });
    expect(await response.json()).toEqual({ ok: true });
    expect(fixture.options()).toMatchObject({ hostname: "1.1.1.1", servername: "example.com", rejectUnauthorized: true, agent: false, headers: { host: "example.com" } });
  } finally { await fixture.close(); }
});
it("rejects redirects without sending a second request", async () => {
  const fixture = await responseFixture(307, "", "http://127.0.0.1:1234/v1/chat/completions");
  try {
    await expect(createRemoteMcpFetch("https://example.com/mcp")("https://example.com/mcp")).rejects.toThrow("redirects are forbidden");
    expect(request).toHaveBeenCalledTimes(1);
  } finally { await fixture.close(); }
});
it("stops an oversized streamed response", async () => {
  const fixture = await responseFixture(200, "x".repeat(8 * 1024 * 1024 + 1));
  try {
    const response = await createRemoteMcpFetch("https://example.com/mcp")("https://example.com/mcp");
    await expect(response.text()).rejects.toThrow("response failed");
  } finally { await fixture.close(); }
});
