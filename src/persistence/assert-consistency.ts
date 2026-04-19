import type { WorkflowState } from "../types/workflow.js";

export function assertConsistency(live: WorkflowState, replayed: WorkflowState): void {
  if (JSON.stringify(live) !== JSON.stringify(replayed)) {
    throw new Error("Workflow state diverged after replay");
  }
}
