import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { Coordinator } from "../../src/coordinator/coordinator.js";
import { createRoleRuntime, type RoleRuntimeBinding } from "../../src/runtime/create-role-runtime.js";
import { fixtureResponse } from "../../src/security/fixture-provider.js";
import { HeadlessInteractiveCoordinatorService } from "../../src/app/interactive/service.js";
import { CoordinatorTuiApp } from "../../src/app/tui/app.js";
import { TuiMainScreen, visibleWidth } from "@earendil-works/pi-tui";
import { MemoryTerminal } from "../helpers/terminal.js";

it("retains individually scoped role runs across sessions and restart, with read-only safe archive detail", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-retained-"));
  const cwd = join(root, "workspace"); await mkdir(cwd);
  const options = { cwd, sessionRoot: join(root, "state"), sessionMode: "persistent" as const, jsonLogs: false, verbose: false,
    createRoleRuntime: (input: Parameters<typeof createRoleRuntime>[0]) => createRoleRuntime({ ...input, providerTestBackend: { cwd, modelIds: [], load: async () => `dummy-${randomUUID()}`, request: async () => fixtureResponse("Visible 界 é 😀 prose.\n```pi-plan\ninternal block\n```\n\u001b]52;c;unsafe\u0007SAFE_END") } }) };
  let coordinator = new Coordinator(options);
  let service = new HeadlessInteractiveCoordinatorService(coordinator);
  try {
    await service.start();
    await service.dispatch({ type: "submit_input", input: "Read-only objective" });
    const run = service.getState().history.records.find((record) => record.kind === "run");
    if (!run || run.kind !== "run" || !run.sessionFile) throw new Error("Expected archived run");
    const bytes = await readFile(run.sessionFile, "utf8");
    const before = coordinator.getSessions();
    const detail = await service.loadHistoryDetail(run.id, "output");
    expect(detail.lines.join("\n")).toContain("Visible 界 é 😀 prose.");
    expect(detail.lines.join("\n")).not.toMatch(/internal block|52;c|unsafe/);
    expect(await readFile(run.sessionFile, "utf8")).toBe(bytes);
    expect(coordinator.getSessions()).toEqual(before);
    const terminal = new MemoryTerminal(); const tui = new TuiMainScreen(terminal);
    const app = new CoordinatorTuiApp(tui, terminal, service, { onExit() {} });
    expect(app.render(80).every((line) => visibleWidth(line) <= 80)).toBe(true);
    await service.dispatch({ type: "replace_runtime", role: "A", mode: "new" });
    expect((await service.loadHistoryDetail(run.id, "output")).lines).toEqual(detail.lines);
    await service.dispose();
    coordinator = new Coordinator(options); service = new HeadlessInteractiveCoordinatorService(coordinator); await service.start();
    expect(service.getState().history.records.find((record) => record.id === run.id)?.outcome.kind).toBe("completed");
    expect((await service.loadHistoryDetail(run.id, "output")).lines).toEqual(detail.lines);
    // Corrupting a retained file yields a reason, without the reader repairing it.
    await writeFile(run.sessionFile, bytes + "{broken\n");
    expect((await service.loadHistoryDetail(run.id, "output")).reason).toContain("Output unavailable");
    expect(await readFile(run.sessionFile, "utf8")).toBe(bytes + "{broken\n");
  } finally { await service.dispose(); await rm(root, { recursive: true, force: true }); }
}, 30_000);


it("selects history without changing pending execution, runtime bindings, or persisted archives", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-history-selection-"));
  const cwd = join(root, "workspace"); await mkdir(cwd);
  const stateRoot = join(root, "state");
  const plan = "```pi-plan\n" + JSON.stringify({ schemaVersion: 1, objective: "Pending objective", summary: "Wait for approval",
    acceptanceCriteria: ["Review history"], relevantPaths: ["."], executionPlan: ["Wait"] }) + "\n```";
  const runtimeBindings = new Map<string, RoleRuntimeBinding>();
  const coordinator = new Coordinator({ cwd, sessionRoot: stateRoot, sessionMode: "persistent", jsonLogs: false, verbose: false,
    createRoleRuntime: async (input) => {
      const binding = await createRoleRuntime({ ...input, providerTestBackend: { cwd, modelIds: [], load: async () => `dummy-${randomUUID()}`,
        request: async (_url, init) => fixtureResponse(String(init?.body).includes("Pending objective") ? plan : "Archived first answer") } });
      runtimeBindings.set(input.role, binding); return binding;
    } });
  const service = new HeadlessInteractiveCoordinatorService(coordinator);
  async function archives(directory: string): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) Object.assign(result, await archives(path));
      else if (entry.name.endsWith(".jsonl")) result[path] = await readFile(path, "utf8");
    }
    return result;
  }
  try {
    await service.start();
    await service.dispatch({ type: "submit_input", input: "First objective" });
    await service.dispatch({ type: "submit_input", input: "Pending objective" });
    const before = service.getState(); expect(before.pendingPlan).toBeDefined();
    const bindings = coordinator.getStatus().runtimes;
    const identities = [...runtimeBindings.entries()];
    const messages = identities.map(([, binding]) => JSON.stringify(binding.session.messages));
    const sessions = coordinator.getSessions(); const bytes = await archives(stateRoot);
    expect(Object.keys(bytes).length).toBeGreaterThan(0);
    const submit = vi.spyOn(coordinator, "submitUserInput");
    const approve = vi.spyOn(coordinator, "approvePendingPlan");
    const discard = vi.spyOn(coordinator, "discardPendingPlan");
    const replace = vi.spyOn(coordinator, "replaceRuntime");
    const terminal = new MemoryTerminal(); const app = new CoordinatorTuiApp(new TuiMainScreen(terminal), terminal, service, { onExit() {} });
    const screen = () => app.render(terminal.columns).join("\n");
    screen(); app.handleInput("\x1bOS"); app.handleInput("g"); app.handleInput("\r");
    expect(screen()).toContain("HISTORY REQUEST 1");
    app.handleInput("\r"); app.handleInput("3");
    await vi.waitFor(() => expect(screen()).toContain("Archived first answer"));
    app.handleInput("\x1b"); app.handleInput("\x1bOS"); app.handleInput("\x1b[F"); app.handleInput("\x1b");
    expect(screen()).toContain("HISTORY REQUEST 1");
    expect(service.getState().history).toEqual(before.history);
    expect(service.getState().pendingPlan).toBe(before.pendingPlan);
    identities.forEach(([role, binding], index) => {
      expect(runtimeBindings.get(role)).toBe(binding); expect(JSON.stringify(binding.session.messages)).toBe(messages[index]);
    });
    expect(coordinator.getStatus().runtimes).toEqual(bindings); expect(coordinator.getSessions()).toEqual(sessions);
    expect(await archives(stateRoot)).toEqual(bytes);
    for (const action of [submit, approve, discard, replace]) expect(action).not.toHaveBeenCalled();
    app.handleInput("\x1bOS"); app.handleInput("l"); expect(screen()).toContain("CURRENT REQUEST 2");
    expect(service.getState().history.currentTurnId).toBe(before.history.currentTurnId);
    expect(await archives(stateRoot)).toEqual(bytes);
  } finally { await service.dispose(); await rm(root, { recursive: true, force: true }); }
}, 30_000);

