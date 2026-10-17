import { homedir } from "node:os";
import { isAbsolute, relative } from "node:path";

import type { CoordinatorStatusSnapshot, CoordinatorUiPhase } from "../types/status.js";
import type { Role } from "../types/role.js";
import type { NormalizedTelemetryEvent } from "../types/telemetry.js";

export interface ActivitySnapshot {
  role: Role | "coordinator";
  phase: CoordinatorUiPhase;
  kind: "thinking" | "tool" | "workflow" | "repair" | "planning" | "idle";
  label: string;
  target?: string | undefined;
  reason?: string | undefined;
  toolName?: string | undefined;
  workflowId?: string | undefined;
  iteration?: number | undefined;
  startedAt: string;
}

export interface ActivityUpdate {
  role: ActivitySnapshot["role"];
  snapshot?: ActivitySnapshot | undefined;
  clear?: boolean | undefined;
}

export type SanitizedToolArgs = Record<string, unknown>;

export interface ToolSummary {
  label: string;
  target?: string | undefined;
  toolName: string;
}

export function deriveActivityUpdate(
  event: NormalizedTelemetryEvent,
  status: CoordinatorStatusSnapshot
): ActivityUpdate | undefined {
  if (event.eventType === "pi.turn_end") {
    return { role: event.role, clear: true };
  }

  if (event.eventType === "pi.message_update") {
    return deriveMessageUpdate(event, status);
  }

  if (event.eventType === "pi.tool_execution_start") {
    return buildToolUpdate(event, status, false);
  }

  if (event.eventType === "pi.tool_execution_end") {
    return buildToolUpdate(event, status, true);
  }

  if (event.eventType.startsWith("workflow.")) {
    return deriveWorkflowUpdate(event, status);
  }

  if (event.eventType.startsWith("planning.")) {
    return derivePlanningUpdate(event, status);
  }

  return undefined;
}

export function sanitizeToolArgs(
  toolName: string,
  args: unknown,
  cwd?: string
): SanitizedToolArgs {
  const source = isRecord(args) ? args : {};

  switch (toolName) {
    case "read":
    case "write":
      return { path: sanitizePath(source.path, cwd) };
    case "edit": {
      const path = sanitizePath(source.path, cwd);
      const edits = Array.isArray(source.edits) ? source.edits.length : undefined;
      return { path, edits };
    }
    case "grep":
      return {
        pattern: sanitizePattern(source.pattern),
        path: sanitizePath(source.path, cwd)
      };
    case "find":
      return {
        pattern: sanitizePattern(source.pattern),
        path: sanitizePath(source.path, cwd)
      };
    case "ls":
      return { path: sanitizePath(source.path, cwd) };
    case "bash":
      return { command: sanitizeCommandPreview(source.command) };
    default:
      return sanitizeGenericArgs(source, cwd);
  }
}

export function summarizeToolActivity(
  toolName: string,
  args: unknown,
  cwd?: string
): ToolSummary {
  const sanitized = sanitizeToolArgs(toolName, args, cwd);

  switch (toolName) {
    case "read":
      return {
        label: "reading",
        target: stringValue(sanitized.path) ?? "(unknown path)",
        toolName
      };
    case "grep": {
      const pattern = stringValue(sanitized.pattern) ?? "(pattern)";
      const path = stringValue(sanitized.path) ?? ".";
      return {
        label: `grepping "${pattern}" in`,
        target: path,
        toolName
      };
    }
    case "find": {
      const pattern = stringValue(sanitized.pattern) ?? "(pattern)";
      const path = stringValue(sanitized.path) ?? ".";
      return {
        label: `finding ${pattern} under`,
        target: path,
        toolName
      };
    }
    case "ls":
      return {
        label: "listing",
        target: stringValue(sanitized.path) ?? ".",
        toolName
      };
    case "bash":
      return {
        label: "running",
        target: stringValue(sanitized.command) ?? "(command)",
        toolName
      };
    case "write":
      return {
        label: "writing",
        target: stringValue(sanitized.path) ?? "(unknown path)",
        toolName
      };
    case "edit":
      return {
        label: "editing",
        target: stringValue(sanitized.path) ?? "(unknown path)",
        toolName
      };
    default:
      return {
        label: `running ${toolName}`,
        toolName
      };
  }
}

interface McpToolSummary {
  label: string;
  target: string;
}

export function renderActivityText(snapshot: ActivitySnapshot): string {
  if (!snapshot.target) {
    return snapshot.label;
  }
  return `${snapshot.label} ${snapshot.target}`;
}

