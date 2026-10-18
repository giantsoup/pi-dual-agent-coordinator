import { redactText } from "../security/redact.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { ToolSchema, ResourceSchema, ResourceTemplateSchema, PromptSchema } from "@modelcontextprotocol/sdk/types.js";

import type { McpMetadataCacheEntry } from "./types.js";

interface CacheFileShape {
  version: 1;
  entries: Record<string, McpMetadataCacheEntry>;
}

const cacheSchema = z.object({
  version: z.literal(1),
  entries: z.record(z.string(), z.object({
    serverName: z.string(), fingerprint: z.string(), updatedAt: z.string(),
    tools: z.array(ToolSchema), resources: z.array(ResourceSchema),
    resourceTemplates: z.array(ResourceTemplateSchema), prompts: z.array(PromptSchema),
    instructions: z.string().optional()
  }))
});

const writeQueues = new Map<string, Promise<void>>();

export class McpCacheStore {
  public constructor(private readonly filePath: string) {}

  public async get(
    serverName: string,
    fingerprint: string
  ): Promise<McpMetadataCacheEntry | undefined> {
    const cache = await this.readCache();
    const entry = cache.entries[this.getKey(serverName, fingerprint)];
    return entry?.serverName === serverName && entry.fingerprint === fingerprint ? entry : undefined;
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
      const parsed: unknown = JSON.parse(raw);
      return cacheSchema.parse(parsed);
    } catch {
      return { version: 1, entries: {} };
    }
  }

  private getKey(serverName: string, fingerprint: string): string {
    return `${serverName}:${fingerprint}`;
  }

  private async enqueueWrite(operation: () => Promise<void>): Promise<void> {
    const previous = writeQueues.get(this.filePath) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    writeQueues.set(this.filePath, next);
    try {
      await next;
    } finally {
      if (writeQueues.get(this.filePath) === next) writeQueues.delete(this.filePath);
    }
  }
}
