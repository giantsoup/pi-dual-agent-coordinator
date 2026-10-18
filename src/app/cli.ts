import { resolve } from "node:path";

import type { Role } from "../types/role.js";

export type ReplThinkingLevel = import("../runtime/create-role-runtime.js").SupportedThinkingLevel;
export type HelpTopic = "general" | "repl" | "doctor" | "setup" | "auth";

export interface ReplCliOptions {
  command: "repl";
  cwd: string;
  agentDir?: string;
  sessionRoot?: string;
  sessionMode: "persistent" | "memory";
  plainUi?: boolean;
  jsonLogs: boolean;
  verbose: boolean;
  modelA?: string;
  modelB?: string;
  thinkingA?: ReplThinkingLevel;
  thinkingB?: ReplThinkingLevel;
  maxReviewRounds: number;
  timeoutMs?: number;
  reviewRoundsExplicit?: boolean;
  mcpEnabled?: boolean;
  mcpConfigPaths?: string[];
}

export interface DoctorCliOptions {
  command: "doctor";
  cwd: string;
  agentDir?: string;
  modelA?: string;
  modelB?: string;
  mcpEnabled?: boolean;
  mcpConfigPaths?: string[];
}

export interface SetupCliOptions {
  command: "setup";
  cwd: string;
  agentDir?: string;
}

export interface AuthCliOptions {
  command: "auth";
  cwd: string;
  agentDir?: string;
}

export interface HelpCliOptions {
  command: "help";
  topic: HelpTopic;
}

export interface VersionCliOptions {
  command: "version";
}

export type CliOptions =
  | ReplCliOptions
  | DoctorCliOptions
  | SetupCliOptions
  | AuthCliOptions
  | HelpCliOptions
  | VersionCliOptions;

export type ParsedReplCommand =
  | { type: "user_turn"; text: string }
  | { type: "help" }
  | { type: "history" }
  | { type: "inspect"; id: string; section: import("../types/history.js").HistoryDetail["section"]; offset: number }
  | { type: "status" }
  | { type: "approve" }
  | { type: "discard" }
  | { type: "sessions"; role?: Role }
  | { type: "model"; role: Role; model?: string; save: boolean }
  | { type: "thinking"; role: Role; thinking?: ReplThinkingLevel; save: boolean }
  | { type: "config"; key: "review-rounds" | "timeout-ms"; value: number; save: boolean }
  | { type: "handoff" }
  | { type: "new"; role: Role }
  | { type: "new_conversation" }
  | { type: "switch"; role: Role; sessionPath: string }
  | { type: "cancel" }
  | { type: "quit" };

const VALID_THINKING = new Set<ReplThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh"]);
const HELP_FLAGS = new Set(["--help", "-h"]);
const VERSION_FLAGS = new Set(["--version", "-v"]);

export function parseCliArgs(
  argv: string[],
  baseCwd = process.env.INIT_CWD ? resolve(process.env.INIT_CWD) : process.cwd()
): CliOptions {
  const [command, ...rest] = argv;

  if (!command || HELP_FLAGS.has(command) || command === "help") {
    return {
      command: "help",
      topic: parseHelpTopic(rest[0])
    };
  }

  if (VERSION_FLAGS.has(command) || command === "version") {
    return { command: "version" };
  }

  if (command === "repl") {
    if (rest.some((arg) => isHelpFlag(arg))) {
      return { command: "help", topic: "repl" };
    }
    return parseReplOptions(rest, baseCwd);
  }

  if (command === "doctor") {
    if (rest.some((arg) => isHelpFlag(arg))) {
      return { command: "help", topic: "doctor" };
    }
    return parseDoctorOptions(rest, baseCwd);
  }

  if (command === "setup") {
    if (rest.some((arg) => isHelpFlag(arg))) {
      return { command: "help", topic: "setup" };
    }
    return parseSetupOptions(rest, baseCwd);
  }

  if (command === "auth") {
    if (rest.some((arg) => isHelpFlag(arg))) {
      return { command: "help", topic: "auth" };
    }
    return parseAuthOptions(rest, baseCwd);
  }

  throw new Error(formatCliHelp("general"));
}

