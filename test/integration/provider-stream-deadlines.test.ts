import { setImmediate } from "node:timers/promises";
import { afterEach, expect, it, vi } from "vitest";
import { createProviderBroker } from "../../src/security/provider-broker.js";
import { access, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRoleRuntime } from "../../src/runtime/create-role-runtime.js";
import { fixtureChatResponse, fixtureChatToolResponse } from "../../src/security/fixture-provider.js";

afterEach(() => vi.useRealTimers());

it("keeps an actively streaming local response alive beyond the old two-minute cutoff", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let source: ReadableStreamDefaultController<Uint8Array> | undefined;
  let signal: AbortSignal | null | undefined;
  const encoder = new TextEncoder();
  const broker = await createProviderBroker({ provider: "lm-studio", cwd: "/unused", modelIds: ["local-model"],
    request: async (_url, init) => {
      signal = init?.signal;
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        source = controller;
        signal?.addEventListener("abort", () => controller.error(new Error("terminated")), { once: true });
        controller.enqueue(encoder.encode(": started\n\n"));
      } }), { headers: { "Content-Type": "text/event-stream" } });
    }
  });
  try {
    const response = await fetch(`${broker.baseUrl}/chat/completions`, { method: "POST",
      headers: { Authorization: `Bearer ${broker.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "local-model" }) });
    const result = response.text().then(text => ({ text }), error => ({ error: String(error) }));
    for (let index = 0; index < 5; index++) {
      await vi.advanceTimersByTimeAsync(30_000);
      expect(signal?.aborted).toBe(false);
      source?.enqueue(encoder.encode(`: reasoning progress ${index}\n\n`));
      await setImmediate();
    }
    source?.enqueue(encoder.encode("data: [DONE]\n\n")); source?.close();
    expect(await result).toEqual({ text: expect.stringContaining("data: [DONE]") });
  } finally { await broker.close(); }
});

it.each(["idle", "deadline", "default deadline", "disconnect", "close"] as const)("bounds local streams and reports %s without a retry", async mode => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let source: ReadableStreamDefaultController<Uint8Array> | undefined;
  let signal: AbortSignal | null | undefined;
  const encoder = new TextEncoder();
  const request = vi.fn<typeof fetch>(async (_url, init) => {
    signal = init?.signal;
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      source = controller;
      signal?.addEventListener("abort", () => controller.error(new Error("terminated")), { once: true });
      controller.enqueue(encoder.encode(": started\n\n"));
    } }));
  });
  const broker = await createProviderBroker({ provider: "lm-studio", cwd: "/unused", modelIds: ["local-model"], request,
    ...(mode === "deadline" ? { timeoutMs: 90_000 } : {}) });
  try {
    const response = await fetch(`${broker.baseUrl}/chat/completions`, { method: "POST",
      headers: { Authorization: `Bearer ${broker.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "local-model" }) });
    const result = response.text().then(text => ({ text }), error => ({ error: String(error) }));
    if (mode === "close") {
      await broker.close(); expect(signal?.aborted).toBe(true); await result; return;
    }
    if (mode === "idle") await vi.advanceTimersByTimeAsync(120_001);
    else if (mode === "disconnect") source?.error(new Error("private upstream detail must not escape"));
    else {
      for (let index = 0; index < (mode === "default deadline" ? 59 : 2); index++) {
        await vi.advanceTimersByTimeAsync(30_000); source?.enqueue(encoder.encode(": progress\n\n")); await setImmediate();
      }
      await vi.advanceTimersByTimeAsync(30_001);
    }
    const outcome = await result;
    expect(outcome).toEqual({ text: expect.stringContaining(mode === "idle" ? "response stalled" : mode.includes("deadline") ? "request deadline" : "request interrupted") });
    expect(JSON.stringify(outcome)).not.toContain("private upstream detail");
    expect(request).toHaveBeenCalledTimes(1);
  } finally { if (mode !== "close") await broker.close(); }
});

