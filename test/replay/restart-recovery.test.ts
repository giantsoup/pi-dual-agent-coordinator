import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { assertConsistency } from "../../src/persistence/assert-consistency.js";
import { SessionLedger } from "../../src/persistence/session-ledger.js";
import { replayEngine } from "../../src/persistence/replay-engine.js";
import { RecoveryLoader } from "../../src/persistence/recovery-loader.js";
import { restartRecovery } from "../../src/persistence/restart-recovery.js";
import type { HandoffRecord } from "../../src/types/handoff.js";

describe("restart recovery", () => {
  it("reaches the same conclusion after restart", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-restart-"));
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
      },
      {
        handoffId: "h-1",
        status: "completed",
        role: "B",
        sessionId: "b-1",
        timestamp: new Date().toISOString()
      }
    ];
    for (const record of records) {
      await ledger.append(record);
    }

    const live = replayEngine(records);
    const recovered = await restartRecovery(new RecoveryLoader(ledger));

    expect(() => assertConsistency(live, recovered)).not.toThrow();
  });
});
