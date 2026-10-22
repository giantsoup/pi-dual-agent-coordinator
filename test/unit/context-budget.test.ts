import { expect, it } from "vitest";
import { assertRequestBudget, textPayloadAllowance, withOutputBudget } from "../../src/runtime/context-budget.js";
import { createLocalModel, createSecureModelCatalog } from "../../src/security/models.js";
const model = createLocalModel({ id: "qwen/qwen3.8-27b", name: "Fixture" });
const payload = { model: model.id, max_tokens: 16384, messages: [{ role: "user", content: "Hello" }] };
it("leaves A about 251k input tokens with bounded reasoning/output headroom", () => {
  const a = createSecureModelCatalog().find("openai", "gpt-6-luna");
  if (!a) throw new Error("Missing approved A model");
  const request = { model: a.id, max_output_tokens: 16384, input: [] };
  expect(assertRequestBudget(a, request, { tokens: 251520, contextWindow: 272000, method: "openai-input-tokens" }).inputTokens).toBe(251520);
  expect(() => assertRequestBudget(a, request, { tokens: 251521, contextWindow: 272000, method: "openai-input-tokens" })).toThrow("Context budget exceeded");
});
it("admits the exact boundary and refuses one token over it", () => {
  expect(assertRequestBudget(model, payload, { tokens: 45056, contextWindow: 65536, method: "fixture" }).inputTokens).toBe(45056);
  expect(() => assertRequestBudget(model, payload, { tokens: 45057, contextWindow: 65536, method: "fixture" })).toThrow("Context budget exceeded");
});
it("includes schemas and Unicode and validates the actual JSON wire representation", () => {
  const tools = [{ type: "function", function: { name: "read", description: "界".repeat(100), parameters: { type: "object", properties: {} } } }];
  expect(textPayloadAllowance({ ...payload, tools })).toBeGreaterThan(textPayloadAllowance(payload) + 300);
  expect(textPayloadAllowance({ ...payload, input: [{ phase: undefined, text: "😀" }] })).toBeGreaterThan(0);
});
it("refuses unverifiable output/model/counts and unknown image accounting", () => {
  for (const request of [{ ...payload, model: "other" }, { ...payload, max_tokens: undefined }, { ...payload, max_tokens: 999999 }]) {
    expect(() => assertRequestBudget(model, request, { tokens: 1, contextWindow: 65536, method: "fixture" })).toThrow();
  }
  expect(() => assertRequestBudget(model, payload, { tokens: NaN, contextWindow: 65536, method: "fixture" })).toThrow();
  expect(() => textPayloadAllowance({ ...payload, messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,abcd" } }] }] })).toThrow("Image context accounting");
});

it("retains configured output headroom when the SDK clamps the serialized cap", () => {
  expect(() => assertRequestBudget(model, { ...payload, max_tokens: 1 }, { tokens: 50000, contextWindow: 65536, method: "fixture" }, 16384)).toThrow("Context budget exceeded");
});

it("uses verified output headroom in the actual wire payload without losing input", () => {
  const local = withOutputBudget({ ...payload, max_tokens: 1 }, "openai-completions", 16384);
  expect(local).toMatchObject({ max_tokens: 16384, messages: payload.messages });
  expect(withOutputBudget({ model: "a", max_tokens: 1, input: [] }, "openai-responses", 1536)).toEqual({ model: "a", max_output_tokens: 1536, input: [] });
});
