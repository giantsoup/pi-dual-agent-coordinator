import type { HandoffRecord, HandoffState } from "../types/handoff.js";

export function isDuplicateRecord(
  state: HandoffState,
  candidate: HandoffRecord
): boolean {
  return state.records.some(
    (record) =>
      record.handoffId === candidate.handoffId &&
      record.status === candidate.status &&
      record.sessionId === candidate.sessionId
  );
}
