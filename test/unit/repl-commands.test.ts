import { describe, expect, it } from "vitest";

import { formatCliHelp, parseCliArgs, parseReplCommand } from "../../src/app/cli.js";

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
    const parsed = parseCliArgs(["repl", ".", "--max-review-rounds", "5"]);
    expect(parsed).toMatchObject({
      command: "repl",
      maxReviewRounds: 5
    });
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

    expect(parsed).toMatchObject({
      command: "repl",
      mcpEnabled: false,
      mcpConfigPaths: [
        `${process.cwd()}/one.json`,
        `${process.cwd()}/two.json`
      ]
    });
  });

  it("parses the plain UI flag from CLI args", () => {
    const parsed = parseCliArgs(["repl", ".", "--plain"]);
    expect(parsed).toMatchObject({
      command: "repl",
      plainUi: true
    });
  });

  it("parses portal arguments", () => {
    const parsed = parseCliArgs(["portal", ".", "--port", "4317", "--no-session"]);
    expect(parsed).toMatchObject({
      command: "portal",
      cwd: process.cwd(),
      port: 4317,
      sessionMode: "memory"
    });
  });

  it("parses web as a portal alias", () => {
    const parsed = parseCliArgs(["web", ".", "--port", "4317"]);
    expect(parsed).toMatchObject({
      command: "portal",
      cwd: process.cwd(),
      port: 4317
    });
  });

  it("defaults cwd to INIT_CWD when no path is provided", () => {
    const previous = process.env.INIT_CWD;
    process.env.INIT_CWD = "/tmp/operator-project";

    try {
      expect(parseCliArgs(["repl"])).toMatchObject({
        command: "repl",
        cwd: "/tmp/operator-project"
      });
    } finally {
      if (previous === undefined) {
        delete process.env.INIT_CWD;
      } else {
        process.env.INIT_CWD = previous;
      }
    }
  });

  it("parses doctor arguments", () => {
    expect(
      parseCliArgs(["doctor", ".", "--model-b", "local-qwen/qwen3-coder-next"])
    ).toMatchObject({
      command: "doctor",
      cwd: process.cwd(),
      modelB: "local-qwen/qwen3-coder-next"
    });
  });

  it("parses setup and auth arguments", () => {
    expect(parseCliArgs(["setup"])).toMatchObject({
      command: "setup",
      cwd: process.cwd()
    });
    expect(parseCliArgs(["auth", ".", "--agent-dir", "./tmp-agent"])).toMatchObject({
      command: "auth",
      cwd: process.cwd(),
      agentDir: `${process.cwd()}/tmp-agent`
    });
  });

  it("parses top-level help and version commands", () => {
    expect(parseCliArgs(["help", "repl"])).toEqual({
      command: "help",
      topic: "repl"
    });
    expect(parseCliArgs(["--version"])).toEqual({
      command: "version"
    });
  });

  it("treats repl --help as help output", () => {
    expect(parseCliArgs(["repl", "--help"])).toEqual({
      command: "help",
      topic: "repl"
    });
  });

  it("treats portal --help as help output", () => {
    expect(parseCliArgs(["portal", "--help"])).toEqual({
      command: "help",
      topic: "portal"
    });
  });

  it("treats web --help as portal help output", () => {
    expect(parseCliArgs(["web", "--help"])).toEqual({
      command: "help",
      topic: "portal"
    });
  });

  it("includes setup and auth in general help", () => {
    const help = formatCliHelp("general");
    expect(help).toContain("setup     Guided first-run setup for auth and defaults");
    expect(help).toContain("auth      Change or repair Agent A auth/defaults");
    expect(help).toContain(
      "web       Alias for portal so you can launch the web interface from any linked install"
    );
    expect(help).toContain("portal    Start the local web interface on localhost");
  });

  it("includes the plain flag in repl help", () => {
    expect(formatCliHelp("repl")).toContain("--plain");
  });

  it("includes the port flag in portal help", () => {
    const help = formatCliHelp("portal");
    expect(help).toContain("npm run web -- .");
    expect(help).toContain("pi-dual web .");
    expect(help).toContain("--port PORT");
    expect(help).toContain("works in any browser on this computer");
  });
});
