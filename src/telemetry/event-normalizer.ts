import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

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
    case "message_update":
      return { assistantEventType: event.assistantMessageEvent.type };
    case "turn_end":
      return { stopReason: event.message.role === "assistant" ? event.message.stopReason : undefined };
    case "tool_execution_start":
    case "tool_execution_update":
    case "tool_execution_end":
      return { toolName: event.toolName };
    case "queue_update":
      return { steering: event.steering.length, followUp: event.followUp.length };
    default:
      return {};
  }
}
