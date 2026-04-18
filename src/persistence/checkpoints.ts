import { mkdirSync } from "node:fs";
import { join } from "node:path";

export interface PersistencePaths {
  root: string;
  ledgerFile: string;
  telemetryFile: string;
}

export function createPersistencePaths(root: string): PersistencePaths {
  mkdirSync(root, { recursive: true });
  const ledgerDir = join(root, "ledger");
  const logsDir = join(root, "logs");
  mkdirSync(ledgerDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });

  return {
    root,
    ledgerFile: join(ledgerDir, "handoffs.jsonl"),
    telemetryFile: join(logsDir, "coordinator.jsonl")
  };
}
