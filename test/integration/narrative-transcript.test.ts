import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TuiMainScreen, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { expect, it } from "vitest";
import { Coordinator } from "../../src/coordinator/coordinator.js";
import { HeadlessInteractiveCoordinatorService } from "../../src/app/interactive/service.js";
import { CoordinatorTuiApp } from "../../src/app/tui/app.js";
import { createRoleRuntime } from "../../src/runtime/create-role-runtime.js";
import { fixtureResponse, fixtureChatResponse, fixtureChatToolResponse } from "../../src/security/fixture-provider.js";
import { MemoryTerminal } from "../helpers/terminal.js";

it("renders ordered A/B responses around real tools and restores the same narrative without session writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-narrative-"));
  const cwd = join(root, "workspace"); await mkdir(cwd);
  const block = (name: string, data: unknown) => `\`\`\`${name}\n${JSON.stringify(data)}\n\`\`\``;
  const field = (text: string, name: string) => {
    const value = new RegExp(`${name}: ([^\\n]+)`).exec(text)?.[1];
    if (!value) throw new Error(`Missing ${name}`);
    return value;
  };
  const allText = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(allText).join("\n");
    return value && typeof value === "object" ? Object.values(value).map(allText).join("\n") : "";
  };
  let workerTurns = 0;
  const options = { cwd, sessionRoot: join(root, "state"), sessionMode: "persistent" as const, jsonLogs: false, verbose: false,
    createRoleRuntime: (input: Parameters<typeof createRoleRuntime>[0]) => createRoleRuntime({ ...input, providerTestBackend: {
      cwd, modelIds: [], load: async () => `dummy-${randomUUID()}`, request: async (_url, init) => {
        const body = allText(JSON.parse(String(init?.body)));
        if (input.role === "B") {
          workerTurns++;
          if (workerTurns === 1) return fixtureChatToolResponse("write", { path: "result.txt", content: "fixed" }, "write-result", "I am applying the arithmetic fix.");
          if (workerTurns === 2) return fixtureChatToolResponse("read", { path: "result.txt" }, "verify-result", "The change is saved. I will verify the result.");
          return fixtureChatResponse("The file now contains the verified result.\n" + block("pi-completion", { schemaVersion: 1, workflowId: field(body, "Workflow ID"), handoffId: field(body, "Handoff ID"), iteration: 1, summary: "Fixed arithmetic", changedPaths: ["result.txt"], verification: ["Read result.txt: fixed"] }));
        }
        if (body.includes("Coordinator review prompt")) return fixtureResponse("I reviewed the retained evidence.\n" + block("pi-final", { schemaVersion: 1, workflowId: field(body, "Workflow ID"), iteration: 1, decision: "approved", summary: "Verified", userResponse: "The arithmetic fix is complete.", changedPaths: ["result.txt"] }));
        return fixtureResponse("I found an arithmetic issue and propose a focused fix.\n" + block("pi-plan", { schemaVersion: 1, objective: "Fix arithmetic", summary: "Correct the result", acceptanceCriteria: ["result.txt contains fixed"], relevantPaths: ["result.txt"], executionPlan: ["Write result.txt and read it back"] }));
      }
    } }) };
  let coordinator = new Coordinator(options);
  let service = new HeadlessInteractiveCoordinatorService(coordinator);
  try {
    await service.start(); await service.dispatch({ type: "submit_input", input: "Propose the arithmetic fix" });
    expect(service.getState().pendingPlan).toBeDefined();
    await service.dispatch({ type: "approve_pending_plan" });
    const turnId = service.getState().history.currentTurnId;
    if (!turnId) throw new Error("Missing request");
    const sessions = coordinator.getSessions();
    const runs = service.getState().history.records.filter((record) => record.kind === "run");
    const files = [...new Set(runs.flatMap((run) => run.sessionFile ? [run.sessionFile] : []))];
    const bytes = await Promise.all(files.map((file) => readFile(file, "utf8")));
    await service.loadTranscript(turnId);
    const blocks = service.getTranscript(turnId);
    const text = blocks.map((entry) => entry.kind === "response" ? entry.text : "TOOLS").join("\n");
    expect(text).toMatch(/found an arithmetic[\s\S]*applying the arithmetic[\s\S]*TOOLS[\s\S]*change is saved[\s\S]*TOOLS[\s\S]*verified result[\s\S]*reviewed the retained/);
    expect(text).not.toMatch(/pi-plan|schemaVersion|pi-completion|pi-final/);
    expect(blocks.filter((entry) => entry.kind === "tools").map((entry) => entry.callIds.length)).toEqual([1, 1]);
    const terminal = new MemoryTerminal(); terminal.columns = 120; terminal.rows = 40;
    const app = new CoordinatorTuiApp(new TuiMainScreen(terminal), terminal, service, { onExit() {} });
    app.handleInput("keep draft");
    const screen = stripTerminalSequences(app.render(120).join("\n"));
    expect(screen).toContain("applying the arithmetic fix"); expect(screen).toContain("I reviewed the retained evidence");
    expect(screen).toContain("1 tool call"); expect(screen).not.toContain("[completed] write result.txt");
    expect(screen).toContain("keep draft");
    expect(app.render(120).every((line) => visibleWidth(line) <= 120)).toBe(true);
    expect(coordinator.getSessions()).toEqual(sessions);
    expect(await Promise.all(files.map((file) => readFile(file, "utf8")))).toEqual(bytes);
    await service.dispose();
    coordinator = new Coordinator(options); service = new HeadlessInteractiveCoordinatorService(coordinator); await service.start();
    await service.loadTranscript(turnId);
    expect(service.getTranscript(turnId)).toEqual(blocks);
    expect(await Promise.all(files.map((file) => readFile(file, "utf8")))).toEqual(bytes);
  } finally { await service.dispose(); await rm(root, { recursive: true, force: true }); }
}, 30_000);
