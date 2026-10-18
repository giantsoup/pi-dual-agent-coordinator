import { expect, it } from "vitest";
import { parseToolResult } from "../../src/tools/tool-result.js";
import { failedModelStream } from "../../src/security/model-runtime.js";
import { createLocalModel } from "../../src/security/models.js";

it("validates isolated results and preserves Pi's structured, error, usage, and termination fields", () => {
  const result = {
    content: [{ type: "text", text: "failed", textSignature: "signature" }, { type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
    details: { diagnostic: "fixture" }, structuredContent: { ok: false }, isError: true, terminate: true,
    usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3, reasoning: 1, cacheWrite1h: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
  };
  expect(parseToolResult(result)).toEqual(result);
  expect(parseToolResult({ content: [{ type: "text", text: "ok" }] })).toEqual({ content: [{ type: "text", text: "ok" }], details: undefined });
});
it.each([null, {}, { content: [null] }, { content: [{ type: "text", text: 1 }] }, { content: [], isError: "false" }, { content: [], structuredContent: { invalid: undefined } }])("rejects malformed worker output %j", value => {
  expect(() => parseToolResult(value)).toThrow("Invalid isolated tool result");
});
it.each([false, true])("reports broker failure with a settled Pi stream (aborted=%s)", async aborted => {
  const stream = failedModelStream(createLocalModel({ id: "fixture", name: "Fixture" }), new Error("Request rejected"), aborted);
  const events = [];
  for await (const event of stream) events.push(event);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ type: "error", reason: aborted ? "aborted" : "error" });
  expect(await stream.result()).toMatchObject({ stopReason: aborted ? "aborted" : "error", errorMessage: "Request rejected" });
});