it("bounds local silence before response headers and disables SDK retry", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let started = false;
  const broker = await createProviderBroker({ provider: "lm-studio", cwd: "/unused", modelIds: ["local-model"],
    request: async (_url, init) => new Promise<Response>((_resolve, reject) => {
      started = true; init?.signal?.addEventListener("abort", () => reject(new Error("terminated")), { once: true });
    }) });
  try {
    const result = fetch(`${broker.baseUrl}/chat/completions`, { method: "POST",
      headers: { Authorization: `Bearer ${broker.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "local-model" }) });
    while (!started) await setImmediate();
    await vi.advanceTimersByTimeAsync(120_001);
    const response = await result;
    expect(response.status).toBe(504); expect(response.headers.get("x-should-retry")).toBe("false");
    expect(await response.text()).toContain("no upstream data for 120 seconds");
  } finally { await broker.close(); }
});

it("preserves the OpenAI absolute deadline even while upstream data arrives", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let source: ReadableStreamDefaultController<Uint8Array> | undefined;
  let signal: AbortSignal | null | undefined;
  const encoder = new TextEncoder();
  const broker = await createProviderBroker({ cwd: "/unused", modelIds: ["cloud-model"], load: async () => "dummy-deadline-key",
    request: async (_url, init) => {
      signal = init?.signal;
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        source = controller; signal?.addEventListener("abort", () => controller.error(new Error("terminated")), { once: true });
        controller.enqueue(encoder.encode(": started\n\n"));
      } }));
    } });
  try {
    const response = await fetch(`${broker.baseUrl}/responses`, { method: "POST",
      headers: { Authorization: `Bearer ${broker.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "cloud-model" }) });
    const result = response.text().catch(() => "interrupted");
    for (let index = 0; index < 3; index++) {
      await vi.advanceTimersByTimeAsync(30_000); source?.enqueue(encoder.encode(": progress\n\n")); await setImmediate();
    }
    await vi.advanceTimersByTimeAsync(30_001);
    expect(signal?.aborted).toBe(true); expect(await result).toBe("interrupted");
  } finally { await broker.close(); }
});

