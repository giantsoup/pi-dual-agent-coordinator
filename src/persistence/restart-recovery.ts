import type { WorkflowState } from "../types/workflow.js";
import { RecoveryLoader } from "./recovery-loader.js";

export async function restartRecovery(loader: RecoveryLoader): Promise<WorkflowState> {
  return loader.load();
}
