import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { McpCacheStore } from "../../src/mcp/cache-store.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const entry = (serverName: string) => ({ serverName, fingerprint: "test", updatedAt: new Date().toISOString(), tools: [], resources: [], resourceTemplates: [], prompts: [] });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pi-mcp-cache-")); roots.push(root);
  const path = join(root, "cache.json");
  return { root, path, store: new McpCacheStore(path) };
}
it("validates cached SDK metadata and isolates missing cache files", async () => {
  const first = await fixture(); const second = await fixture();
  await first.store.set(entry("first"));
  expect(await second.store.get("first", "test")).toBeUndefined();
  await writeFile(first.path, JSON.stringify({ version: 1, entries: { "first:test": { ...entry("first"), tools: [{ name: 123 }] } } }));
  expect(await first.store.get("first", "test")).toBeUndefined();
});
it("serializes concurrent updates from separate stores and recovers after write failures", async () => {
  const { path, store } = await fixture();
  await mkdir(path);
  await expect(store.set(entry("failed"))).rejects.toThrow();
  await rm(path, { recursive: true });
  await Promise.all([store.set(entry("one")), new McpCacheStore(path).set(entry("two"))]);
  expect(await store.get("one", "test")).toMatchObject({ serverName: "one" });
  expect(await store.get("two", "test")).toMatchObject({ serverName: "two" });
  expect(JSON.parse(await readFile(path, "utf8")).entries).not.toHaveProperty("failed:test");
});