export function renderReasonText(snapshot: ActivitySnapshot): string | undefined {
  return snapshot.reason;
}

function deriveMessageUpdate(
  event: NormalizedTelemetryEvent,
  status: CoordinatorStatusSnapshot
): ActivityUpdate | undefined {
  const assistantEventType = event.details.assistantEventType;
  if (assistantEventType !== "text_delta" && assistantEventType !== "thinking_delta") {
    return undefined;
  }

  const snapshot = createReasoningSnapshot(event.role, status.phase, {
    timestamp: event.timestamp,
    workflowId: stringValue(event.details.workflowId),
    iteration: numberValue(event.details.iteration) ?? status.currentIteration
  });

  return snapshot ? { role: event.role, snapshot } : undefined;
}

function buildToolUpdate(
  event: NormalizedTelemetryEvent,
  status: CoordinatorStatusSnapshot,
  finished: boolean
): ActivityUpdate | undefined {
  const toolName = stringValue(event.details.toolName);
  if (!toolName) {
    return undefined;
  }

  const runtimeStatus = findRuntimeStatus(status, event.role);
  const mcpSummary = summarizeMcpToolActivity(toolName, event.details.toolArgs, status, event.role);
  const summary = mcpSummary ?? summarizeToolActivity(toolName, event.details.toolArgs, status.cwd);
  const sanitizedArgs = sanitizeToolArgs(toolName, event.details.toolArgs, status.cwd);
  const reason = selectToolReason({
    phase: status.phase,
    toolName,
    command: stringValue(sanitizedArgs.command) ?? runtimeStatus?.currentTarget
  });
  const target =
    summary.target && !summary.target.startsWith("(")
      ? summary.target
      : runtimeStatus?.currentTarget ?? summary.target;

  return {
    role: event.role,
    snapshot: {
      role: event.role,
      phase: status.phase,
      kind: status.phase === "repair" ? "repair" : "tool",
      label: finished
        ? mcpSummary
          ? "finished MCP tool:"
          : `finished ${summary.label}`
        : mcpSummary
          ? "MCP tool running:"
          : summary.label,
      target,
      reason,
      toolName,
      workflowId: stringValue(event.details.workflowId),
      iteration: numberValue(event.details.iteration) ?? status.currentIteration,
      startedAt: event.timestamp
    }
  };
}

function deriveWorkflowUpdate(
  event: NormalizedTelemetryEvent,
  status: CoordinatorStatusSnapshot
): ActivityUpdate | undefined {
  const iteration = numberValue(event.details.iteration);
  const workflowId = stringValue(event.details.workflowId);

  switch (event.eventType) {
    case "workflow.check_in_started":
    case "workflow.check_in_completed":
    case "workflow.check_in_failed":
      return {
        role: "coordinator",
        snapshot: {
          role: "coordinator", phase: "review", kind: "workflow",
          label: event.eventType === "workflow.check_in_started" ? "Agent A checking execution progress" : event.details.decision === "blocked" ? "Agent A blocked execution" : event.eventType === "workflow.check_in_completed" ? "Agent A completed process check-in" : "Agent A process check-in stopped execution",
          reason: stringValue(event.details.reason) ?? "checking for loops and drift while Agent B is paused",
          workflowId, iteration, startedAt: event.timestamp
        }
      };
    case "workflow.iteration_prepared":
      return {
        role: "coordinator",
        snapshot: {
          role: "coordinator",
          phase: status.phase,
          kind: "workflow",
          label: `prepared iteration ${iteration ?? 1} for Agent B`,
          reason: "sending the next handoff to Agent B",
          workflowId,
          iteration,
          startedAt: event.timestamp
        }
      };
    case "workflow.iteration_delivered":
      return {
        role: "coordinator",
        snapshot: {
          role: "coordinator",
          phase: status.phase,
          kind: "workflow",
          label: `delivered iteration ${iteration ?? 1} to Agent B`,
          reason: "sending the next handoff to Agent B",
          workflowId,
          iteration,
          startedAt: event.timestamp
        }
      };
    case "workflow.repair_requested":
      return {
        role: "coordinator",
        snapshot: {
          role: "coordinator",
          phase: "repair",
          kind: "repair",
          label: `requesting repair from Agent ${event.role}`,
          reason:
            "requesting a repair because the expected machine block was missing or invalid",
          workflowId,
          iteration,
          startedAt: event.timestamp
        }
      };
    case "workflow.finalized": {
      const decision = stringValue(event.details.decision);
      return {
        role: "coordinator",
        snapshot: {
          role: "coordinator",
          phase: status.phase,
          kind: "workflow",
          label: decision === "blocked" ? "blocked the workflow" : "approved the workflow",
          reason:
            decision === "blocked"
              ? undefined
              : "finalizing the workflow after Agent A approved completion",
          workflowId,
          iteration,
          startedAt: event.timestamp
        }
      };
    }
    case "workflow.blocked":
      return {
        role: "coordinator",
        snapshot: {
          role: "coordinator",
          phase: "repair",
          kind: "workflow",
          label: "blocked the workflow",
          workflowId,
          iteration,
          startedAt: event.timestamp
        }
      };
    case "workflow.capped":
      return {
        role: "coordinator",
        snapshot: {
          role: "coordinator",
          phase: status.phase,
          kind: "workflow",
          label: "hit the review cap",
          workflowId,
          iteration,
          startedAt: event.timestamp
        }
      };
    default:
      return undefined;
  }
}

