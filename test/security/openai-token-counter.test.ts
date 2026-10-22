import { expect, it } from "vitest";
import { createProviderBroker } from "../../src/security/provider-broker.js";

const payload = { model: "gpt-6-luna", input: [{ role: "user", content: "Preserve the objective" }],
  tools: [{ type: "function", name: "read", parameters: { type: "object", properties: {} } }], max_output_tokens: 16384, store: false, stream: true };

it("counts the complete input through a private destination-bound method and caches identical inputs", async () => {
  let calls = 0;
  const broker = await createProviderBroker({ cwd: "/fixture", modelIds: [payload.model], load: async () => "dummy-private-counting-key",
    request: async (url, init) => {
      calls++;
      expect(String(url)).toBe("https://api.openai.com/v1/responses/input_tokens");
      expect(init?.redirect).toBe("error");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer dummy-private-counting-key" });
      const parsed: unknown = JSON.parse(String(init?.body));
      expect(parsed).toMatchObject({ model: payload.model, tools: payload.tools });
      expect(String(init?.body)).not.toMatch(/max_output_tokens|"store"|"stream"/);
      return Response.json({ object: "response.input_tokens", input_tokens: 42 });
    } });
  try {
    if (!broker.countInputTokens) throw new Error("Missing A counter");
    expect(await broker.countInputTokens(payload)).toBe(42);
    expect(await broker.countInputTokens({ ...payload, max_output_tokens: 8192 })).toBe(42);
    expect(calls).toBe(1);
    expect(await broker.countInputTokens({ ...payload, input: [{ role: "user", content: "New evidence" }] })).toBe(42);
    expect(calls).toBe(2);
    for (const invalid of [{ ...payload, model: "unapproved" }, { ...payload, url: "https://other.example" }, { ...payload, previous_response_id: "private-response" },
      { ...payload, input: [{ type: "input_image", image_url: "data:image/png;base64,abcd" }] }]) {
      await expect(broker.countInputTokens(invalid)).rejects.toThrow(/counting unavailable/);
    }
    const denied = await fetch(`${broker.baseUrl}/responses/input_tokens`, { method: "POST", headers: { Authorization: `Bearer ${broker.token}` }, body: JSON.stringify(payload) });
    expect(denied.status).toBe(400);
    expect(calls).toBe(2);
  } finally { await broker.close(); }
});

it.each(["forbidden", "malformed", "oversized", "negative", "fractional", "unsafe"])("fails closed on %s counts without exposing upstream data", async kind => {
  let calls = 0;
  const broker = await createProviderBroker({ cwd: "/fixture", modelIds: [payload.model], load: async () => "dummy-count-key", request: async () => {
    calls++;
    if (kind === "forbidden") return new Response("private upstream error", { status: 403 });
    if (kind === "malformed") return new Response("private invalid JSON");
    if (kind === "oversized") return new Response("x".repeat(8193));
    return Response.json({ object: "response.input_tokens", input_tokens: kind === "negative" ? -1 : kind === "fractional" ? 1.5 : Number.MAX_SAFE_INTEGER + 1 });
  } });
  try {
    if (!broker.countInputTokens) throw new Error("Missing A counter");
    await expect(broker.countInputTokens(payload)).rejects.toThrow("OpenAI input token counting unavailable or rejected.");
    expect(calls).toBe(1);
  } finally { await broker.close(); }
});

it("aborts and drains pending counting before broker disposal", async () => {
  let started = () => {};
  const ready = new Promise<void>(resolve => { started = resolve; });
  let aborted = false;
  const broker = await createProviderBroker({ cwd: "/fixture", modelIds: [payload.model], load: async () => "dummy-count-key", request: async (_url, init) => {
    started();
    await new Promise<void>((_resolve, reject) => init?.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("aborted private request")); }, { once: true }));
    throw new Error("Unreachable");
  } });
  if (!broker.countInputTokens) throw new Error("Missing A counter");
  const pending = broker.countInputTokens(payload).then(() => "completed", () => "aborted");
  try {
    await ready;
    await broker.close();
    expect(aborted).toBe(true);
    expect(await pending).toBe("aborted");
    await expect(broker.countInputTokens(payload)).rejects.toThrow("closed");
  } finally { await broker.close(); }
});

it.each(["local", "smoke"])("does not grant counting to %s runtimes", async kind => {
  let calls = 0;
  const broker = await createProviderBroker({ cwd: "/fixture", modelIds: [payload.model], ...(kind === "local" ? { provider: "lm-studio" } : { maxOutputTokens: 1024 }),
    load: async () => "dummy-count-key", request: async () => { calls++; throw new Error("No counting request allowed"); } });
  try { expect(broker.countInputTokens).toBeUndefined(); expect(calls).toBe(0); }
  finally { await broker.close(); }
});
