import { resolve } from "node:path";

import type { Role } from "../types/role.js";

export type ReplThinkingLevel = "off" | "low" | "medium" | "high";
export type HelpTopic = "general" | "repl" | "doctor";

export interface ReplCliOptions {
  command: "repl";
  cwd: string;
  agentDir?: string;
  sessionRoot?: string;
  sessionMode: "persistent" | "memory";
  jsonLogs: boolean;
  verbose: boolean;
  modelA?: string;
  modelB?: string;
  thinkingA?: ReplThinkingLevel;
  thinkingB?: ReplThinkingLevel;
  maxReviewRounds: number;
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
  | HelpCliOptions
  | VersionCliOptions;

export type ParsedReplCommand =
  | { type: "user_turn"; text: string }
  | { type: "help" }
  | { type: "status" }
  | { type: "approve" }
  | { type: "discard" }
  | { type: "sessions" }
  | { type: "handoff" }
  | { type: "new"; role: Role }
  | { type: "switch"; role: Role; sessionPath: string }
  | { type: "quit" };

const VALID_THINKING = new Set<ReplThinkingLevel>(["off", "low", "medium", "high"]);
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

  throw new Error(formatCliHelp("general"));
}

export function formatCliHelp(topic: HelpTopic = "general"): string {
  if (topic === "repl") {
    return [
      "Usage:",
      "  pi-dual repl [cwd] [--model-a MODEL] [--model-b MODEL] [--thinking-a LEVEL] [--thinking-b LEVEL] [--max-review-rounds N] [--agent-dir PATH] [--session-root PATH] [--mcp-config PATH]... [--no-mcp] [--no-session] [--json-logs] [--verbose]",
      "",
      "Examples:",
      "  pi-dual repl . --model-a openai/gpt-5.4 --model-b local-qwen/qwen3-coder-next",
      "  npm run repl -- . --no-session",
      "",
      "Flags:",
      "  --model-a MODEL",
      "  --model-b MODEL",
      "  --thinking-a off|low|medium|high",
      "  --thinking-b off|low|medium|high",
      "  --max-review-rounds N",
      "  --agent-dir PATH",
      "  --session-root PATH",
      "  --mcp-config PATH   repeatable",
      "  --no-mcp",
      "  --no-session",
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
      "  pi-dual doctor . --model-a openai/gpt-5.4 --model-b local-qwen/qwen3-coder-next",
      "  npm run doctor -- . --model-b local-qwen/qwen3-coder-next",
      "",
      "The doctor command validates Node.js, your Pi config files, model overrides, and any MCP config paths before you launch the REPL.",
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
    "  repl      Start the interactive coordinator REPL",
    "  doctor    Check whether this machine is ready to run the coordinator",
    "  help      Show help",
    "  version   Show the installed version",
    "",
    "Run `pi-dual help repl` or `pi-dual help doctor` for command-specific help.",
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
      case "--max-review-rounds":
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
  if (trimmed === "/quit") {
    return { type: "quit" };
  }

  const parts = trimmed.split(/\s+/);
  if (parts[0] === "/new" && parts[1] && isRole(parts[1])) {
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
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
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
  if (value === "repl" || value === "doctor") {
    return value;
  }
  return "general";
}
