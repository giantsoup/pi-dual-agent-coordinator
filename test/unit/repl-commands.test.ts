import { describe, expect, it } from "vitest";

import { parseCliArgs, parseReplCommand } from "../../src/app/cli.js";

describe("repl commands", () => {
  it("parses non-slash input as a planning user turn", () => {
    expect(parseReplCommand("ship it")).toEqual({ type: "user_turn", text: "ship it" });
  });

  it("parses status", () => {
    expect(parseReplCommand("/status")).toEqual({ type: "status" });
  });

  it("parses sessions", () => {
    expect(parseReplCommand("/sessions")).toEqual({ type: "sessions" });
  });

  it("parses new runtime", () => {
    expect(parseReplCommand("/new a")).toEqual({ type: "new", role: "A" });
  });

  it("parses switch runtime", () => {
    const command = parseReplCommand("/switch b /tmp/session.jsonl");
    expect(command).toEqual({
      type: "switch",
      role: "B",
      sessionPath: "/tmp/session.jsonl"
    });
  });

  it("parses quit", () => {
    expect(parseReplCommand("/quit")).toEqual({ type: "quit" });
  });

  it("parses max review rounds from CLI args", () => {
    expect(parseCliArgs(["repl", ".", "--max-review-rounds", "5"]).maxReviewRounds).toBe(5);
  });
});
