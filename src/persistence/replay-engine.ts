import type { HandoffRecord } from "../types/handoff.js";
import type { WorkflowState } from "../types/workflow.js";
import { replayHandoffState } from "../coordinator/handoff-state-machine.js";

export function replayEngine(records: HandoffRecord[]): WorkflowState {
  return replayHandoffState(records);
}
