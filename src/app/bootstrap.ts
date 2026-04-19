import { createInterface } from "node:readline/promises";
import { stdin, stdout, stderr } from "node:process";

import { parseReplCommand, type ReplCliOptions } from "./cli.js";
import { ReplProgressRenderer } from "./repl-progress.js";
import { Coordinator } from "../coordinator/coordinator.js";
import type { CoordinatorStatusSnapshot } from "../types/status.js";
import type { NormalizedTelemetryEvent } from "../types/telemetry.js";
import type { CoordinatorTurnResult, PendingExecutionPlanSnapshot } from "../types/workflow.js";

export interface ReplCoordinatorLike {
  start(): Promise<void>;
  submitUserInput(text: string): Promise<CoordinatorTurnResult>;
  approvePendingPlan(): Promise<CoordinatorTurnResult>;
  discardPendingPlan(): void;
  getStatus(): CoordinatorStatusSnapshot;
  getSessions(): unknown;
  getLastHandoff(): Promise<unknown>;
  subscribeEvents(listener: (event: NormalizedTelemetryEvent) => void): () => void;
  replaceRuntime(
    role: "A" | "B",
    action: { type: "new"; role: "A" | "B" } | { type: "switch"; role: "A" | "B"; sessionPath: string }
  ): Promise<void>;
  dispose(): Promise<void>;
}

export interface ReplReadlineLike {
  question(prompt: string): Promise<string>;
  close(): void;
}

export interface BootstrapReplDependencies {
  createCoordinator?(options: ReplCliOptions): ReplCoordinatorLike;
  createReadline?(): ReplReadlineLike;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
  isTTY?: boolean;
}

export interface ReplUiLike {
  renderHelp(): void;
  getPrompt(): string;
  beforeTextOutput(): void;
}

export async function bootstrapRepl(
  options: ReplCliOptions,
  dependencies: BootstrapReplDependencies = {}
): Promise<void> {
  const coordinator =
    dependencies.createCoordinator?.(options) ?? new Coordinator(options);
  await coordinator.start();
  const output = dependencies.stdout ?? stdout;
  const errorOutput = dependencies.stderr ?? stderr;
  const ui = new ReplProgressRenderer({
    stdout: output,
    stderr: errorOutput,
    isTTY:
      dependencies.isTTY ??
      Boolean("isTTY" in (errorOutput as object) && (errorOutput as NodeJS.WriteStream).isTTY),
    getStatus: () => coordinator.getStatus()
  });
  ui.renderStartupBanner();
  const unsubscribe = coordinator.subscribeEvents((event) => {
    ui.handleEvent(event);
  });

  const rl = dependencies.createReadline?.() ?? createInterface({
    input: stdin,
    output: stdout
  });

  try {
    await runReplLoop(coordinator, rl, {
      stdout: output,
      stderr: errorOutput
    }, ui);
  } finally {
    unsubscribe();
  }
}

export async function runReplLoop(
  coordinator: ReplCoordinatorLike,
  rl: ReplReadlineLike,
  io: {
    stdout: Pick<NodeJS.WriteStream, "write">;
    stderr: Pick<NodeJS.WriteStream, "write">;
  },
  ui: ReplUiLike
): Promise<void> {
  try {
    let running = true;
    while (running) {
      let input: string;
      try {
        input = await rl.question(ui.getPrompt());
      } catch (error) {
        if (isReplTerminationError(error)) {
          break;
        }
        throw error;
      }

      try {
        const command = parseReplCommand(input);

        switch (command.type) {
          case "user_turn": {
            if (!command.text) {
              break;
            }
            const result = await coordinator.submitUserInput(command.text);
            ui.beforeTextOutput();
            io.stdout.write(renderTurnResult(result));
            break;
          }
          case "help":
            ui.beforeTextOutput();
            ui.renderHelp();
            break;
          case "status":
            ui.beforeTextOutput();
            io.stdout.write(`${JSON.stringify(coordinator.getStatus(), null, 2)}\n`);
            break;
          case "approve": {
            const result = await coordinator.approvePendingPlan();
            ui.beforeTextOutput();
            io.stdout.write(renderTurnResult(result));
            break;
          }
          case "discard": {
            const hadPendingPlan = coordinator.getStatus().pendingPlanReady;
            coordinator.discardPendingPlan();
            ui.beforeTextOutput();
            io.stdout.write(
              hadPendingPlan
                ? "Discarded the pending plan.\n"
                : "No pending plan to discard.\n"
            );
            break;
          }
          case "sessions":
            ui.beforeTextOutput();
            io.stdout.write(`${JSON.stringify(coordinator.getSessions(), null, 2)}\n`);
            break;
          case "handoff":
            ui.beforeTextOutput();
            io.stdout.write(`${JSON.stringify(await coordinator.getLastHandoff(), null, 2)}\n`);
            break;
          case "new":
            await coordinator.replaceRuntime(command.role, command);
            ui.beforeTextOutput();
            io.stdout.write(`Created new session for role ${command.role}\n`);
            break;
          case "switch":
            await coordinator.replaceRuntime(command.role, command);
            ui.beforeTextOutput();
            io.stdout.write(`Switched role ${command.role} to ${command.sessionPath}\n`);
            break;
          case "quit":
            running = false;
            break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        io.stderr.write(`Error: ${message}\n`);
      }
    }
  } finally {
    rl.close();
    await coordinator.dispose();
  }
}

export function renderTurnResult(result: CoordinatorTurnResult): string {
  if (!result.pendingPlan) {
    return `${result.userResponse}\n`;
  }

  const sections: string[] = [];
  const prose = result.userResponse.trim();
  if (prose) {
    sections.push(prose);
  }
  sections.push(renderPendingPlan(result.pendingPlan, result.nextActionHint));
  return `${sections.join("\n\n")}\n`;
}

function renderPendingPlan(
  pendingPlan: PendingExecutionPlanSnapshot,
  nextActionHint?: string
): string {
  const lines = [
    "Plan Ready · Agent A",
    `Objective: ${pendingPlan.objective}`,
    `Summary: ${pendingPlan.summary}`,
    "Acceptance Criteria:",
    ...pendingPlan.acceptanceCriteria.map((item) => `- ${item}`),
    "Relevant Paths:",
    ...pendingPlan.relevantPaths.map((item) => `- ${item}`),
    "Execution Steps:",
    ...pendingPlan.executionPlan.map((item) => `- ${item}`)
  ];

  if (pendingPlan.constraints?.length) {
    lines.push("Constraints:");
    lines.push(...pendingPlan.constraints.map((item) => `- ${item}`));
  }

  lines.push(`Next: ${nextActionHint ?? "Run /approve to start coordinated execution with Agent B."}`);
  return lines.join("\n");
}

export function isReplTerminationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
  return (
    code === "ERR_USE_AFTER_CLOSE" ||
    error.name === "AbortError" ||
    error.message.includes("readline was closed")
  );
}
