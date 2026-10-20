import { expect, it, vi, beforeEach } from "vitest";
const fixture = vi.hoisted(() => ({ template: vi.fn(async () => "FORMATTED_WITH_TOOLS"), count: vi.fn(async () => 123), disposed: vi.fn(async () => {}) }));
vi.mock("@lmstudio/sdk", () => ({ LMStudioClient: class {
  public llm = { createDynamicHandle: () => ({ applyPromptTemplate: fixture.template, countTokens: fixture.count, getContextLength: async () => 65536 }) };
  public [Symbol.asyncDispose] = fixture.disposed;
} }));
import { localTokenCounter } from "../../src/security/local-token-counter.js";
beforeEach(() => { vi.clearAllMocks(); });
it("counts templated native tool history with the exact tool definitions", async () => {
  const tools = [{ type: "function", function: { name: "read", parameters: { type: "object", properties: { path: { type: "string" } } } } }];
  const count = localTokenCounter(async () => "verified-instance");
  const result = await count({ tools, messages: [{ role: "user", content: [{ type: "text", text: "Read" }] }, { role: "assistant", tool_calls: [{ id: "call", type: "function", function: { name: "read", arguments: '{"path":"a.txt"}' } }] }, { role: "tool", tool_call_id: "call", content: "Actual output" }] });
  expect(result).toEqual({ tokens: 123, contextWindow: 65536, method: "lm-studio-template-tokenizer", instanceId: "verified-instance" });
  expect(fixture.template).toHaveBeenCalledWith({ messages: [
    { role: "user", content: [{ type: "text", text: "Read" }] },
    { role: "assistant", content: [{ type: "toolCallRequest", toolCallRequest: { id: "call", type: "function", name: "read", arguments: { path: "a.txt" } } }] },
    { role: "tool", content: [{ type: "toolCallResult", toolCallId: "call", content: "Actual output" }] }
  ] }, { toolDefinitions: tools });
  expect(fixture.count).toHaveBeenCalledWith("FORMATTED_WITH_TOOLS");
  expect(fixture.disposed).toHaveBeenCalledOnce();
});
it("fails closed for images, reasoning replay, and a changing loaded instance", async () => {
  const count = localTokenCounter(async () => "verified-instance");
  await expect(count({ messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "private" } }] }] })).rejects.toThrow("does not support");
  await expect(count({ messages: [{ role: "assistant", content: "x", reasoning_content: "private reasoning" }] })).rejects.toThrow("unsupported context accounting");
  expect(fixture.template).not.toHaveBeenCalled();
  let calls = 0;
  await expect(localTokenCounter(async () => ++calls === 1 ? "old" : "new")({ messages: [{ role: "user", content: "x" }] })).rejects.toThrow("tokenizer unavailable or unsupported");
  expect(fixture.disposed).toHaveBeenCalledOnce();
});
