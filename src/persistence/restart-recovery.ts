import type { HandoffState } from "../types/handoff.js";
import { RecoveryLoader } from "./recovery-loader.js";

export async function restartRecovery(loader: RecoveryLoader): Promise<HandoffState> {
  return loader.load();
}