export function formatCliHelp(topic: HelpTopic = "general"): string {
  if (topic === "repl") {
    return [
      "Usage:",
      "  pi-dual repl [cwd] [--model-a MODEL] [--model-b MODEL] [--thinking-a LEVEL] [--thinking-b LEVEL] [--max-review-rounds N] [--timeout-ms N] [--agent-dir PATH] [--session-root PATH] [--mcp-config PATH]... [--no-mcp] [--no-session] [--plain] [--json-logs] [--verbose]",
      "",
      "Examples:",
      "  pi-dual repl . --model-a openai/gpt-5.4 --model-b lm-studio/qwen/qwen3.8-27b",
      "  npm run repl -- . --no-session",
      "",
      "Flags:",
      "  --model-a MODEL",
      "  --model-b MODEL",
      "  --thinking-a off|minimal|low|medium|high|xhigh",
      "  --thinking-b off|minimal|low|medium|high|xhigh",
      "  --max-review-rounds N",
      "  --timeout-ms N       total submission deadline; default 600000",
      "  --agent-dir PATH",
      "  --session-root PATH",
      "  --mcp-config PATH   repeatable",
      "  --no-mcp",
      "  --no-session",
      "  --plain",
      "  --json-logs",
      "  --verbose",
      ""
    ].join("\n");
  }

  if (topic === "doctor") {
    return [
      "Usage:",
      "  pi-dual doctor [cwd] [--model-a MODEL] [--model-b MODEL] [--agent-dir PATH] [--mcp-config PATH]... [--no-mcp]",
      "",
      "Examples:",
      "  pi-dual doctor . --model-a openai/gpt-5.4 --model-b lm-studio/qwen/qwen3.8-27b",
      "  npm run doctor -- . --model-b lm-studio/qwen3-coder-next",
      "",
      "The doctor command validates Node.js, your Pi config files, model overrides, and any MCP config paths before you launch the REPL.",
      ""
    ].join("\n");
  }

  if (topic === "setup") {
    return [
      "Usage:",
      "  pi-dual setup [cwd] [--agent-dir PATH]",
      "",
      "Examples:",
      "  pi-dual setup",
      "  pi-dual setup . --agent-dir ~/.pi/agent",
      "",
      "Setup verifies dummy-secret isolation, then opens a private macOS Keychain entry dialog for an OpenAI project API key. Run from a separate trusted installation.",
      ""
    ].join("\n");
  }

  if (topic === "auth") {
    return [
      "Usage:",
      "  pi-dual auth [cwd] [--agent-dir PATH]",
      "",
      "Examples:",
      "  pi-dual auth",
      "  pi-dual auth . --agent-dir ~/.pi/agent",
      "",
      "Auth reruns dummy isolation verification and private macOS Keychain entry for the project OpenAI API key. Unrelated credentials remain intact.",
      ""
    ].join("\n");
  }

  return [
    "pi-dual coordinator",
    "",
    "Usage:",
    "  pi-dual <command> [options]",
    "",
    "Commands:",
    "  setup     Guided first-run setup for auth and defaults",
    "  auth      Change or repair Agent A auth/defaults",
    "  repl      Start the interactive coordinator REPL",
    "  doctor    Check whether this machine is ready to run the coordinator",
    "  help      Show help",
    "  version   Show the installed version",
    "",
    "Run `pi-dual help repl`, `pi-dual help doctor`, `pi-dual help setup`, or `pi-dual help auth` for command-specific help.",
    ""
  ].join("\n");
}

