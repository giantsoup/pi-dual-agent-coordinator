import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { protectSecret, redactText, redactValue } from "../../src/security/redact.js";
import { TelemetryLogger } from "../../src/telemetry/logger.js";
import { normalizeLifecycleEvent } from "../../src/telemetry/event-normalizer.js";

it("redacts registered secrets before persistence, terminal output, and subscribers across both brokers", () => {
  const dummy = randomUUID(), releaseA = protectSecret(dummy), releaseB = protectSecret(dummy);
  const root = mkdtempSync(join(tmpdir(), "pi-redact-")), path = join(root, "telemetry.jsonl");
  let output = "", observed = "";
  try {
    releaseA();
    expect(redactText(dummy)).toBe("[REDACTED]");
    const logger = new TelemetryLogger({ filePath: path, jsonLogs: true, verbose: false,
      stdout: { write: (text: string) => { output += text; return true; } } as NodeJS.WriteStream });
    logger.subscribe((event) => { observed = JSON.stringify(event); });
    logger.log(normalizeLifecycleEvent({ role: "B", sessionId: "dummy", eventType: "test", details: { key: dummy, encoded: Buffer.from(dummy).toString("base64"), message: `Bearer ${dummy}` } }));
    for (const text of [output, observed, readFileSync(path, "utf8")]) {
      expect(text).not.toContain(dummy); expect(text).not.toContain(Buffer.from(dummy).toString("base64"));
    }
    expect(redactValue(undefined)).toBeUndefined();
  } finally { releaseA(); releaseB(); rmSync(root, { recursive: true, force: true }); }
});
