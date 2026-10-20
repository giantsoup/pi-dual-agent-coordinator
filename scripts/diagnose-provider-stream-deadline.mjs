import assert from "node:assert/strict";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

// Diagnostic only: injected local SSE data, scaled deadlines, no inference or credentials.
const modulePath = resolve(process.argv[2] ?? "dist/src/security/provider-broker.js");
const { createProviderBroker } = await import(pathToFileURL(modulePath).href);
const encoder = new TextEncoder();
let source;
let upstreamSignal;
let requests = 0;
let simulatedElapsedMs = 0;
const originalSetTimeout = globalThis.setTimeout;
// Keep real Node Timeout objects so refresh() retains its actual semantics.
// Scale only the broker's known default deadlines by 100 for a short reproduction.
globalThis.setTimeout = (callback, milliseconds, ...args) => originalSetTimeout(callback,
  milliseconds === 120_000 || milliseconds === 1_800_000 ? milliseconds / 100 : milliseconds, ...args);
let broker;
try {
  broker = await createProviderBroker({
    provider: "lm-studio",
    cwd: "/unused-diagnostic-workspace",
    modelIds: ["diagnostic-local-model"],
    load: async () => { throw new Error("Diagnostic must not load credentials"); },
    request: async (_url, init) => {
      requests++;
      upstreamSignal = init.signal;
      return new Response(new ReadableStream({
        start(controller) {
          source = controller;
          upstreamSignal.addEventListener("abort", () => {
            controller.error(new Error("terminated"));
          }, { once: true });
          controller.enqueue(encoder.encode(": started\n\n"));
        }
      }));
    }
  });
  const response = await fetch(`${broker.baseUrl}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(5000),
    headers: { Authorization: `Bearer ${broker.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "diagnostic-local-model" })
  });
  const body = response.text().then(text => ({ text }), error => ({ error: error.message }));
  try {
    for (let index = 0; index < 5; index++) {
      await delay(300);
      simulatedElapsedMs += 30_000;
      assert.equal(upstreamSignal.aborted, false,
        `Active local stream aborted by ${simulatedElapsedMs}ms despite data every 30000ms`);
      source.enqueue(encoder.encode(`: progress ${index}\n\n`));
    }
    source.enqueue(encoder.encode("data: [DONE]\n\n"));
    source.close();
    const outcome = await body;
    assert.ok("text" in outcome && outcome.text.includes("data: [DONE]"));
    assert.equal(requests, 1);
    console.log(JSON.stringify({ result: "PASS", simulatedElapsedMs, requests }));
  } catch (error) {
    console.error(JSON.stringify({ result: "FAIL", simulatedElapsedMs, requests,
      reason: error.message, downstream: await body }));
    process.exitCode = 1;
  }
} finally {
  globalThis.setTimeout = originalSetTimeout;
  await broker?.close();
}
