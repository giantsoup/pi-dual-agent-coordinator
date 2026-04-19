import { resolve } from "node:path";

import type { Role } from "../types/role.js";

export type ReplThinkingLevel = "off" | "low" | "medium" | "high";

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
}

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

export function parseCliArgs(
  argv: string[],
  baseCwd = process.env.INIT_CWD ? resolve(process.env.INIT_CWD) : process.cwd()
): ReplCliOptions {
  const [command, maybeCwd, ...rest] = argv;

  if (command !== "repl") {
    throw new Error("Usage: pi-dual repl [cwd] [--model-a MODEL] [--model-b MODEL] [--thinking-a LEVEL] [--thinking-b LEVEL] [--max-review-rounds N] [--agent-dir PATH] [--session-root PATH] [--no-session] [--json-logs] [--verbose]");
  }

  const options: ReplCliOptions = {
    command: "repl",
    cwd: maybeCwd && !maybeCwd.startsWith("--") ? resolve(baseCwd, maybeCwd) : baseCwd,
    sessionMode: "persistent",
    jsonLogs: false,
    verbose: false,
    maxReviewRounds: 3
  };

  const args = maybeCwd && !maybeCwd.startsWith("--") ? rest : [maybeCwd, ...rest].filter(Boolean) as string[];

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
      default:
        throw new Error(`Unknown argument: ${arg}`);
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
