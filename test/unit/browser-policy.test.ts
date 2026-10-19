import { mkdtemp, mkdir, writeFile, chmod, symlink, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { browserConfigSchema, loadBrowserConfiguration, validateLocalOrigin } from "../../src/browser/policy.js";
import { ProjectBrowser } from "../../src/browser/controller.js";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
it("requires a private operator policy for the exact canonical project", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-browser-policy-")); roots.push(root);
  const workspace = join(root, "workspace"), other = join(root, "other"); await mkdir(workspace); await mkdir(other);
  const canonicalWorkspace = await realpath(workspace);
  const path = join(root, "browser.json");
  await writeFile(path, JSON.stringify({ version: 2, enabled: true, projects: [{ workspace: canonicalWorkspace, allowedOrigins: ["http://localhost:5173"] }] }), { mode: 0o600 });
  expect(loadBrowserConfiguration(workspace, path)).toEqual({ workspace: canonicalWorkspace, allowedOrigins: ["http://localhost:5173"] });
  expect(loadBrowserConfiguration(other, path)).toBeUndefined();
  await chmod(path, 0o644); expect(() => loadBrowserConfiguration(workspace, path)).toThrow("private regular file");
  await chmod(path, 0o600); const link = join(root, "link.json"); await symlink(path, link);
  expect(() => loadBrowserConfiguration(workspace, link)).toThrow("private regular file");
  const inside = join(workspace, "browser.json"); await writeFile(inside, "{}", { mode: 0o600 });
  expect(() => loadBrowserConfiguration(workspace, inside)).toThrow("outside the agent workspace");
});
it.each(["http://example.com", "http://192.168.1.5:3000", "http://localhost:1234", "http://localhost:9222", "http://localhost:55000", "http://user:pass@localhost:3000", "http://localhost:3000/path", "file:///tmp/page.html"])("rejects unapproved browser authority %s", value => {
  expect(() => validateLocalOrigin(value)).toThrow();
  expect(browserConfigSchema.safeParse({ version: 2, enabled: true, projects: [{ workspace: "/project", allowedOrigins: [value] }] }).success).toBe(false);
});
it("gives A navigation without UI mutations and rejects stale B refs before starting a browser", async () => {
  const config = { workspace: "/not-used", allowedOrigins: ["http://localhost:3000"] };
  const a = new ProjectBrowser("A", config), b = new ProjectBrowser("B", config);
  try {
    await expect(a.call({ action: "click", ref: "e1" })).rejects.toThrow("Agent A");
    await expect(a.call({ action: "navigate", url: "http://localhost:1234" })).rejects.toThrow("outside");
    await expect(a.call({ action: "evaluate", code: "anything" })).rejects.toThrow();
    await expect(b.call({ action: "click", ref: "e1", snapshotId: "119a149c-229e-4232-a6d5-ef10ba90e322" })).rejects.toThrow("fresh browser snapshot");
  } finally { await a.dispose(); await b.dispose(); }
  await expect(a.call({ action: "snapshot" })).rejects.toThrow("disposed");
});
