import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { isProviderContextOverflow } from "./provider-error.js";
import { protectSecret, redactText } from "./redact.js";
import { loadCredential } from "./credentials.js";
import { LM_STUDIO_BASE_URL, QWEN38_MODEL_ID } from "./models.js";
import { providerBrokerPorts } from "./local-network.js";
import { OpenAiTokenCounter } from "./openai-token-counter.js";

export const trustedProviderEndpoint = "https://api.openai.com/v1/responses";
export function assertProviderEndpoint(value: string): void {
  if (value !== trustedProviderEndpoint) throw new Error("Untrusted provider endpoint rejected.");
}
export function assertSafeProviderEnvironment(): void {
  for (const name of ["OPENAI_API_KEY", "OPENAI_BASE_URL", "NODE_OPTIONS", "NODE_EXTRA_CA_CERTS", "NODE_TLS_REJECT_UNAUTHORIZED", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) {
    if (process.env[name]) throw new Error(`Secure setup does not accept ${name}. Remove the override from the launching environment; use private Keychain entry.`);
  }
}

export interface ProviderDiagnostic {
  phase: "request_started" | "first_body_chunk" | "settled";
  providerRequestId: string;
  elapsedMs: number;
  deadlineMs: number;
  idleDeadlineMs: number;
  activeToolCount: number;
  chunks: number;
  bytes: number;
  outcome?: "completed" | "idle" | "deadline" | "client_disconnect" | "shutdown" | "upstream_rejected" | "transport_or_validation_failure";
}

export interface ProviderBroker {
  baseUrl: string;
  token: string;
  countInputTokens?(payload: unknown, signal?: AbortSignal): Promise<number>;
  close(): Promise<void>;
}

type BrokerStop = { kind: "idle" | "deadline"; milliseconds: number }
  | { kind: "client_disconnect" | "shutdown" };

export async function createProviderBroker(options: {
  onDiagnostic?: ((event: ProviderDiagnostic) => void) | undefined;
  provider?: "openai" | "lm-studio" | undefined;
  cwd: string;
  modelIds: string[];
  resolveLocalInstanceId?: (() => Promise<string>) | undefined;
  load?: (() => Promise<string>) | undefined;
  request?: typeof fetch | undefined;
  /** Trusted fixture transport for token counting; never exposed through config or role tools. */
  countRequest?: typeof fetch | undefined;
  maxRequests?: number | undefined;
  maxOutputTokens?: number | undefined;
  timeoutMs?: number | undefined;
  idleTimeoutMs?: number | undefined;
}): Promise<ProviderBroker> {
  assertSafeProviderEnvironment();
  const local = options.provider === "lm-studio";
  const timeoutMs = options.timeoutMs ?? 30 * 60_000;
  const idleTimeoutMs = options.idleTimeoutMs ?? 120_000;
  for (const value of [timeoutMs, options.idleTimeoutMs]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647)) throw new Error("Provider timeout must be a positive whole number within the supported timer range.");
  }
  const operation = local ? "/v1/chat/completions" : "/v1/responses";
  const endpoint = local ? `${LM_STUDIO_BASE_URL}/chat/completions` : trustedProviderEndpoint;
  const key = local ? "lm-studio" : await (options.load ?? (() => loadCredential(options.cwd)))();
  if (!key || /[\r\n]/.test(key)) throw new Error("Secure credential unavailable.");
  const token = randomBytes(32).toString("hex");
  const releaseKey = local ? () => {} : protectSecret(key);
  const releaseToken = protectSecret(token);
  const request = options.request ?? fetch;
  const tokenCounter = !local && options.maxOutputTokens === undefined ? new OpenAiTokenCounter(options.modelIds, (body, signal) =>
    (options.countRequest ?? request)(`${trustedProviderEndpoint}/input_tokens`, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body, redirect: "error", signal
    })) : undefined;
  let requests = 0;
  const controllers = new Map<AbortController, (reason: BrokerStop) => void>();
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
    const started = performance.now();
    const providerRequestId = randomBytes(12).toString("hex");
    let activeToolCount = 0; let chunks = 0; let receivedBytes = 0;
    let outcome: NonNullable<ProviderDiagnostic["outcome"]> = "transport_or_validation_failure";
    const diagnostic = (phase: ProviderDiagnostic["phase"]) => {
      // Diagnostics cannot affect request, cancellation, or SSE ownership.
      try { options.onDiagnostic?.({ phase, providerRequestId, elapsedMs: performance.now() - started,
        deadlineMs: timeoutMs, idleDeadlineMs: idleTimeoutMs, activeToolCount, chunks, bytes: receivedBytes,
        ...(phase === "settled" ? { outcome } : {}) }); } catch { /* Observers are best effort. */ }
    };
    const controller = new AbortController();
    let stopped: BrokerStop | undefined;
    const stop = (reason: BrokerStop) => {
      if (stopped) return;
      stopped = reason;
      controller.abort();
    };
    controllers.set(controller, stop);
    const timer = setTimeout(() => stop({ kind: "deadline", milliseconds: timeoutMs }), timeoutMs);
    let idleTimer: NodeJS.Timeout | undefined;
    const clearTimers = () => { clearTimeout(timer); clearTimeout(idleTimer); };
    res.on("close", () => { if (!res.writableEnded) stop({ kind: "client_disconnect" }); });
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
      activeToolCount = "tools" in parsed && Array.isArray(parsed.tools) ? parsed.tools.length : 0;
      diagnostic("request_started");
      requests++;
      if (local) {
        const instanceId = await options.resolveLocalInstanceId?.();
        if ("pi_dual_expected_instance" in parsed && parsed.pi_dual_expected_instance !== instanceId) throw new Error("Local model changed after context admission");
        const forwarded: Record<string, unknown> = { ...parsed };
        delete forwarded.pi_dual_expected_instance;
        const effort = parsed.model === QWEN38_MODEL_ID
          ? ("reasoning_effort" in parsed ? parsed.reasoning_effort : "xhigh") : "none";
        if (typeof effort !== "string" || !["none", "low", "medium", "xhigh"].includes(effort)) throw new Error("Unsupported local reasoning effort");
        body = JSON.stringify({ ...forwarded, ...(instanceId ? { model: instanceId } : {}), reasoning_effort: effort });
      }
      if (!local) assertProviderEndpoint(endpoint);
      controller.signal.throwIfAborted();
      idleTimer = setTimeout(() => stop({ kind: "idle", milliseconds: idleTimeoutMs }), idleTimeoutMs);
      const upstream = await request(endpoint, {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body, redirect: "error", signal: controller.signal
      });
      idleTimer?.refresh();
      controller.signal.throwIfAborted();
      if (!upstream.ok || !upstream.body || upstream.redirected) {
        outcome = "upstream_rejected";
        const overflow = await isProviderContextOverflow(upstream) && !upstream.redirected;
        res.writeHead(upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502,
          { "Content-Type": "application/json" }).end(JSON.stringify({ error: overflow ? { code: "context_length_exceeded", message: "Model context limit exceeded" } : { message: local ? "LM Studio request failed; start the local server and load the selected model with 65536 context tokens." : "OpenAI request failed; check credential, permissions, quota, and model access." } }));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      // Sanitize whole SSE lines, including secrets split across transport chunks.
      let pending = "";
      const decoder = new TextDecoder();
      let bytes = 0;
      for await (const chunk of Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream)) {
        controller.signal.throwIfAborted();
        if (chunk.length > 0) {
          idleTimer?.refresh(); receivedBytes += chunk.length; chunks++;
          if (chunks === 1) diagnostic("first_body_chunk");
        }
        bytes += chunk.length;
        if (bytes > 16 * 1024 * 1024) throw new Error("Response limit");
        pending += decoder.decode(chunk, { stream: true });
        let end: number;
        while ((end = pending.indexOf("\n")) !== -1) {
          res.write(`${redactText(pending.slice(0, end))}\n`); pending = pending.slice(end + 1);
        }
      }
      clearTimers();
      res.end(redactText(pending + decoder.decode()));
      outcome = "completed";
    } catch {
      clearTimers();
      if (res.destroyed) return;
      const message = stopped?.kind === "idle" ? `${local ? "LM Studio" : "OpenAI"} response stalled: no upstream data for ${stopped.milliseconds / 1000} seconds. No automatic replay was attempted.`
        : stopped?.kind === "deadline" ? `${local ? "LM Studio" : "OpenAI"} response exceeded the ${stopped.milliseconds / 1000}-second request deadline. No automatic replay was attempted.`
        : stopped?.kind === "shutdown" ? "Provider broker shut down. No automatic replay was attempted."
        : local ? "LM Studio request interrupted, unavailable or rejected. Check the local server and model. No cloud fallback or automatic replay." : "OpenAI request interrupted, unavailable or rejected. Check the connection and provider status. No automatic replay was attempted.";
      if (res.headersSent) {
        // Discard pending partial lines and return the provider's native SSE error shape.
        if (local) res.end(`\ndata: ${JSON.stringify({ error: { message } })}\n\n`);
        else res.end(`\nevent: error\ndata: ${JSON.stringify({ type: "error", code: "provider_stream_interrupted", message, param: null, sequence_number: 0 })}\n\n`);
      } else res.writeHead(stopped?.kind === "idle" || stopped?.kind === "deadline" ? 504 : 502, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { message } }));
    } finally { outcome = stopped?.kind ?? outcome; diagnostic("settled"); clearTimers(); controllers.delete(controller); }
  };
  const server = createServer((req, res) => { void handle(req, res); });
  server.requestTimeout = 125_000;
  server.headersTimeout = 10_000;
  server.on("clientError", (_error, socket) => socket.destroy());
  try {
    const offset = randomInt(providerBrokerPorts.length);
    for (let index = 0; index < providerBrokerPorts.length; index++) {
      const port = providerBrokerPorts[(offset + index) % providerBrokerPorts.length];
      if (port === undefined) throw new Error("Provider broker port unavailable");
      try {
        await new Promise<void>((resolve, reject) => {
          const onError = (error: Error) => { server.off("listening", onListening); reject(error); };
          const onListening = () => { server.off("error", onError); resolve(); };
          server.once("error", onError);
          server.once("listening", onListening);
          server.listen(port, "127.0.0.1");
        });
        break;
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "EADDRINUSE" || index === providerBrokerPorts.length - 1) throw error;
      }
    }
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Broker startup failed");
    return {
      baseUrl: `http://127.0.0.1:${address.port}/v1`, token,
      ...(tokenCounter ? { countInputTokens: (payload: unknown, signal?: AbortSignal) => tokenCounter.count(payload, signal) } : {}),
      close: async () => {
        for (const stop of controllers.values()) stop({ kind: "shutdown" });
        await tokenCounter?.close();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        releaseKey(); releaseToken();
      }
    };
  } catch { await tokenCounter?.close(); server.close(); releaseKey(); releaseToken(); throw new Error("Trusted provider broker could not start."); }
}
