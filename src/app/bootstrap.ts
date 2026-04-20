import type { Terminal } from "@mariozechner/pi-tui";

import { parseReplCommand } from "./cli.js";
import type { ReplCliOptions } from "./cli.js";
import {
  bootstrapPlainRepl,
  isReplTerminationError,
  type LegacyCoordinatorLike,
  type PlainReplDependencies,
  type ReplReadlineLike
} from "./plain-repl.js";
import { renderPendingPlan } from "./interactive/presentation.js";
import { bootstrapTuiRepl, type BootstrapTuiDependencies } from "./tui/bootstrap.js";
import type { CoordinatorTurnResult } from "../types/workflow.js";

export type { LegacyCoordinatorLike as ReplCoordinatorLike, ReplReadlineLike };
export { bootstrapPlainRepl, isReplTerminationError };

export interface ReplUiLike {
  renderHelp(): void;
  getPrompt(): string;
  beforeTextOutput(): void;
}

export interface BootstrapReplDependencies
  extends PlainReplDependencies,
    BootstrapTuiDependencies {
  isTTY?: boolean;
  createTerminal?(): Terminal;
}

export async function bootstrapRepl(
  options: ReplCliOptions,
  dependencies: BootstrapReplDependencies = {}
): Promise<void> {
  const useTui =
    !options.plainUi &&
    (dependencies.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY));

  if (useTui) {
    await bootstrapTuiRepl(options, {
      ...(dependencies.createService ? { createService: dependencies.createService } : {}),
      ...(dependencies.createTerminal
        ? { createTerminal: dependencies.createTerminal }
        : {})
    });
    return;
  }

  await bootstrapPlainRepl(options, {
    ...(dependencies.createCoordinator
      ? { createCoordinator: dependencies.createCoordinator }
      : {}),
    ...(dependencies.createService ? { createService: dependencies.createService } : {}),
    ...(dependencies.createReadline ? { createReadline: dependencies.createReadline } : {}),
    ...(dependencies.stdout ? { stdout: dependencies.stdout } : {}),
    ...(dependencies.stderr ? { stderr: dependencies.stderr } : {}),
    ...(dependencies.isTTY !== undefined ? { isTTY: dependencies.isTTY } : {})
  });
}

export async function runReplLoop(
  coordinator: LegacyCoordinatorLike,
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
