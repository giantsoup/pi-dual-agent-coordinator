import { redactText } from "../security/redact.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { McpMetadataCacheEntry } from "./types.js";

interface CacheFileShape {
  version: 1;
  entries: Record<string, McpMetadataCacheEntry>;
}

const EMPTY_CACHE: CacheFileShape = {
  version: 1,
  entries: {}
};

const writeQueues = new Map<string, Promise<void>>();

export class McpCacheStore {
  public constructor(private readonly filePath: string) {}

  public async get(
    serverName: string,
    fingerprint: string
  ): Promise<McpMetadataCacheEntry | undefined> {
    const cache = await this.readCache();
    return cache.entries[this.getKey(serverName, fingerprint)];
  }

  public async set(entry: McpMetadataCacheEntry): Promise<void> {
    await this.enqueueWrite(async () => {
      const cache = await this.readCache();
      cache.entries[this.getKey(entry.serverName, entry.fingerprint)] = entry;
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, `${redactText(JSON.stringify(cache, null, 2))}\n`, "utf8");
    });
  }

  private async readCache(): Promise<CacheFileShape> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<CacheFileShape>;
      if (parsed.version !== 1 || !parsed.entries || typeof parsed.entries !== "object") {
        return { ...EMPTY_CACHE };
      }
      return {
        version: 1,
        entries: parsed.entries
      };
    } catch {
      return { ...EMPTY_CACHE };
    }
  }

  private getKey(serverName: string, fingerprint: string): string {
    return `${serverName}:${fingerprint}`;
  }

  private async enqueueWrite(operation: () => Promise<void>): Promise<void> {
    const previous = writeQueues.get(this.filePath) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    writeQueues.set(this.filePath, next.finally(() => {
      if (writeQueues.get(this.filePath) === next) {
        writeQueues.delete(this.filePath);
      }
    }));
    await next;
  }
}
