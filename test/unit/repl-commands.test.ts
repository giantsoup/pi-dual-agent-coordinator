import { describe, expect, it } from "vitest";

import { parseCliArgs, parseReplCommand } from "../../src/app/cli.js";

describe("repl commands", () => {
  it("parses non-slash input as a planning user turn", () => {
    expect(parseReplCommand("ship it")).toEqual({ type: "user_turn", text: "ship it" });
  });

  it("parses status", () => {
    expect(parseReplCommand("/status")).toEqual({ type: "status" });
  });

  it("parses approve", () => {
    expect(parseReplCommand("/approve")).toEqual({ type: "approve" });
  });

  it("parses discard", () => {
    expect(parseReplCommand("/discard")).toEqual({ type: "discard" });
  });

  it("parses help", () => {
    expect(parseReplCommand("/help")).toEqual({ type: "help" });
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

  it("parses no-mcp and repeated mcp-config flags from CLI args", () => {
    const parsed = parseCliArgs([
      "repl",
      ".",
      "--no-mcp",
      "--mcp-config",
      "./one.json",
      "--mcp-config",
      "./two.json"
    ]);

    expect(parsed.mcpEnabled).toBe(false);
    expect(parsed.mcpConfigPaths).toEqual([
      `${process.cwd()}/one.json`,
      `${process.cwd()}/two.json`
    ]);
  });

  it("defaults cwd to INIT_CWD when no path is provided", () => {
    const previous = process.env.INIT_CWD;
    process.env.INIT_CWD = "/tmp/operator-project";

    try {
      expect(parseCliArgs(["repl"]).cwd).toBe("/tmp/operator-project");
    } finally {
      if (previous === undefined) {
        delete process.env.INIT_CWD;
      } else {
        process.env.INIT_CWD = previous;
      }
    }
  });
});