function summarizeMcpToolActivity(
  toolName: string,
  args: unknown,
  status: CoordinatorStatusSnapshot,
  role: Role
): McpToolSummary | undefined {
  const roleMcp = role === "A" ? status.mcp?.roleA : status.mcp?.roleB;
  if (!roleMcp?.enabled) {
    return undefined;
  }

  if (toolName === "mcp") {
    const source = isRecord(args) ? args : {};
    const action = stringValue(source.action) ?? "call";
    const canonicalTarget =
      stringValue(source.tool) ??
      stringValue(source.prompt) ??
      stringValue(source.server) ??
      stringValue(source.uri);
    return {
      label: "MCP tool running:",
      target: canonicalTarget ? `mcp ${action} ${canonicalTarget}` : `mcp ${action}`
    };
  }

  const server = roleMcp.servers.find((entry) => entry.directTools.includes(toolName));
  if (!server) {
    return undefined;
  }

  return {
    label: "MCP tool running:",
    target: formatDirectMcpToolTarget(server.name, toolName)
  };
}

function formatDirectMcpToolTarget(serverName: string, toolName: string): string {
  const prefixedName = `${serverName}__`;
  if (toolName.startsWith(prefixedName)) {
    return `${serverName}/${toolName.slice(prefixedName.length)}`;
  }
  return `${serverName}/${toolName}`;
}

function derivePlanningUpdate(
  event: NormalizedTelemetryEvent,
  _status: CoordinatorStatusSnapshot
): ActivityUpdate | undefined {
  switch (event.eventType) {
    case "planning.plan_ready":
      return {
        role: "coordinator",
        snapshot: {
          role: "coordinator",
          phase: "planning",
          kind: "planning",
          label: "prepared a plan for approval",
          reason: "the plan is ready for operator approval before starting Agent B",
          startedAt: event.timestamp
        }
      };
    case "planning.plan_approved":
      return {
        role: "coordinator",
        snapshot: {
          role: "coordinator",
          phase: "planning",
          kind: "planning",
          label: "approved the pending plan and is starting Agent B",
          startedAt: event.timestamp
        }
      };
    case "planning.plan_discarded":
      return {
        role: "coordinator",
        snapshot: {
          role: "coordinator",
          phase: "planning",
          kind: "planning",
          label: "discarded the pending plan",
          startedAt: event.timestamp
        }
      };
    default:
      return undefined;
  }
}

function createReasoningSnapshot(
  role: Role,
  phase: CoordinatorUiPhase,
  options: {
    timestamp: string;
    workflowId?: string | undefined;
    iteration?: number | undefined;
  }
): ActivitySnapshot | undefined {
  switch (phase) {
    case "planning":
      return {
        role,
        phase,
        kind: "thinking",
        label: "inspecting the codebase",
        reason: "inspecting the codebase before deciding whether execution is necessary",
        workflowId: options.workflowId,
        iteration: options.iteration,
        startedAt: options.timestamp
      };
    case "execution":
      return {
        role,
        phase,
        kind: "thinking",
        label: "gathering local context",
        reason: "gathering local context before making changes",
        workflowId: options.workflowId,
        iteration: options.iteration,
        startedAt: options.timestamp
      };
    case "review":
      return {
        role,
        phase,
        kind: "thinking",
        label: `reviewing iteration ${options.iteration ?? 1}`,
        reason:
          "reviewing Agent B's completed iteration before deciding whether to finalize or hand off another revision",
        workflowId: options.workflowId,
        iteration: options.iteration,
        startedAt: options.timestamp
      };
    case "repair":
      return {
        role,
        phase,
        kind: "repair",
        label: "repairing the workflow response",
        reason: "correcting a malformed workflow response to restore the coordinator loop",
        workflowId: options.workflowId,
        iteration: options.iteration,
        startedAt: options.timestamp
      };
  }
}

