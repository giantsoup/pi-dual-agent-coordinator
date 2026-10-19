import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectBrowser } from "../../src/browser/controller.js";
import { ManagedSession } from "../../src/runtime/managed-session.js";
import { createRoleRuntime } from "../../src/runtime/create-role-runtime.js";
import { fixtureResponse, fixtureToolResponse, fixtureChatResponse, fixtureChatToolResponse } from "../../src/security/fixture-provider.js";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
it.each(["A", "B"] as const)("exposes a role-bound native browser in Agent %s's actual Pi registry", async role => {
  const root = await mkdtemp(join(tmpdir(), "pi-browser-registry-")); roots.push(root); const cwd = join(root, "workspace"); await mkdir(cwd);
  let calls = 0, inventory = "";
  const binding = await createRoleRuntime({ role, cwd, agentDir: join(root, "agent"), sessionRoot: join(root, "state"), sessionMode: "memory", browser: { workspace: cwd, allowedOrigins: ["http://localhost:5173"] },
    providerTestBackend: { cwd, modelIds: [], load: async () => "dummy-browser-registry", request: async () => {
      if (++calls === 1) return role === "A" ? fixtureToolResponse("list_tools", {}) : fixtureChatToolResponse("list_tools", {});
      return role === "A" ? fixtureResponse("Registry verified") : fixtureChatResponse("Registry verified");
    } }
  });
  binding.session.subscribe(event => { if (event.type === "tool_execution_end") for (const content of event.result.content) if (content.type === "text") inventory += content.text; });
  try {
    await binding.session.prompt("List native tools");
    expect(inventory).toContain('"name": "browser"');
    expect(inventory).toContain('"navigate"');
    if (role === "A") expect(inventory).not.toContain('"click"');
    else expect(inventory).toContain('"click"');
  } finally { await binding.dispose(); }
});

it("omits browser completely from no-tools sessions and reload", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-browser-none-")); roots.push(root); const cwd = join(root, "workspace"); await mkdir(cwd);
  const binding = await createRoleRuntime({ role: "A", cwd, agentDir: join(root, "agent"), sessionRoot: join(root, "state"), sessionMode: "memory", noTools: true,
    browser: { workspace: cwd, allowedOrigins: ["http://localhost:5173"] }, providerTestBackend: { cwd, modelIds: [], load: async () => "dummy-no-browser", request: async () => fixtureResponse("No tools") } });
  try {
    if (!(binding.session instanceof ManagedSession)) throw new Error("Expected Pi managed session");
    expect(binding.session.piSession.getAllTools()).toEqual([]);
    await binding.session.piSession.reload();
    expect(binding.session.piSession.getAllTools()).toEqual([]);
  } finally { await binding.dispose(); }
});

it("rejects a new Pi session if browser teardown fails even when extension shutdown swallows it", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-browser-failed-drain-")); roots.push(root); const cwd = join(root, "workspace"); await mkdir(cwd);
  const binding = await createRoleRuntime({ role: "A", cwd, agentDir: join(root, "agent"), sessionRoot: join(root, "state"), sessionMode: "memory",
    browser: { workspace: cwd, allowedOrigins: ["http://localhost:5173"] }, providerTestBackend: { cwd, modelIds: [], load: async () => "dummy-drain-failure", request: async () => fixtureResponse("Old session") } });
  const sessionId = binding.sessionId;
  const cleanup = vi.spyOn(ProjectBrowser.prototype, "dispose").mockRejectedValue(new Error("Injected browser teardown failure"));
  try {
    await expect(binding.runtime.newSession()).rejects.toThrow("Injected browser teardown failure");
    expect(binding.sessionId).toBe(sessionId);
  } finally { cleanup.mockRestore(); await binding.dispose(); }
});
