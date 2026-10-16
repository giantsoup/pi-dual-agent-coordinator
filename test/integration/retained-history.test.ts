import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { Coordinator } from "../../src/coordinator/coordinator.js";
import { createRoleRuntime } from "../../src/runtime/create-role-runtime.js";
import { fixtureResponse } from "../../src/security/fixture-provider.js";
import { HeadlessInteractiveCoordinatorService } from "../../src/app/interactive/service.js";
import { CoordinatorTuiApp } from "../../src/app/tui/app.js";
import { TUI, visibleWidth } from "@mariozechner/pi-tui";
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
    const terminal = new MemoryTerminal(); const tui = new TUI(terminal);
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
