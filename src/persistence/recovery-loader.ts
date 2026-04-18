import type { HandoffState } from "../types/handoff.js";
import { replayHandoffState } from "../coordinator/handoff-state-machine.js";
import { SessionLedger } from "./session-ledger.js";

export class RecoveryLoader {
  public constructor(private readonly ledger: SessionLedger) {}

  public async load(): Promise<HandoffState> {
    const records = await this.ledger.loadAll();
    return replayHandoffState(records);
  }
}
