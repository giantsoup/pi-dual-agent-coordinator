import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SessionLedger } from "../../src/persistence/session-ledger.js";

describe("session ledger", () => {
  it("ignores a truncated final record during recovery", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-ledger-"));
    const ledgerPath = join(root, "handoffs.jsonl");

    writeFileSync(
      ledgerPath,
      [
        '{"handoffId":"h-1","status":"prepared","role":"A","sessionId":"a-1","timestamp":"2026-04-18T00:00:00.000Z"}',
        '{"handoffId":"h-1"'
      ].join("\n"),
      "utf8"
    );

    const records = await new SessionLedger(ledgerPath).loadAll();

    expect(records).toHaveLength(1);
    expect(records[0]?.handoffId).toBe("h-1");
  });

  it("fails on malformed non-terminal records", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-ledger-"));
    const ledgerPath = join(root, "handoffs.jsonl");

    writeFileSync(
      ledgerPath,
      [
        '{"handoffId":"h-1"',
        '{"handoffId":"h-1","status":"prepared","role":"A","sessionId":"a-1","timestamp":"2026-04-18T00:00:00.000Z"}'
      ].join("\n"),
      "utf8"
    );

    await expect(new SessionLedger(ledgerPath).loadAll()).rejects.toThrow(
      "Invalid handoff ledger entry at line 1"
    );
  });
});