it("keeps a running Pi request's ownership and future prompts when selecting retained history", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-running-history-"));
  const cwd = join(root, "workspace"); await mkdir(cwd);
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let currentStarted = false;
  const requests: string[] = [];
  const runtimeBindings = new Map<string, RoleRuntimeBinding>();
  const coordinator = new Coordinator({ cwd, sessionRoot: join(root, "state"), sessionMode: "persistent", jsonLogs: false, verbose: false,
    createRoleRuntime: async (input) => {
      const binding = await createRoleRuntime({ ...input, providerTestBackend: { cwd, modelIds: [], load: async () => `dummy-${randomUUID()}`,
        request: async (_url, init) => {
          requests.push(String(init?.body));
          if (requests.length === 2) { currentStarted = true; await gate; }
          return fixtureResponse(requests.length === 1 ? "Retained answer" : "Current answer");
        } } });
      runtimeBindings.set(input.role, binding); return binding;
    } });
  const service = new HeadlessInteractiveCoordinatorService(coordinator);
  let running: Promise<void> | undefined;
  try {
    await service.start(); await service.dispatch({ type: "submit_input", input: "First objective" });
    const submit = vi.spyOn(coordinator, "submitUserInput");
    const approve = vi.spyOn(coordinator, "approvePendingPlan");
    const discard = vi.spyOn(coordinator, "discardPendingPlan");
    const replace = vi.spyOn(coordinator, "replaceRuntime");
    running = service.dispatch({ type: "submit_input", input: "Current objective" });
    await vi.waitFor(() => expect(currentStarted).toBe(true));
    submit.mockClear();
    const before = service.getState(); expect(before.operation.kind).toBe("running");
    const currentRun = before.history.records.find((record) => record.kind === "run" && record.parentId === before.history.currentTurnId);
    expect(currentRun?.outcome.kind).toBe("running");
    const identities = [...runtimeBindings.entries()];
    const bindings = before.status.runtimes;
    const terminal = new MemoryTerminal(); const app = new CoordinatorTuiApp(new TuiMainScreen(terminal), terminal, service, { onExit() {} });
    const screen = () => app.render(80).join("\n");
    screen(); app.handleInput("\x1bOS"); app.handleInput("g"); app.handleInput("\r");
    expect(screen()).toContain("HISTORY REQUEST 1");
    app.handleInput("\r"); app.handleInput("3");
    await vi.waitFor(() => expect(screen()).toContain("Retained answer"));
    app.handleInput("\x1b"); app.handleInput("\x1bOS"); app.handleInput("\x1b[F"); app.handleInput("\x1b");
    expect(screen()).toContain("HISTORY REQUEST 1");
    const after = service.getState();
    expect(after.operation.kind).toBe("running"); expect(after.history.currentTurnId).toBe(before.history.currentTurnId);
    expect(after.history.records.find((record) => record.id === currentRun?.id)?.outcome.kind).toBe("running");
    expect(after.pendingPlan).toBe(before.pendingPlan); expect(after.status.runtimes).toEqual(bindings);
    expect(after.status.activeWorkflowId).toBe(before.status.activeWorkflowId);
    for (const [role, binding] of identities) expect(runtimeBindings.get(role)).toBe(binding);
    for (const action of [submit, approve, discard, replace]) expect(action).not.toHaveBeenCalled();
    release(); await running;
    expect(service.getState().operation.kind).toBe("completed"); expect(screen()).toContain("HISTORY REQUEST 1");
    app.handleInput("\x1be"); app.handleInput("Next objective"); app.handleInput("\r");
    await vi.waitFor(() => expect(service.getState().operation.kind).toBe("completed"));
    expect(submit).toHaveBeenCalledExactlyOnceWith("Next objective");
    expect(requests).toHaveLength(3); expect(requests[2]).toContain("Current objective"); expect(requests[2]).toContain("Current answer");
    expect(service.getState().status.runtimes).toEqual(bindings);
  } finally { release(); await running; await service.dispose(); await rm(root, { recursive: true, force: true }); }
}, 30_000);
