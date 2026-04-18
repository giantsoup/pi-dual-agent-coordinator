import type { HandoffRecord, HandoffState } from "../types/handoff.js";
import { replayHandoffState } from "../coordinator/handoff-state-machine.js";

export function replayEngine(records: HandoffRecord[]): HandoffState {
  return replayHandoffState(records);
}
