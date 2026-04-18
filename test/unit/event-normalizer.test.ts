import { describe, expect, it } from "vitest";

import { CorrelationState } from "../../src/telemetry/correlation.js";
import { normalizeEvent } from "../../src/telemetry/event-normalizer.js";
import { assistantTurnEnd } from "../helpers/fakes.js";

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
});
