import type { HandoffEnvelope, HandoffRecord } from "../types/handoff.js";
import type { RoleRuntimeBinding } from "../runtime/create-role-runtime.js";

export function prepareHandoffRecord(options: {
  envelope: HandoffEnvelope;
  requestId?: string | undefined;
  binding: RoleRuntimeBinding;
}): HandoffRecord {
  return {
    handoffId: options.envelope.handoffId,
    status: "prepared",
    role: "A",
    requestId: options.requestId ?? options.envelope.requestId,
    sessionId: options.binding.sessionId,
    sessionFile: options.binding.sessionFile,
    timestamp: new Date().toISOString(),
    envelope: options.envelope
  };
}