function parseReplOptions(argv: string[], baseCwd: string): ReplCliOptions {
  const [maybeCwd, ...rest] = argv;
  const options: ReplCliOptions = {
    command: "repl",
    cwd: maybeCwd && !maybeCwd.startsWith("--") ? resolve(baseCwd, maybeCwd) : baseCwd,
    sessionMode: "persistent",
    jsonLogs: false,
    verbose: false,
    maxReviewRounds: 3,
    mcpEnabled: true,
    mcpConfigPaths: []
  };

  const args = normalizeArgs(maybeCwd, rest);

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) {
      continue;
    }

    switch (arg) {
      case "--model-a":
        options.modelA = requireValue(arg, args[++i]);
        break;
      case "--model-b":
        options.modelB = requireValue(arg, args[++i]);
        break;
      case "--thinking-a":
        options.thinkingA = parseThinking(arg, requireValue(arg, args[++i]));
        break;
      case "--thinking-b":
        options.thinkingB = parseThinking(arg, requireValue(arg, args[++i]));
        break;
      case "--timeout-ms":
        options.timeoutMs = parsePositiveInt(arg, requireValue(arg, args[++i]));
        if (options.timeoutMs > 2_147_483_647) throw new Error("Timeout exceeds the supported timer range.");
        break;
      case "--max-review-rounds":
        options.reviewRoundsExplicit = true;
        options.maxReviewRounds = parsePositiveInt(arg, requireValue(arg, args[++i]));
        break;
      case "--agent-dir":
        options.agentDir = resolve(baseCwd, requireValue(arg, args[++i]));
        break;
      case "--session-root":
        options.sessionRoot = resolve(baseCwd, requireValue(arg, args[++i]));
        break;
      case "--no-session":
        options.sessionMode = "memory";
        break;
      case "--plain":
        options.plainUi = true;
        break;
      case "--json-logs":
        options.jsonLogs = true;
        break;
      case "--verbose":
        options.verbose = true;
        break;
      case "--no-mcp":
        options.mcpEnabled = false;
        break;
      case "--mcp-config":
        (options.mcpConfigPaths ??= []).push(resolve(baseCwd, requireValue(arg, args[++i])));
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function parseDoctorOptions(argv: string[], baseCwd: string): DoctorCliOptions {
  const [maybeCwd, ...rest] = argv;
  const options: DoctorCliOptions = {
    command: "doctor",
    cwd: maybeCwd && !maybeCwd.startsWith("--") ? resolve(baseCwd, maybeCwd) : baseCwd,
    mcpEnabled: true,
    mcpConfigPaths: []
  };

  const args = normalizeArgs(maybeCwd, rest);

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) {
      continue;
    }

    switch (arg) {
      case "--model-a":
        options.modelA = requireValue(arg, args[++i]);
        break;
      case "--model-b":
        options.modelB = requireValue(arg, args[++i]);
        break;
      case "--agent-dir":
        options.agentDir = resolve(baseCwd, requireValue(arg, args[++i]));
        break;
      case "--no-mcp":
        options.mcpEnabled = false;
        break;
      case "--mcp-config":
        (options.mcpConfigPaths ??= []).push(resolve(baseCwd, requireValue(arg, args[++i])));
        break;
      default:
        throw new Error(`Unknown argument: ${arg}\n\n${formatCliHelp("doctor")}`);
    }
  }

  return options;
}

function parseSetupOptions(argv: string[], baseCwd: string): SetupCliOptions {
  const [maybeCwd, ...rest] = argv;
  const options: SetupCliOptions = {
    command: "setup",
    cwd: maybeCwd && !maybeCwd.startsWith("--") ? resolve(baseCwd, maybeCwd) : baseCwd
  };

  const args = normalizeArgs(maybeCwd, rest);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) {
      continue;
    }

    switch (arg) {
      case "--agent-dir":
        options.agentDir = resolve(baseCwd, requireValue(arg, args[++i]));
        break;
      default:
        throw new Error(`Unknown argument: ${arg}\n\n${formatCliHelp("setup")}`);
    }
  }

  return options;
}

function parseAuthOptions(argv: string[], baseCwd: string): AuthCliOptions {
  const [maybeCwd, ...rest] = argv;
  const options: AuthCliOptions = {
    command: "auth",
    cwd: maybeCwd && !maybeCwd.startsWith("--") ? resolve(baseCwd, maybeCwd) : baseCwd
  };

  const args = normalizeArgs(maybeCwd, rest);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) {
      continue;
    }

    switch (arg) {
      case "--agent-dir":
        options.agentDir = resolve(baseCwd, requireValue(arg, args[++i]));
        break;
      default:
        throw new Error(`Unknown argument: ${arg}\n\n${formatCliHelp("auth")}`);
    }
  }

  return options;
}

