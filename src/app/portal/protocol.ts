import type { InteractiveUiState, UiAction, UiEvent } from "../../types/ui.js";
import type { UserNotice } from "../presentation/notices.js";

export const INTERACTIVE_PORTAL_PROTOCOL_VERSION = 1;

export interface PortalBootstrapConfigDto {
  protocolVersion: typeof INTERACTIVE_PORTAL_PROTOCOL_VERSION;
  authToken: string;
  controllerId: string;
  launchUrl: string;
  host: string;
  port: number;
  localOnly: true;
  startupMessage: string;
  startupNotice: UserNotice;
}

export interface PortalControllerLockSnapshot {
  controllerId?: string | undefined;
  locked: boolean;
}

export interface PortalStateSnapshotDto {
  protocolVersion: typeof INTERACTIVE_PORTAL_PROTOCOL_VERSION;
  lastEventId: number;
  state: InteractiveUiState;
  controller: PortalControllerLockSnapshot;
}

export interface PortalActionRequestDto {
  controllerId: string;
  action: UiAction;
}

export interface PortalActionResponseDto {
  protocolVersion: typeof INTERACTIVE_PORTAL_PROTOCOL_VERSION;
  lastEventId: number;
  accepted: boolean;
  state: InteractiveUiState;
  error?: string | undefined;
  controller: PortalControllerLockSnapshot;
}

export interface PortalStreamEventDto {
  protocolVersion: typeof INTERACTIVE_PORTAL_PROTOCOL_VERSION;
  eventId: number;
  sentAt: string;
  event: UiEvent;
  controller: PortalControllerLockSnapshot;
}

export function createPortalBootstrapConfigDto(input: {
  authToken: string;
  controllerId: string;
  launchUrl?: string;
  host?: string;
  port?: number;
  localOnly?: true;
  startupMessage?: string;
  startupNotice?: UserNotice;
}): PortalBootstrapConfigDto {
  const launchUrl = input.launchUrl ?? "http://127.0.0.1/";
  const parsedLaunchUrl = safeParseUrl(launchUrl);

  return {
    protocolVersion: INTERACTIVE_PORTAL_PROTOCOL_VERSION,
    authToken: input.authToken,
    controllerId: input.controllerId,
    launchUrl,
    host: input.host ?? parsedLaunchUrl?.hostname ?? "127.0.0.1",
    port:
      input.port ??
      (parsedLaunchUrl?.port ? Number.parseInt(parsedLaunchUrl.port, 10) || 0 : 0),
    localOnly: input.localOnly ?? true,
    startupMessage: input.startupMessage ?? "",
    startupNotice:
      input.startupNotice ??
      {
        scope: "startup",
        title: "PI Dual web interface is ready",
        message: `Open this link in any browser on this computer: ${launchUrl}`,
        nextStep:
          "If the link does not open automatically, copy and paste it into a local browser."
      }
  };
}

export function serializeInteractiveUiState(
  state: InteractiveUiState
): InteractiveUiState {
  return structuredClone(state);
}

export function serializeUiEvent(event: UiEvent): UiEvent {
  return structuredClone(event);
}

export function serializePortalControllerLockSnapshot(
  controller: PortalControllerLockSnapshot
): PortalControllerLockSnapshot {
  return structuredClone(controller);
}

export function createPortalStateSnapshotDto(
  state: InteractiveUiState,
  controller: PortalControllerLockSnapshot,
  lastEventId: number
): PortalStateSnapshotDto {
  return {
    protocolVersion: INTERACTIVE_PORTAL_PROTOCOL_VERSION,
    lastEventId,
    state: serializeInteractiveUiState(state),
    controller: serializePortalControllerLockSnapshot(controller)
  };
}

export function createPortalActionResponseDto(input: {
  accepted: boolean;
  state: InteractiveUiState;
  controller: PortalControllerLockSnapshot;
  lastEventId: number;
  error?: string | undefined;
}): PortalActionResponseDto {
  return {
    protocolVersion: INTERACTIVE_PORTAL_PROTOCOL_VERSION,
    lastEventId: input.lastEventId,
    accepted: input.accepted,
    state: serializeInteractiveUiState(input.state),
    controller: serializePortalControllerLockSnapshot(input.controller),
    ...(input.error ? { error: input.error } : {})
  };
}

export function createPortalStreamEventDto(
  event: UiEvent,
  controller: PortalControllerLockSnapshot,
  eventId: number,
  sentAt = new Date().toISOString()
): PortalStreamEventDto {
  return {
    protocolVersion: INTERACTIVE_PORTAL_PROTOCOL_VERSION,
    eventId,
    sentAt,
    event: serializeUiEvent(event),
    controller: serializePortalControllerLockSnapshot(controller)
  };
}

export function parsePortalActionRequestDto(value: unknown): PortalActionRequestDto {
  const record = requireRecord(value, "Portal action request body");
  const controllerId = requireString(record.controllerId, "controllerId");
  return {
    controllerId,
    action: parseUiAction(record.action)
  };
}

function parseUiAction(value: unknown): UiAction {
  const record = requireRecord(value, "action");
  const type = requireString(record.type, "action.type");

  switch (type) {
    case "submit_input":
      return {
        type,
        input: requireString(record.input, "action.input")
      };
    case "run_repl_command":
      return {
        type,
        command: parseReplCommand(record.command)
      };
    case "open_help":
    case "open_status":
    case "open_sessions":
    case "open_handoff":
    case "approve_pending_plan":
    case "discard_pending_plan":
    case "close_modal":
    case "quit":
      return { type };
    case "set_command_palette":
      return {
        type,
        open: requireBoolean(record.open, "action.open")
      };
    case "replace_runtime": {
      const role = parseRole(record.role, "action.role");
      const mode = parseReplaceRuntimeMode(record.mode);
      return mode === "new"
        ? {
            type,
            role,
            mode
          }
        : {
            type,
            role,
            mode,
            sessionPath: requireString(record.sessionPath, "action.sessionPath")
          };
    }
    default:
      throw new Error(`Unsupported action type: ${type}`);
  }
}

function safeParseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function parseReplCommand(
  value: unknown
): Extract<UiAction, { type: "run_repl_command" }>["command"] {
  const record = requireRecord(value, "action.command");
  const type = requireString(record.type, "action.command.type");

  switch (type) {
    case "user_turn":
      return {
        type,
        text: requireString(record.text, "action.command.text")
      };
    case "help":
    case "status":
    case "approve":
    case "discard":
    case "sessions":
    case "handoff":
    case "quit":
      return { type };
    case "new":
      return {
        type,
        role: parseRole(record.role, "action.command.role")
      };
    case "switch":
      return {
        type,
        role: parseRole(record.role, "action.command.role"),
        sessionPath: requireString(record.sessionPath, "action.command.sessionPath")
      };
    default:
      throw new Error(`Unsupported command type: ${type}`);
  }
}

function parseRole(value: unknown, label: string): "A" | "B" {
  if (value === "A" || value === "B") {
    return value;
  }
  throw new Error(`${label} must be "A" or "B".`);
}

function parseReplaceRuntimeMode(value: unknown): "new" | "switch" {
  if (value === "new" || value === "switch") {
    return value;
  }
  throw new Error('action.mode must be "new" or "switch".');
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }
  return value;
}