function selectToolReason(options: {
  phase: CoordinatorUiPhase;
  toolName: string;
  command?: string | undefined;
}): string | undefined {
  if (options.phase === "repair") {
    return "correcting a malformed workflow response to restore the coordinator loop";
  }

  if (isMachineBlockPseudoTool(options.toolName)) {
    return "machine blocks must be emitted as fenced assistant text, not invoked as tools";
  }

  if (options.phase === "review") {
    return "reviewing Agent B's completed iteration before deciding whether to finalize or hand off another revision";
  }

  if (options.phase === "planning") {
    if (isFileInspectionTool(options.toolName)) {
      return "reading the relevant files before proposing a concrete change";
    }
    return "inspecting the codebase before deciding whether execution is necessary";
  }

  if (options.phase !== "execution") {
    return undefined;
  }

  if (isVerificationTool(options.toolName, options.command)) {
    return "running focused verification after changes";
  }

  if (isFileInspectionTool(options.toolName)) {
    return "verifying the target area before editing";
  }

  return undefined;
}

function isFileInspectionTool(toolName: string): boolean {
  return toolName === "read" || toolName === "grep" || toolName === "find" || toolName === "ls";
}

function isVerificationTool(toolName: string, command?: string): boolean {
  if (toolName !== "bash" || !command) {
    return false;
  }
  return /\b(test|tests|vitest|jest|pytest|check|lint|verify|build)\b/i.test(command);
}

function isMachineBlockPseudoTool(toolName: string): boolean {
  return (
    toolName === "pi-plan" ||
    toolName === "pi-execute" ||
    toolName === "pi-handoff" ||
    toolName === "pi-completion" ||
    toolName === "pi-final"
  );
}

function sanitizeGenericArgs(args: Record<string, unknown>, cwd?: string): SanitizedToolArgs {
  const sanitized: SanitizedToolArgs = {};
  for (const [key, value] of Object.entries(args)) {
    if (key === "content" || key === "newText" || key === "oldText" || key === "replacement") {
      continue;
    }
    if (typeof value === "string") {
      sanitized[key] = key.toLowerCase().includes("path")
        ? sanitizePath(value, cwd)
        : truncate(redactSecrets(value), 60);
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function sanitizePath(value: unknown, cwd?: string): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const raw = redactSecrets(value.trim());
  let display = raw;

  if (cwd && isAbsolute(raw)) {
    const relativePath = relative(cwd, raw);
    if (relativePath && !relativePath.startsWith("..") && !isAbsolute(relativePath)) {
      display = relativePath || ".";
    } else {
      const home = homedir();
      if (raw === home) {
        display = "~";
      } else if (raw.startsWith(`${home}/`)) {
        display = `~/${raw.slice(home.length + 1)}`;
      }
    }
  }

  return middleTruncate(display, 60);
}

function sanitizePattern(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  return truncate(redactSecrets(value.trim()), 40);
}

function sanitizeCommandPreview(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  return truncate(redactSecrets(value.trim()), 60);
}

function redactSecrets(value: string): string {
  return value
    .replace(/(--api-key)(=|\s+)([^\s]+)/gi, "$1$2[REDACTED]")
    .replace(/(--token)(=|\s+)([^\s]+)/gi, "$1$2[REDACTED]")
    .replace(/(Authorization:\s*(?:Bearer\s+)?)([^\s]+)/gi, "$1[REDACTED]")
    .replace(/(OPENAI_API_KEY=)([^\s]+)/gi, "$1[REDACTED]")
    .replace(/(ANTHROPIC_API_KEY=)([^\s]+)/gi, "$1[REDACTED]");
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, Math.max(0, max - 3))}...`;
}

function middleTruncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  const left = Math.max(1, Math.ceil((max - 3) / 2));
  const right = Math.max(1, Math.floor((max - 3) / 2));
  return `${value.slice(0, left)}...${value.slice(value.length - right)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function findRuntimeStatus(
  status: CoordinatorStatusSnapshot,
  role: Role
): CoordinatorStatusSnapshot["runtimes"][number] | undefined {
  return status.runtimes.find((runtime) => runtime.role === role);
}