export function parseReplCommand(input: string): ParsedReplCommand {
  const trimmed = input.trim();
  if (!trimmed) {
    return { type: "user_turn", text: "" };
  }
  if (!trimmed.startsWith("/")) {
    return { type: "user_turn", text: trimmed };
  }
  if (trimmed === "/status") {
    return { type: "status" };
  }
  if (trimmed === "/approve") {
    return { type: "approve" };
  }
  if (trimmed === "/discard") {
    return { type: "discard" };
  }
  if (trimmed === "/help") {
    return { type: "help" };
  }
  if (trimmed === "/sessions") {
    return { type: "sessions" };
  }
  if (trimmed === "/handoff") {
    return { type: "handoff" };
  }
  if (trimmed === "/cancel") return { type: "cancel" };
  if (trimmed === "/quit") {
    return { type: "quit" };
  }

  const parts = trimmed.split(/\s+/);
  if (trimmed === "/history") return { type: "history" };
  if (parts[0] === "/inspect" && parts[1]) {
    const section = parts[2] ?? "output";
    const offset = Number(parts[3] ?? 0);
    if (!["summary", "request", "output", "metadata"].includes(section) || !Number.isSafeInteger(offset) || offset < 0 || parts.length > 4) throw new Error("Use /inspect ID summary|request|output|metadata [line offset].");
    if (section === "summary" || section === "request" || section === "output" || section === "metadata") return { type: "inspect", id: parts[1], section, offset };
  }
  const role = parts[1]?.toUpperCase();
  const save = parts.at(-1) === "save";
  if ((parts[0] === "/model" || parts[0] === "/thinking" || parts[0] === "/sessions") && (role === "A" || role === "B")) {
    if (parts[0] === "/sessions" && parts.length === 2) return { type: "sessions", role };
    const value = parts[2];
    if (parts[0] === "/model" && parts.length <= (save ? 4 : 3) && value !== "save") return { type: "model", role, save, ...(value ? { model: value } : {}) };
    if (parts[0] === "/thinking" && parts.length <= (save ? 4 : 3) && value !== "save") return { type: "thinking", role, save, ...(value ? { thinking: parseThinking("/thinking", value) } : {}) };
  }
  if (parts[0] === "/config" && (parts[1] === "review-rounds" || parts[1] === "timeout-ms") && parts[2] && parts.length === (save ? 4 : 3)) {
    return { type: "config", key: parts[1], value: parsePositiveInt("/config", parts[2]), save };
  }
  if (parts[0] === "/new" && parts.length === 1) return { type: "new_conversation" };
  if (parts[0] === "/new" && parts.length === 2 && parts[1] && isRole(parts[1])) {
    return { type: "new", role: parts[1].toUpperCase() as Role };
  }
  if (parts[0] === "/switch" && parts[1] && isRole(parts[1]) && parts[2]) {
    return {
      type: "switch",
      role: parts[1].toUpperCase() as Role,
      sessionPath: resolve(parts.slice(2).join(" "))
    };
  }

  throw new Error(`Unknown REPL command: ${trimmed}`);
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function parseThinking(flag: string, value: string): ReplThinkingLevel {
  if (!VALID_THINKING.has(value as ReplThinkingLevel)) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return value as ReplThinkingLevel;
}

function parsePositiveInt(flag: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function isRole(value: string): boolean {
  return value.toLowerCase() === "a" || value.toLowerCase() === "b";
}

function normalizeArgs(maybeCwd: string | undefined, rest: string[]): string[] {
  return maybeCwd && !maybeCwd.startsWith("--")
    ? rest
    : ([maybeCwd, ...rest].filter(Boolean) as string[]);
}

function isHelpFlag(value: string | undefined): boolean {
  return value !== undefined && HELP_FLAGS.has(value);
}

function parseHelpTopic(value: string | undefined): HelpTopic {
  if (
    value === "repl" ||
    value === "doctor" ||
    value === "setup" ||
    value === "auth"
  ) {
    return value;
  }
  return "general";
}

export const REPL_COMPLETION_COMMANDS = [
  { name: "history", description: "Read retained turns, runs and calls" },
  { name: "inspect", description: "Read detail: /inspect ID [section] [line offset]" },
  { name: "help", description: "Show commands" }, { name: "status", description: "Show state" },
  { name: "approve", description: "Execute the pending plan" }, { name: "discard", description: "Clear pending plan" },
  { name: "cancel", description: "Cancel active work" }, { name: "quit", description: "Cancel and exit" },
  { name: "sessions", description: "Saved sessions: /sessions A|B" }, { name: "handoff", description: "Latest workflow" },
  { name: "new", description: "New conversation: /new; one role: /new A|B" }, { name: "switch", description: "Restore context: /switch A|B PATH" },
  { name: "model", description: "Choose model: /model A|B [MODEL] [save]" },
  { name: "thinking", description: "Choose reasoning: /thinking A|B [LEVEL] [save]" },
  { name: "config", description: "Defaults: /config review-rounds|timeout-ms N [save]" }
];
