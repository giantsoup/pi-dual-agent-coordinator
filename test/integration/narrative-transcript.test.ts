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
  let reviews = 0;
  const turnsByHandoff = new Map<string, number>();
  const messages = (value: unknown): string[] => {
    if (!value || typeof value !== "object") return [];
    const items = "messages" in value ? value.messages : "input" in value ? value.input : undefined;
    return Array.isArray(items) ? items.filter((item: unknown) => item && typeof item === "object" && "role" in item && item.role === "user").map((item: unknown) => item && typeof item === "object" && "content" in item ? allText(item.content) : "") : [];
  };
  const options = { cwd, sessionRoot: join(root, "state"), sessionMode: "persistent" as const, jsonLogs: false, verbose: false,
    createRoleRuntime: (input: Parameters<typeof createRoleRuntime>[0]) => createRoleRuntime({ ...input, providerTestBackend: {
      cwd, modelIds: [], load: async () => `dummy-${randomUUID()}`, request: async (_url, init) => {
        const users = messages(JSON.parse(String(init?.body)));
        const body = users.at(-1) ?? "";
        if (input.role === "B") {
          workerTurns++;
          const handoff = [...users].reverse().find((item) => item.includes("Coordinator handoff for Agent B.")) ?? body;
          const workflowId = field(handoff, "Workflow ID"), handoffId = field(handoff, "Handoff ID");
          const iteration = Number(field(handoff, "Iteration"));
          const turn = (turnsByHandoff.get(handoffId) ?? 0) + 1; turnsByHandoff.set(handoffId, turn);
          if (turn === 1) return fixtureChatToolResponse("write", { path: "result.txt", content: iteration === 1 ? "fixed" : "revised" }, `write-${iteration}`, iteration === 1 ? "I am applying the arithmetic fix." : "I am applying the requested revision.");
          if (turn <= (iteration === 1 ? 11 : 2)) return fixtureChatToolResponse("read", { path: "result.txt" }, `verify-${iteration}-${turn}`, turn === 11 ? "I am continuing after the senior check-in." : turn === 2 ? "The change is saved. I will verify the result." : undefined);
          return fixtureChatResponse("The file now contains the verified result.\n" + block("pi-completion", { schemaVersion: 1, workflowId, handoffId, iteration, summary: "Fixed arithmetic", changedPaths: ["result.txt"], verification: ["Read result.txt"] }));
        }
        if (body.includes("Coordinator process check-in")) return fixtureResponse(block("pi-check-in", {
          schemaVersion: 1, workflowId: field(body, "Workflow ID"), handoffId: field(body, "Handoff ID"), iteration: Number(field(body, "Iteration")), turnCount: 10,
          decision: "continue", reason: "The observed read and write results support continuing.", nextSteps: []
        }));
        if (body.includes("Coordinator review prompt")) {
          reviews++;
          if (reviews === 1) return fixtureResponse("One revision is required.\n" + block("pi-handoff", { schemaVersion: 1, workflowId: field(body, "Workflow ID"), handoffId: randomUUID(), iteration: 2,
            objective: "Revise arithmetic", summary: "Revise the result", acceptanceCriteria: ["result.txt contains revised"], relevantPaths: ["result.txt"], reviewNotes: ["Write revised and read it back"] }));
          return fixtureResponse("I reviewed the retained evidence.\n" + block("pi-final", { schemaVersion: 1, workflowId: field(body, "Workflow ID"), iteration: 2, decision: "approved", summary: "Verified", userResponse: "The arithmetic fix is complete.", changedPaths: ["result.txt"] }));
        }
        return fixtureResponse("I found an arithmetic issue and propose a focused fix.\n" + block("pi-plan", { schemaVersion: 1, objective: "Fix arithmetic", summary: "Correct the result", acceptanceCriteria: ["result.txt contains fixed"], relevantPaths: ["result.txt"], executionPlan: ["Write result.txt and read it back"] }));
      }
    } }) };
  let coordinator = new Coordinator(options);
  let service = new HeadlessInteractiveCoordinatorService(coordinator);
  try {
    await service.start(); await service.dispatch({ type: "submit_input", input: "Propose the arithmetic fix" });
    expect(service.getState().pendingPlan).toBeDefined();
    expect(workerTurns).toBe(0);
    expect(service.getState().currentActivity.action.kind).toBe("approval_waiting");
    const observed: Array<{ role: string; runId: string; action: string }> = [];
    const unsubscribe = service.subscribeState((state) => {
      const activity = state.currentActivity;
      if (activity.owner.kind === "runtime") observed.push({ role: activity.owner.role, runId: activity.owner.runId, action: activity.action.kind });
    });
    await service.dispatch({ type: "approve_pending_plan" });
    unsubscribe();
    expect(await readFile(join(cwd, "result.txt"), "utf8")).toBe("revised");
    expect(workerTurns).toBe(15);
    expect(observed.some((item) => item.action === "tool_preparation")).toBe(true);
    expect(observed.some((item) => item.action === "tool_execution")).toBe(true);
    const senior = observed.findIndex((item) => item.role === "A");
    const beforeCheck = observed.slice(0, senior).reverse().find((item) => item.role === "B");
    const afterCheck = observed.slice(senior).find((item) => item.role === "B");
    expect(beforeCheck?.runId).toBeDefined(); expect(afterCheck?.runId).toBe(beforeCheck?.runId);
    const turnId = service.getState().history.currentTurnId;
    if (!turnId) throw new Error("Missing request");
    const sessions = coordinator.getSessions();
    const runs = service.getState().history.records.filter((record) => record.kind === "run");
    const files = [...new Set(runs.flatMap((run) => run.sessionFile ? [run.sessionFile] : []))];
    const bytes = await Promise.all(files.map((file) => readFile(file, "utf8")));
    await service.loadTranscript(turnId);
    const blocks = service.getTranscript(turnId);
    const text = blocks.map((entry) => entry.kind === "response" ? entry.text : entry.kind === "milestone" ? entry.label : "TOOLS").join("\n");
    expect(text).toMatch(/found an arithmetic[\s\S]*applying the arithmetic[\s\S]*TOOLS[\s\S]*change is saved[\s\S]*TOOLS[\s\S]*verified result[\s\S]*reviewed the retained/);
    expect(text).not.toMatch(/pi-plan|schemaVersion|pi-completion|pi-final/);
    expect(blocks.filter((entry) => entry.kind === "tools").reduce((total, entry) => total + entry.callIds.length, 0)).toBe(13);
    const milestones = blocks.filter((entry) => entry.kind === "milestone").map((entry) => entry.label);
    expect(milestones).toEqual(["Plan ready / waiting for operator approval", "Operator approved the plan / execution authorized", "Coordinator requested an A check-in", "A check-in / continue execution", "A requested a revision / next handoff prepared", "A approved the result"]);
    expect(runs.filter((run) => run.role === "A" && run.phase === "Review").map((run) => run.reviewDisposition)).toEqual(["revision_requested", "approved"]);
    expect(text).toMatch(/observed read and write[\s\S]*continuing after the senior[\s\S]*One revision[\s\S]*requested a revision[\s\S]*applying the requested revision[\s\S]*reviewed the retained/);
    const terminal = new MemoryTerminal(); terminal.columns = 120; terminal.rows = 80;
    const app = new CoordinatorTuiApp(new TuiMainScreen(terminal), terminal, service, { onExit() {} });
    app.handleInput("keep draft");
    const screen = stripTerminalSequences(app.render(120).join("\n"));
    expect(screen).toContain("applying the requested revision"); expect(screen).toContain("I reviewed the retained evidence");
    app.handleInput("\x1bw"); app.handleInput("g");
    const beginning = stripTerminalSequences(app.render(120).join("\n"));
    expect(beginning).toContain("applying the arithmetic fix");
    expect(beginning).toContain("Operator approved the plan");
    expect(beginning).toContain("tool call"); expect(screen).not.toContain("[completed] write result.txt");
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
