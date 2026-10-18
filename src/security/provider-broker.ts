import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { protectSecret, redactText } from "./redact.js";
import { loadCredential } from "./credentials.js";
import { LM_STUDIO_BASE_URL } from "./models.js";

export const trustedProviderEndpoint = "https://api.openai.com/v1/responses";
export function assertProviderEndpoint(value: string): void {
  if (value !== trustedProviderEndpoint) throw new Error("Untrusted provider endpoint rejected.");
}
export function assertSafeProviderEnvironment(): void {
  for (const name of ["OPENAI_API_KEY", "OPENAI_BASE_URL", "NODE_OPTIONS", "NODE_EXTRA_CA_CERTS", "NODE_TLS_REJECT_UNAUTHORIZED", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) {
    if (process.env[name]) throw new Error(`Secure setup does not accept ${name}. Remove the override from the launching environment; use private Keychain entry.`);
  }
}

export interface ProviderBroker {
  baseUrl: string;
  token: string;
  close(): Promise<void>;
}

export async function createProviderBroker(options: {
  provider?: "openai" | "lm-studio" | undefined;
  cwd: string;
  modelIds: string[];
  resolveLocalInstanceId?: (() => Promise<string>) | undefined;
  load?: (() => Promise<string>) | undefined;
  request?: typeof fetch | undefined;
  maxRequests?: number | undefined;
  maxOutputTokens?: number | undefined;
  timeoutMs?: number | undefined;
}): Promise<ProviderBroker> {
  assertSafeProviderEnvironment();
  const local = options.provider === "lm-studio";
  const operation = local ? "/v1/chat/completions" : "/v1/responses";
  const endpoint = local ? `${LM_STUDIO_BASE_URL}/chat/completions` : trustedProviderEndpoint;
  const key = local ? "lm-studio" : await (options.load ?? (() => loadCredential(options.cwd)))();
  if (!key || /[\r\n]/.test(key)) throw new Error("Secure credential unavailable.");
  const token = randomBytes(32).toString("hex");
  const releaseKey = local ? () => {} : protectSecret(key);
  const releaseToken = protectSecret(token);
  const request = options.request ?? fetch;
  let requests = 0;
  const controllers = new Set<AbortController>();
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    // Pi's OpenAI SDK retries HTTP failures independently of session retry settings.
    res.setHeader("x-should-retry", "false");
    const authorization = req.headers.authorization ?? "";
    const expected = `Bearer ${token}`;
    if (Buffer.byteLength(authorization) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(authorization), Buffer.from(expected))) {
      res.writeHead(403).end('{"error":{"message":"Provider capability rejected"}}'); return;
    }
    if (req.method !== "POST" || req.url !== operation) {
      res.writeHead(400).end('{"error":{"message":"Provider operation rejected"}}'); return;
    }
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
    res.on("close", () => controller.abort());
    try {
      let body = "";
      for await (const chunk of req) {
        body += String(chunk);
        if (body.length > 4 * 1024 * 1024) throw new Error("Request limit");
      }
      const parsed: unknown = JSON.parse(body);
      if (!parsed || typeof parsed !== "object" || !("model" in parsed) || typeof parsed.model !== "string" || !options.modelIds.includes(parsed.model)
          || "url" in parsed || "base_url" in parsed || "headers" in parsed) throw new Error("Rejected request");
      if (options.maxRequests !== undefined && requests >= options.maxRequests) throw new Error("Request budget exceeded");
      if (options.maxOutputTokens !== undefined) {
        const limit = local && "max_tokens" in parsed ? parsed.max_tokens : "max_output_tokens" in parsed ? parsed.max_output_tokens : undefined;
        if (typeof limit !== "number" || limit > options.maxOutputTokens) throw new Error("Output budget required");
        if ("tools" in parsed && Array.isArray(parsed.tools) && parsed.tools.length > 0) throw new Error("Smoke test tools forbidden");
      }
      requests++;
      if (local) {
        const instanceId = await options.resolveLocalInstanceId?.();
        body = JSON.stringify({ ...parsed, ...(instanceId ? { model: instanceId } : {}), reasoning_effort: "none" });
      }
      if (!local) assertProviderEndpoint(endpoint);
      const upstream = await request(endpoint, {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body, redirect: "error", signal: controller.signal
      });
      if (!upstream.ok || !upstream.body || upstream.redirected) {
        await upstream.body?.cancel();
        res.writeHead(upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502,
          { "Content-Type": "application/json" }).end(JSON.stringify({ error: { message: local ? "LM Studio request failed; start the local server and load the selected model with 65536 context tokens." : "OpenAI request failed; check credential, permissions, quota, and model access." } }));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      // Sanitize whole SSE lines, including secrets split across transport chunks.
      let pending = "";
      const decoder = new TextDecoder();
      let bytes = 0;
      for await (const chunk of Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream)) {
        bytes += chunk.length;
        if (bytes > 16 * 1024 * 1024) throw new Error("Response limit");
        pending += decoder.decode(chunk, { stream: true });
        let end: number;
        while ((end = pending.indexOf("\n")) !== -1) {
          res.write(`${redactText(pending.slice(0, end))}\n`); pending = pending.slice(end + 1);
        }
      }
      res.end(redactText(pending + decoder.decode()));
    } catch {
      if (res.headersSent) res.destroy();
      else res.writeHead(502, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { message: local ? "LM Studio request unavailable or rejected. Start the local server and load the selected model. No cloud fallback." : "Trusted provider request unavailable or rejected." } }));
    } finally { clearTimeout(timer); controllers.delete(controller); }
  };
  const server = createServer((req, res) => { void handle(req, res); });
  server.requestTimeout = 125_000;
  server.headersTimeout = 10_000;
  server.on("clientError", (_error, socket) => socket.destroy());
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Broker startup failed");
    return {
      baseUrl: `http://127.0.0.1:${address.port}/v1`, token,
      close: async () => {
        for (const controller of controllers) controller.abort();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        releaseKey(); releaseToken();
      }
    };
  } catch { server.close(); releaseKey(); releaseToken(); throw new Error("Trusted provider broker could not start."); }
}
