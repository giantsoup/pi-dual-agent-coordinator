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
    case "close_settings":
    case "close_modal":
    case "quit":
      return { type };
    case "select_thread":
      return {
        type,
        threadId: requireString(record.threadId, "action.threadId")
      };
    case "launch_project_thread":
      return {
        type,
        projectPath: requireString(record.projectPath, "action.projectPath")
      };
    case "open_settings":
      return {
        type,
        ...(record.scope !== undefined
          ? {
              scope: parseSettingsScope(record.scope)
            }
          : {})
      };
    case "save_settings":
      return {
        type,
        scope: parseSettingsScope(record.scope),
        values: parseSettingsValues(record.values)
      };
    case "refresh_settings_providers":
      return { type };
    case "connect_provider_oauth":
      return {
        type,
        provider: parseConnectableProvider(record.provider)
      };
    case "save_provider_api_key":
      return {
        type,
        provider: parseApiKeyProvider(record.provider),
        mode: parseApiKeyMode(record.mode),
        ...(record.value !== undefined
          ? {
              value: requireString(record.value, "action.value")
            }
          : {})
      };
    case "save_custom_provider":
      return {
        type,
        label: requireString(record.label, "action.label"),
        baseUrl: requireString(record.baseUrl, "action.baseUrl"),
        authMode: parseCustomProviderAuthMode(record.authMode),
        ...(record.authValue !== undefined
          ? {
              authValue: requireString(record.authValue, "action.authValue")
            }
          : {}),
        modelId: requireString(record.modelId, "action.modelId")
      };
    case "verify_provider_target":
      return {
        type,
        provider: requireString(record.provider, "action.provider"),
        ...(record.modelId !== undefined
          ? {
              modelId: requireString(record.modelId, "action.modelId")
            }
          : {})
      };
    case "set_timeline_group_expanded":
      return {
        type,
        itemId: requireString(record.itemId, "action.itemId"),
        expanded: requireBoolean(record.expanded, "action.expanded")
      };
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

function parseConnectableProvider(value: unknown): "openai-codex" {
  if (value === "openai-codex") {
    return value;
  }
  throw new Error('action.provider must be "openai-codex".');
}

function parseApiKeyProvider(value: unknown): "openai" {
  if (value === "openai") {
    return value;
  }
  throw new Error('action.provider must be "openai".');
}

function parseApiKeyMode(value: unknown): "paste-now" | "openai-api-key-env" | "custom-env" {
  if (
    value === "paste-now" ||
    value === "openai-api-key-env" ||
    value === "custom-env"
  ) {
    return value;
  }
  throw new Error(
    'action.mode must be "paste-now", "openai-api-key-env", or "custom-env".'
  );
}

function parseCustomProviderAuthMode(
  value: unknown
): "paste-now" | "env-var" | "custom-env" | "no-auth" {
  if (
    value === "paste-now" ||
    value === "env-var" ||
    value === "custom-env" ||
    value === "no-auth"
  ) {
    return value;
  }
  throw new Error(
    'action.authMode must be "paste-now", "env-var", "custom-env", or "no-auth".'
  );
}

function parseSettingsScope(value: unknown): "global" | "project" | "thread" {
  if (value === "global" || value === "project" || value === "thread") {
    return value;
  }
  throw new Error('action.scope must be "global", "project", or "thread".');
}

function parseSettingsValues(
  value: unknown
): Extract<UiAction, { type: "save_settings" }>["values"] {
  const record = requireRecord(value, "action.values");
  return {
    ...(record.modelA === undefined
      ? {}
      : record.modelA === null
        ? {
            modelA: undefined
          }
        : {
            modelA: requireString(record.modelA, "action.values.modelA")
          }),
    ...(record.modelB === undefined
      ? {}
      : record.modelB === null
        ? {
            modelB: undefined
          }
        : {
            modelB: requireString(record.modelB, "action.values.modelB")
          }),
    ...(record.thinkingA === undefined
      ? {}
      : record.thinkingA === null
        ? {
            thinkingA: undefined
          }
        : {
            thinkingA: parseThinking(record.thinkingA, "action.values.thinkingA")
          }),
    ...(record.thinkingB === undefined
      ? {}
      : record.thinkingB === null
        ? {
            thinkingB: undefined
          }
        : {
            thinkingB: parseThinking(record.thinkingB, "action.values.thinkingB")
          }),
    ...(record.mcpEnabled === undefined
      ? {}
      : record.mcpEnabled === null
        ? {
            mcpEnabled: undefined
          }
        : {
            mcpEnabled: requireBoolean(record.mcpEnabled, "action.values.mcpEnabled")
          })
  };
}

function parseThinking(
  value: unknown,
  label: string
): "off" | "low" | "medium" | "high" {
  if (value === "off" || value === "low" || value === "medium" || value === "high") {
    return value;
  }
  throw new Error(`${label} must be "off", "low", "medium", or "high".`);
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
