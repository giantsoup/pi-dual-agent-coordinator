import type {
  PortalActionResponseDto,
  PortalBootstrapConfigDto,
  PortalControllerLockSnapshot,
  PortalStateSnapshotDto,
  PortalStreamEventDto
} from "../../../src/app/portal/protocol.js";
import type { UiAction } from "../../../src/types/ui.js";

declare global {
  interface Window {
    __PI_DUAL_PORTAL__?: PortalBootstrapConfigDto;
  }
}

export interface PortalEventHandlers {
  onEvent(dto: PortalStreamEventDto): void;
  onOpen?(): void;
  onError?(): void;
  onProtocolError?(error: Error): void;
}

export interface PortalActionResult {
  response: Response;
  dto: PortalActionResponseDto;
}

export function readPortalBootstrapConfig(): PortalBootstrapConfigDto {
  const bootstrap = window.__PI_DUAL_PORTAL__;
  if (!bootstrap?.authToken || !bootstrap.controllerId) {
    throw new Error("Missing portal bootstrap configuration.");
  }
  return bootstrap;
}

export async function fetchPortalState(
  bootstrap: PortalBootstrapConfigDto
): Promise<PortalStateSnapshotDto> {
  const response = await fetch(withToken("/api/state", bootstrap), {
    cache: "no-store",
    credentials: "same-origin"
  });

  if (!response.ok) {
    throw new Error(`Failed to load portal state (${response.status}).`);
  }

  const dto = (await response.json()) as PortalStateSnapshotDto;
  assertProtocolVersion(
    bootstrap.protocolVersion,
    dto.protocolVersion,
    "state snapshot"
  );
  assertNumber(dto.lastEventId, "state snapshot lastEventId");
  return dto;
}

export function subscribePortalEvents(
  bootstrap: PortalBootstrapConfigDto,
  handlers: PortalEventHandlers,
  options: { lastEventId?: number | undefined } = {}
): EventSource {
  const source = new EventSource(
    withToken("/api/events", bootstrap, {
      controllerId: bootstrap.controllerId,
      ...(options.lastEventId !== undefined
        ? { lastEventId: String(options.lastEventId) }
        : {})
    })
  );

  source.onopen = () => {
    handlers.onOpen?.();
  };

  source.onmessage = (message) => {
    try {
      const dto = JSON.parse(message.data) as PortalStreamEventDto;
      assertProtocolVersion(
        bootstrap.protocolVersion,
        dto.protocolVersion,
        "event stream"
      );
      assertNumber(dto.eventId, "event stream eventId");
      assertNumber(Date.parse(dto.sentAt), "event stream sentAt");
      handlers.onEvent(dto);
    } catch (error) {
      handlers.onProtocolError?.(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  };

  source.onerror = () => {
    handlers.onError?.();
  };

  return source;
}

export async function postPortalAction(
  bootstrap: PortalBootstrapConfigDto,
  action: UiAction
): Promise<PortalActionResult> {
  const response = await fetch("/api/actions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${bootstrap.authToken}`,
      "content-type": "application/json"
    },
    cache: "no-store",
    credentials: "same-origin",
    body: JSON.stringify({
      controllerId: bootstrap.controllerId,
      action
    })
  });

  const dto = (await response.json()) as PortalActionResponseDto;
  assertProtocolVersion(
    bootstrap.protocolVersion,
    dto.protocolVersion,
    "action response"
  );
  assertNumber(dto.lastEventId, "action response lastEventId");
  return {
    response,
    dto
  };
}

export type { PortalControllerLockSnapshot };

function withToken(
  pathname: string,
  bootstrap: PortalBootstrapConfigDto,
  extraQuery: Record<string, string> = {}
): string {
  const url = new URL(pathname, window.location.origin);
  url.searchParams.set("token", bootstrap.authToken);
  for (const [key, value] of Object.entries(extraQuery)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function assertProtocolVersion(
  expected: number,
  actual: number,
  label: string
): void {
  if (actual !== expected) {
    throw new Error(
      `Portal protocol mismatch for ${label}. Expected v${expected}, received v${actual}.`
    );
  }
}

function assertNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`Portal protocol mismatch for ${label}. Expected a number.`);
  }
}
