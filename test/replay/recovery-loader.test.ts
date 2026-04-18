import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RecoveryLoader } from "../../src/persistence/recovery-loader.js";
import { SessionLedger } from "../../src/persistence/session-ledger.js";
import type { HandoffRecord } from "../../src/types/handoff.js";

describe("recovery loader", () => {
  it("reconstructs active handoff state from the ledger", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-recovery-"));
    const ledger = new SessionLedger(join(root, "handoffs.jsonl"));
    const records: HandoffRecord[] = [
      {
        handoffId: "h-1",
        status: "prepared",
        role: "A",
        sessionId: "a-1",
        timestamp: new Date().toISOString()
      },
      {
        handoffId: "h-1",
        status: "delivered",
        role: "B",
        sessionId: "b-1",
        timestamp: new Date().toISOString()
      }
    ];
    for (const record of records) {
      await ledger.append(record);
    }

    const state = await new RecoveryLoader(ledger).load();

    expect(state.activeHandoffId).toBe("h-1");
    expect(state.lastDelivered?.handoffId).toBe("h-1");
  });
});
