import { readFileSync } from "node:fs";
import { buildSessionContext, migrateSessionEntries, parseSessionEntries } from "@earendil-works/pi-coding-agent";

/** Pi's open() repairs files in place. Previews must never use it. */
export function readSessionHistory(path: string) {
  const content = readFileSync(path, "utf8");
  const lines = content.split("\n").filter((line) => line.trim());
  for (const line of lines) {
    const value: unknown = JSON.parse(line);
    if (!value || typeof value !== "object" || !("type" in value) || typeof value.type !== "string") {
      throw new Error("Invalid session entry.");
    }
  }
  const entries = parseSessionEntries(content);
  const header = entries[0];
  if (!header || header.type !== "session" || typeof header.cwd !== "string" || typeof header.id !== "string") {
    throw new Error("Invalid session header. The original file has been preserved.");
  }
  if (header.version !== undefined && (!Number.isInteger(header.version) || header.version < 1 || header.version > 3)) throw new Error("Unsupported session version.");
  migrateSessionEntries(entries);
  const history = entries.filter((entry) => entry.type !== "session");
  for (const entry of history) {
    if (typeof entry.id !== "string" || (entry.parentId !== null && typeof entry.parentId !== "string")) throw new Error("Invalid session history.");
  }
  const parents = new Map<string, string | null>();
  for (const entry of history) {
    if (parents.has(entry.id)) throw new Error("Duplicate session entry ID.");
    parents.set(entry.id, entry.parentId);
  }
  const checked = new Set<string>();
  for (const entry of history) {
    const branch = new Set<string>();
    let id: string | null | undefined = entry.id;
    while (id && !checked.has(id)) {
      if (branch.has(id)) throw new Error("Cyclic session history. The original file has been preserved.");
      branch.add(id);
      if (!parents.has(id)) throw new Error("Missing session parent. The original file has been preserved.");
      id = parents.get(id);
    }
    for (const visited of branch) checked.add(visited);
  }
  return { cwd: header.cwd, messages: buildSessionContext(history).messages };
}

/** Complete archive, including inactive branches and messages preceding compaction. */
export function readSessionArchive(path: string) {
  const content = readFileSync(path, "utf8");
  const parsed = content.split("\n").filter((line) => line.trim()).map((line) => archiveEntry.parse(JSON.parse(line)));
  const header = parsed[0];
  if (!header || header.type !== "session" || !header.cwd || !header.id) throw new Error("Invalid session header.");
  const entries = parsed.slice(1);
  if (entries.some((entry) => entry.type === "session" || entry.parentId === undefined || entry.type === "message" && !entry.message)) throw new Error("Invalid session archive entry.");
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  if (byId.size !== entries.length) throw new Error("Duplicate session entry ID.");
  const checked = new Set<string>();
  for (const entry of entries) {
    const seen = new Set<string>();
    let cursor: typeof entry | undefined = entry;
    while (cursor && !checked.has(cursor.id)) {
      if (seen.has(cursor.id)) throw new Error("Cyclic session history.");
      seen.add(cursor.id);
      if (cursor.parentId && !byId.has(cursor.parentId)) throw new Error("Missing session parent.");
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    for (const id of seen) checked.add(id);
  }
  return { header, entries, byId };
}

import { z } from "zod";
const archiveEntry = z.object({
  type: z.string(), id: z.string(), parentId: z.string().nullable().optional(),
  cwd: z.string().optional(), timestamp: z.iso.datetime({ offset: true }), version: z.number().int().min(1).max(3).optional(),
  customType: z.string().optional(), data: z.unknown().optional(),
  message: z.object({
    role: z.string(), content: z.union([z.string(), z.array(z.object({
      type: z.string(), text: z.string().optional(), id: z.string().optional(),
      name: z.string().optional(), arguments: z.unknown().optional()
    }))]).optional(),
    sections: z.record(z.string(), z.string().nullable()).optional(),
    toolsAdded: z.array(z.unknown()).optional(), toolsRemoved: z.array(z.unknown()).optional(),
    toolCallId: z.string().optional(), toolName: z.string().optional(), isError: z.boolean().optional(),
    errorMessage: z.string().optional(), stopReason: z.string().optional(), details: z.unknown().optional()
  }).optional()
});
export type ArchiveEntry = z.infer<typeof archiveEntry>;

export function archiveRunEntries(archive: ReturnType<typeof readSessionArchive>, runId: string): ArchiveEntry[] {
  const owners = new Map<string, string | undefined>();
  function owner(entry: ArchiveEntry): string | undefined {
    if (owners.has(entry.id)) return owners.get(entry.id);
    const path: ArchiveEntry[] = [];
    let cursor: ArchiveEntry | undefined = entry;
    let run: string | undefined;
    while (cursor) {
      if (owners.has(cursor.id)) { run = owners.get(cursor.id); break; }
      path.push(cursor);
      if (cursor.type === "custom" && cursor.customType === "pi-dual-run") {
        const data = z.object({ runId: z.string() }).safeParse(cursor.data);
        if (data.success) { run = data.data.runId; break; }
      }
      cursor = cursor.parentId ? archive.byId.get(cursor.parentId) : undefined;
    }
    for (const item of path) owners.set(item.id, run);
    return run;
  }
  return archive.entries.filter((entry) => owner(entry) === runId);
}
