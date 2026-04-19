import { describe, expect, it } from "vitest";

import { CorrelationState } from "../../src/telemetry/correlation.js";
import { normalizeEvent } from "../../src/telemetry/event-normalizer.js";
import { assistantMessage, assistantTurnEnd } from "../helpers/fakes.js";

describe("event normalizer", () => {
  it("preserves required fields across runtime replacement", () => {
    const correlation = new CorrelationState();

    const first = normalizeEvent({
      role: "A",
      sessionId: "session-a-1",
      sessionFile: "/tmp/a-1.jsonl",
      event: assistantTurnEnd("first"),
      requestId: "req-1",
      correlation
    });
    const second = normalizeEvent({
      role: "A",
      sessionId: "session-a-2",
      sessionFile: "/tmp/a-2.jsonl",
      event: assistantTurnEnd("second"),
      requestId: "req-2",
      correlation
    });

    expect(first.role).toBe("A");
    expect(first.sessionId).toBe("session-a-1");
    expect(first.turnIndex).toBe(1);
    expect(second.sessionId).toBe("session-a-2");
    expect(second.sessionFile).toBe("/tmp/a-2.jsonl");
    expect(second.turnIndex).toBe(1);
  });

  it("adds structured tool details and stays compatible when optional fields are missing", () => {
    const correlation = new CorrelationState();

    const start = normalizeEvent({
      role: "B",
      sessionId: "session-b-1",
      event: {
        type: "tool_execution_start",
        toolCallId: "tool-1",
        toolName: "read",
        args: { path: "/tmp/project/src/index.ts" }
      },
      correlation
    });
    const update = normalizeEvent({
      role: "B",
      sessionId: "session-b-1",
      event: {
        type: "tool_execution_update",
        toolCallId: "tool-1",
        toolName: "read",
        args: { path: "/tmp/project/src/index.ts" },
        partialResult: {}
      },
      correlation
    });
    const end = normalizeEvent({
      role: "B",
      sessionId: "session-b-1",
      event: {
        type: "tool_execution_end",
        toolCallId: "tool-1",
        toolName: "read",
        result: {
          content: [{ type: "text", text: "line 1\nline 2" }]
        },
        isError: false
      },
      correlation
    });

    expect(start.details.toolCallId).toBe("tool-1");
    expect(start.details.toolArgs).toEqual({ path: "/tmp/project/src/index.ts" });
    expect(start.details.activityPreview).toBe("reading /tmp/project/src/index.ts");
    expect(update.details.streamState).toBe("streaming");
    expect(update.details.partialResultPreview).toBeUndefined();
    expect(end.details.isError).toBe(false);
    expect(end.details.resultPreview).toBe("line 1\nline 2");
  });

  it("keeps tool call previews but never stores raw thinking deltas", () => {
    const correlation = new CorrelationState();
    const message = assistantMessage("unused");

    const thinking = normalizeEvent({
      role: "A",
      sessionId: "session-a-1",
      event: {
        type: "message_update",
        message,
        assistantMessageEvent: {
          type: "thinking_delta",
          contentIndex: 0,
          delta: "private reasoning should not be logged",
          partial: message
        }
      },
      correlation
    });
    const toolCall = normalizeEvent({
      role: "A",
      sessionId: "session-a-1",
      event: {
        type: "message_update",
        message,
        assistantMessageEvent: {
          type: "toolcall_end",
          contentIndex: 0,
          toolCall: {
            type: "toolCall",
            id: "tool-1",
            name: "bash",
            arguments: {
              command: "OPENAI_API_KEY=sk-test npm test"
            }
          },
          partial: message
        }
      },
      correlation
    });

    expect(thinking.details.assistantEventType).toBe("thinking_delta");
    expect(thinking.details.deltaPreview).toBeUndefined();
    expect(toolCall.details.toolCallName).toBe("bash");
    expect(String(toolCall.details.toolCallArgsPreview)).toContain("[REDACTED]");
    expect(String(toolCall.details.deltaPreview)).toContain("[REDACTED]");
    expect(String(toolCall.details.deltaPreview)).not.toContain("sk-test");
  });
});
