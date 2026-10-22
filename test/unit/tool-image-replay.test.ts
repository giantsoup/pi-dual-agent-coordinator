import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { expect, it } from "vitest";
import { textToolImageReplay, TOOL_IMAGE_NOTICE } from "../../src/runtime/tool-image-replay.js";

it("replaces only tool images while retaining text, correlation, errors, and the original archive", () => {
  const messages: AgentMessage[] = [{ role: "toolResult", toolCallId: "correlated-call", toolName: "mcp_evidence", isError: false,
    content: [{ type: "text", text: "Actual text evidence" }, { type: "image", data: "private-image", mimeType: "image/png" }], timestamp: 1 }];
  const original = structuredClone(messages);
  expect(textToolImageReplay(messages)).toEqual([{ ...messages[0], content: [
    { type: "text", text: "Actual text evidence" }, { type: "text", text: TOOL_IMAGE_NOTICE }
  ] }]);
  expect(messages).toEqual(original);
});

it("leaves direct user images subject to the existing fail-closed accounting policy", () => {
  const messages: AgentMessage[] = [{ role: "user", content: [
    { type: "text", text: "Inspect this image" }, { type: "image", data: "user-image", mimeType: "image/png" }
  ], timestamp: 1 }];
  expect(textToolImageReplay(messages)).toEqual(messages);
});
