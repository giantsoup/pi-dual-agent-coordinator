import type { Role } from "./role.js";

export interface NormalizedTelemetryEvent {
  requestId?: string | undefined;
  role: Role;
  sessionId: string;
  sessionFile?: string | undefined;
  eventType: string;
  timestamp: string;
  leafId?: string | undefined;
  turnIndex?: number | undefined;
  handoffId?: string | undefined;
  details: Record<string, unknown>;
}
