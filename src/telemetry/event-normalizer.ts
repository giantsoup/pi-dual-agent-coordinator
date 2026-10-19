import { redactText, redactValue } from "../security/redact.js";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import { sanitizeToolArgs, summarizeToolActivity } from "../app/activity-summary.js";
import type { NormalizedTelemetryEvent } from "../types/telemetry.js";
import type { Role } from "../types/role.js";
import { CorrelationState } from "./correlation.js";

export interface NormalizeEventOptions {
  role: Role;
  sessionId: string;
  sessionFile?: string | undefined;
  event: AgentSessionEvent;
  requestId?: string | undefined;
  leafId?: string | null | undefined;
  handoffId?: string | undefined;
  correlation: CorrelationState;
}

export function normalizeEvent(
  options: NormalizeEventOptions
): NormalizedTelemetryEvent {
  const sessionKey = `${options.role}:${options.sessionId}`;
  const turnIndex =
    options.event.type === "turn_end"
      ? options.correlation.observeTurnEnd(sessionKey)
      : options.correlation.getTurnIndex(sessionKey);

  return {
    requestId: options.requestId,
    role: options.role,
    sessionId: options.sessionId,
    sessionFile: options.sessionFile,
    eventType: `pi.${options.event.type}`,
    timestamp: new Date().toISOString(),
    leafId: options.leafId ?? undefined,
    turnIndex,
    handoffId: options.handoffId,
    details: normalizeEventDetails(options.event)
  };
}

export function normalizeLifecycleEvent(options: {
  role: Role;
  sessionId: string;
  sessionFile?: string | undefined;
  eventType: string;
  requestId?: string | undefined;
  details?: Record<string, unknown> | undefined;
}): NormalizedTelemetryEvent {
  return {
    requestId: options.requestId,
    role: options.role,
    sessionId: options.sessionId,
    sessionFile: options.sessionFile,
    eventType: options.eventType,
    timestamp: new Date().toISOString(),
    details: options.details ?? {}
  };
}

function normalizeEventDetails(event: AgentSessionEvent): Record<string, unknown> {
  switch (event.type) {
    case "message_end":
      return { messageRole: event.message.role };
    case "message_update": {
      const details: Record<string, unknown> = {
        assistantEventType: event.assistantMessageEvent.type
      };

      if (event.assistantMessageEvent.type === "toolcall_delta") {
        details.deltaPreview = sanitizePreview(event.assistantMessageEvent.delta);
      }

      if (event.assistantMessageEvent.type === "toolcall_end") {
        details.deltaPreview = sanitizePreview(
          JSON.stringify(
            sanitizeToolArgs(
              event.assistantMessageEvent.toolCall.name,
              event.assistantMessageEvent.toolCall.arguments
            )
          )
        );
        details.toolCallName = event.assistantMessageEvent.toolCall.name;
        details.toolCallArgsPreview = truncatePreview(
          JSON.stringify(
            sanitizeToolArgs(
              event.assistantMessageEvent.toolCall.name,
              event.assistantMessageEvent.toolCall.arguments
            )
          )
        );
      }

      return details;
    }
    case "turn_end":
      return { stopReason: event.message.role === "assistant" ? event.message.stopReason : undefined };
    case "tool_execution_start": {
      const summary = summarizeToolActivity(event.toolName, event.args);
      return {
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        toolArgs: safeToolArgs(event.toolName, event.args),
        activityPreview: summary.target
          ? `${summary.label} ${summary.target}`
          : summary.label
      };
    }
    case "tool_execution_update":
      return {
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        toolArgs: safeToolArgs(event.toolName, event.args),
        partialResultPreview: extractResultPreview(event.partialResult),
        streamState: "streaming"
      };
    case "tool_execution_end":
      return {
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        isError: event.isError,
        resultPreview: extractResultPreview(event.result)
      };
    case "queue_update":
      return { steering: event.steering.length, followUp: event.followUp.length };
    default:
      return {};
  }
}

function extractResultPreview(result: unknown): string | undefined {
  if (!isRecord(result)) {
    return undefined;
  }
  const content = result.content;
  if (!Array.isArray(content)) {
    return undefined;
  }

  const text = content
    .filter((item): item is { type: string; text?: unknown } => isRecord(item) && item.type === "text")
    .map((item) => (typeof item.text === "string" ? item.text : ""))
    .join(" ")
    .trim();

  return truncatePreview(text);
}

function truncatePreview(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  return value.length <= 120 ? value : `${value.slice(0, 117)}...`;
}

function sanitizePreview(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  return truncatePreview(
    value
      .replace(/(--api-key)(=|\s+)([^\s]+)/gi, "$1$2[REDACTED]")
      .replace(/(--token)(=|\s+)([^\s]+)/gi, "$1$2[REDACTED]")
      .replace(/(Authorization:\s*(?:Bearer\s+)?)([^\s]+)/gi, "$1[REDACTED]")
      .replace(/(OPENAI_API_KEY=)([^\s]+)/gi, "$1[REDACTED]")
      .replace(/(ANTHROPIC_API_KEY=)([^\s]+)/gi, "$1[REDACTED]")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeToolArgs(name: string, args: unknown): Record<string, unknown> {
  const safe = sanitizeToolArgs(name, args);
  if (isRecord(args) && typeof args.path === "string") safe.path = redactText(args.path);
  return redactValue(safe);
}
