import { redactText } from "../security/redact.js";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { HandoffRecord } from "../types/handoff.js";

export class SessionLedger {
  public constructor(private readonly filePath: string) {}

  public async append(record: HandoffRecord): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${redactText(JSON.stringify(record))}\n`, "utf8");
  }

  public async listByHandoffId(id: string): Promise<HandoffRecord[]> {
    return (await this.loadAll()).filter((record) => record.handoffId === id);
  }

  public async listByWorkflowId(id: string): Promise<HandoffRecord[]> {
    return (await this.loadAll()).filter((record) => record.workflowId === id);
  }

  public async latest(): Promise<HandoffRecord | undefined> {
    const records = await this.loadAll();
    return records.at(-1);
  }

  public async loadAll(): Promise<HandoffRecord[]> {
    try {
      const content = await readFile(this.filePath, "utf8");
      return parseLedgerRecords(content);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }
}

function parseLedgerRecords(content: string): HandoffRecord[] {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const records: HandoffRecord[] = [];

  for (const [index, line] of lines.entries()) {
    try {
      records.push(JSON.parse(line) as HandoffRecord);
    } catch (error) {
      if (index === lines.length - 1) {
        // A partially written final JSONL entry is recoverable after abrupt shutdown.
        break;
      }

      throw new Error(
        `Invalid workflow ledger entry at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return records;
}
