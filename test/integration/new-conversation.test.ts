import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { Coordinator } from "../../src/coordinator/coordinator.js";
import { createRoleRuntime, type RoleRuntimeBinding } from "../../src/runtime/create-role-runtime.js";
import { fixtureResponse, fixtureChatResponse } from "../../src/security/fixture-provider.js";
import { HeadlessInteractiveCoordinatorService } from "../../src/app/interactive/service.js";
import { CurrentWorkspace } from "../../src/app/tui/workspace.js";
import { HistoryIndex } from "../../src/app/interactive/history.js";

const roots: string[] = [];
const originalCwd = process.cwd();
afterEach(async () => {
  process.chdir(originalCwd);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each([["/new A", "/new B"], ["/new"]])("opens an empty conversation with %j while retaining archived work", async (...commands) => {
  const root = await mkdtemp(join(tmpdir(), "pi-new-conversation-")); roots.push(root);
  const cwd = join(root, "workspace"); await mkdir(cwd);
  const bindings = new Map<string, RoleRuntimeBinding>();
  const coordinator = new Coordinator({ cwd, sessionRoot: join(root, "state"), sessionMode: "persistent", jsonLogs: false, verbose: false,
    createRoleRuntime: async (input) => {
      const binding = await createRoleRuntime({ ...input, providerTestBackend: { cwd, modelIds: [], load: async () => "fixture-key",
        request: async () => input.role === "A" ? fixtureResponse("Fresh context answer") : fixtureChatResponse("Executor context answer") } });
      bindings.set(input.role, binding);
      return binding;
    } });
  const service = new HeadlessInteractiveCoordinatorService(coordinator);
  await service.start();
  try {
    await service.dispatch({ type: "submit_input", input: "old conversation marker" });
    await bindings.get("B")?.session.prompt("old executor marker");
    const before = service.getState();
    const sessionIds = before.status.runtimes.map((runtime) => runtime.sessionId);
    const workspace = new CurrentWorkspace(service, () => {});
    workspace.render(before, 80, 20);
    const run = before.history.records.find((record) => record.kind === "run");
    if (!run) throw new Error("Missing retained run");
    workspace.inspect(run.id);
    expect(workspace.inspector).toBeDefined();
    for (const input of commands) await service.dispatch({ type: "submit_input", input });
    const state = service.getState();
    expect(state.lastError).toBeUndefined();
    expect(state.status.runtimes.every((runtime) => !sessionIds.includes(runtime.sessionId))).toBe(true);
    expect(bindings.get("A")?.session.messages).toHaveLength(0);
    expect(bindings.get("B")?.session.messages).toHaveLength(0);
    expect(state.history.currentTurnId).toBeUndefined();
    expect(state.history.records).toEqual(before.history.records);
    expect(state.conversation.some((entry) => entry.text === "old conversation marker")).toBe(false);
    const rendered = workspace.render(state, 80, 20).join("\n");
    expect(rendered).toContain("New conversation");
    expect(rendered).not.toContain("READ-ONLY INSPECTOR");
    expect(state.operation.kind).toBe("idle");
    const restored = new HistoryIndex();
    restored.restore(coordinator.getHistoryEvents());
    expect(restored.snapshot().currentTurnId).toBeUndefined();
    expect(restored.snapshot().records).toEqual(state.history.records);
    await service.dispatch({ type: "submit_input", input: "new conversation marker" });
    expect(service.getState().history.currentTurnId).not.toBe(before.history.currentTurnId);
    expect(service.getState().conversation.some((entry) => entry.text === "Fresh context answer")).toBe(true);
    expect(JSON.stringify(bindings.get("A")?.session.messages)).not.toContain("old conversation marker");
  } finally { await service.dispose(); }
}, 30_000);
