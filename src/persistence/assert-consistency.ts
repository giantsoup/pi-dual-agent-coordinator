import type { HandoffState } from "../types/handoff.js";

export function assertConsistency(live: HandoffState, replayed: HandoffState): void {
  const liveKey = JSON.stringify(live);
  const replayedKey = JSON.stringify(replayed);
  if (liveKey !== replayedKey) {
    throw new Error("Recovered handoff state does not match live state");
  }
}