it.each([false, true])("real Pi retains a successful native write across a long continuation, stalled=%s", async stalled => {
  const root = await mkdtemp(join(tmpdir(), "pi-stream-deadline-"));
  const cwd = join(root, "workspace"); await mkdir(cwd);
  let source: ReadableStreamDefaultController<Uint8Array> | undefined;
  let signal: AbortSignal | null | undefined;
  let calls = 0;
  const encoder = new TextEncoder();
  let started = () => {};
  const ready = new Promise<void>(resolve => { started = resolve; });
  const binding = await createRoleRuntime({ cwd, role: "B", sessionRoot: join(root, "state"), sessionMode: "memory",
    providerTestBackend: { cwd, modelIds: [], request: async (_url, init) => {
      calls++;
      if (calls === 1) return fixtureChatToolResponse("write", { path: "result.txt", content: "written exactly once\n" }, "successful-write");
      signal = init?.signal;
      const response = new Response(new ReadableStream<Uint8Array>({ start(controller) {
        source = controller;
        signal?.addEventListener("abort", () => controller.error(new Error("terminated")), { once: true });
        controller.enqueue(encoder.encode(": started\n\n"));
      } }));
      started(); return response;
    } } });
  const unsubscribe = binding.session.subscribe(event => {
    // Start virtual time after the real write, before the continuation request.
    if (event.type === "turn_end" && event.message.role === "assistant" && event.message.stopReason === "toolUse")
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  try {
    const prompt = binding.session.prompt("Write result.txt once, then confirm.");
    await ready; await setImmediate();
    if (stalled) {
      const partial = (await fixtureChatToolResponse("write", { path: "must-not-exist.txt", content: "partial must never run" }, "incomplete-write").text()).split("\n\n")[0];
      source?.enqueue(encoder.encode(`${partial}\n\n`));
      await setImmediate();
      await vi.advanceTimersByTimeAsync(120_001);
    }
    else {
      for (let index = 0; index < 5; index++) {
        await vi.advanceTimersByTimeAsync(30_000);
        expect(signal?.aborted).toBe(false);
        source?.enqueue(encoder.encode(": reasoning progress\n\n")); await setImmediate();
      }
      source?.enqueue(encoder.encode(await fixtureChatResponse("VALID_LATER_COMPLETION").text())); source?.close();
    }
    await prompt;
    expect(binding.session.messages?.at(-1)).toMatchObject(stalled
      ? { role: "assistant", stopReason: "error", errorMessage: expect.stringContaining("response stalled") }
      : { role: "assistant", stopReason: "stop", content: expect.arrayContaining([expect.objectContaining({ text: "VALID_LATER_COMPLETION" })]) });
    expect(await readFile(join(cwd, "result.txt"), "utf8")).toBe("written exactly once\n");
    expect(binding.session.messages?.filter(message => message.role === "toolResult")).toMatchObject([{ toolCallId: "successful-write", isError: false }]);
    expect(calls).toBe(2);
    await expect(access(join(cwd, "must-not-exist.txt"))).rejects.toThrow();
  } finally { unsubscribe(); vi.useRealTimers(); await binding.dispose(); await rm(root, { recursive: true, force: true }); }
});

it.each([0, -1, 1.5, NaN, Infinity, 2_147_483_648])("rejects invalid broker timer %s before loading credentials", async value => {
  const load = vi.fn(async () => "dummy");
  for (const timer of ["timeoutMs", "idleTimeoutMs"] as const) {
    await expect(createProviderBroker({ cwd: "/unused", modelIds: ["local-model"], load, [timer]: value })).rejects.toThrow("Provider timeout");
  }
  expect(load).not.toHaveBeenCalled();
});

it("discards incomplete SSE lines before reporting a safe interruption", async () => {
  let source: ReadableStreamDefaultController<Uint8Array> | undefined;
  const encoder = new TextEncoder();
  const request = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ start(controller) {
    source = controller;
    controller.enqueue(encoder.encode(': complete\n\ndata: {"private":"never forward'));
  } })));
  const broker = await createProviderBroker({ provider: "lm-studio", cwd: "/unused", modelIds: ["local-model"], request });
  try {
    const response = await fetch(`${broker.baseUrl}/chat/completions`, { method: "POST",
      headers: { Authorization: `Bearer ${broker.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "local-model" }) });
    const result = response.text();
    source?.error(new Error("private raw provider error"));
    const text = await result;
    expect(text).not.toMatch(/never forward|private/);
    const errors = text.split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
    expect(errors).toEqual([{ error: { message: expect.stringContaining("request interrupted") } }]);
    expect(request).toHaveBeenCalledTimes(1);
  } finally { await broker.close(); }
});

it("aborts upstream on client cancellation and clears timers after drain", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let aborted = () => {};
  const drained = new Promise<void>(resolve => { aborted = resolve; });
  const request = vi.fn<typeof fetch>(async (_url, init) => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(": start\n\n"));
    init?.signal?.addEventListener("abort", () => { controller.error(new Error("cancelled")); aborted(); }, { once: true });
  } })));
  const broker = await createProviderBroker({ provider: "lm-studio", cwd: "/unused", modelIds: ["local-model"], request });
  try {
    const cancel = new AbortController();
    const response = await fetch(`${broker.baseUrl}/chat/completions`, { method: "POST", signal: cancel.signal,
      headers: { Authorization: `Bearer ${broker.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "local-model" }) });
    const result = response.text().catch(() => "cancelled");
    cancel.abort();
    await drained; await result;
    // Let the asynchronous stream catch/finally release its timers.
    await setImmediate(); await setImmediate();
    expect(vi.getTimerCount()).toBe(0);
    expect(request).toHaveBeenCalledTimes(1);
  } finally { await broker.close(); }
});
