import type { HandoffRecord, HandoffState, HandoffStatus } from "../types/handoff.js";

const allowedTransitions: Record<HandoffStatus, HandoffStatus[]> = {
  prepared: ["delivered", "superseded"],
  delivered: ["acked", "completed", "superseded"],
  acked: ["completed", "superseded"],
  completed: [],
  superseded: []
};

export function createEmptyHandoffState(): HandoffState {
  return { records: [] };
}

export function canTransition(
  from: HandoffStatus | undefined,
  to: HandoffStatus
): boolean {
  if (!from) {
    return to === "prepared";
  }
  return allowedTransitions[from].includes(to);
}

export function replayHandoffState(records: HandoffRecord[]): HandoffState {
  return records.reduce((state, record) => applyTransition(state, record), createEmptyHandoffState());
}

export function applyTransition(
  state: HandoffState,
  record: HandoffRecord
): HandoffState {
  const previous = [...state.records]
    .reverse()
    .find((item) => item.handoffId === record.handoffId);

  if (!canTransition(previous?.status, record.status)) {
    return state;
  }

  const nextState: HandoffState = {
    ...state,
    activeHandoffId:
      record.status === "completed" || record.status === "superseded"
        ? state.activeHandoffId === record.handoffId
          ? undefined
          : state.activeHandoffId
        : record.handoffId,
    records: [...state.records, record]
  };

  if (record.status === "prepared") {
    nextState.lastPrepared = record;
  }
  if (record.status === "delivered") {
    nextState.lastDelivered = record;
  }
  if (record.status === "completed") {
    nextState.lastCompleted = record;
  }

  return nextState;
}
