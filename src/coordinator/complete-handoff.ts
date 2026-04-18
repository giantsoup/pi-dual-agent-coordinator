import type { CompletionRecord, HandoffRecord } from "../types/handoff.js";
import type { RoleRuntimeBinding } from "../runtime/create-role-runtime.js";

export function completeHandoffRecord(options: {
  completion: CompletionRecord;
  requestId?: string | undefined;
  binding: RoleRuntimeBinding;
}): HandoffRecord {
  return {
    handoffId: options.completion.handoffId,
    status: "completed",
    role: "B",
    requestId: options.requestId ?? options.completion.requestId,
    sessionId: options.binding.sessionId,
    sessionFile: options.binding.sessionFile,
    timestamp: new Date().toISOString(),
    completion: options.completion
  };
}
