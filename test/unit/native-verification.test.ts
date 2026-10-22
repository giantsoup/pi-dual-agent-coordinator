import { describe, expect, it } from "vitest";
import { observeNativeTurn, readNativeEvidence } from "../../src/coordinator/native-verification.js";
import { retainShellMetadata } from "../../src/tools/tool-result.js";
import { protectSecret } from "../../src/security/redact.js";
import { assistantMessage } from "../helpers/fakes.js";
import type { ModelTurnEnd } from "../../src/runtime/create-role-runtime.js";

function turn(exitCode: number, isError: boolean, output: string, metadata = true): ModelTurnEnd {
  const result = retainShellMetadata({ content: [{ type: "text", text: output }], details: undefined,
    structuredContent: { output, exit_code: exitCode, truncated: false } });
  return { type: "turn_end", message: { ...assistantMessage("Tests passed"), content: [{ type: "toolCall", id: "native-check", name: "bash", arguments: { command: "node --test | cat" } }] },
    toolResults: [{ role: "toolResult", toolName: "bash", toolCallId: "native-check", content: result.content, isError, timestamp: 1,
      ...(metadata ? { details: JSON.parse(JSON.stringify(result.details)) } : {}) }] };
}
describe("native verification facts", () => {
  it("retains structured failed exits independently of tool status or completion prose", () => {
    expect(observeNativeTurn(turn(1, false, "# fail 2"))).toMatchObject([{ toolCallId: "native-check", status: "success", exitCode: 1, output: "# fail 2" }]);
    expect(observeNativeTurn(turn(0, false, "# fail 2"))).toMatchObject([{ exitCode: 0, command: "node --test | cat", output: "# fail 2" }]);
  });
  it("leaves unsupported totals and historical exits unknown rather than parsing prose", () => {
    const observations = observeNativeTurn(turn(0, false, "30 tests passed says B", false));
    expect(observations).toMatchObject([{ exitCode: null, outputTruncated: null, source: "native-text" }]);
    expect(observations[0]).not.toHaveProperty("totals");
    expect(readNativeEvidence(undefined)).toBeUndefined();
    expect(readNativeEvidence({ nativeEvidence: { schemaVersion: 2 } })).toBeUndefined();
  });
  it("requires matching call ID and tool name and bounds/redacts observations", () => {
    const release = protectSecret("dummy-private-native-result");
    try {
      const event = turn(1, true, "dummy-private-native-result" + "x".repeat(10000));
      const facts = observeNativeTurn(event);
      expect(facts[0]?.output.length).toBeLessThan(4100);
      expect(facts[0]?.outputTruncated).toBe(true);
      expect(facts[0]?.output).not.toContain("dummy-private-native-result");
      if (event.toolResults[0]) event.toolResults[0].toolName = "read";
      expect(observeNativeTurn(event)).toEqual([]);
    } finally { release(); }
  });
  it("does not fabricate shell metadata from malformed structured content", () => {
    expect(retainShellMetadata({ content: [], details: {}, structuredContent: { exit_code: "1", truncated: false } }).details).toEqual({});
  });
});
