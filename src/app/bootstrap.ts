import type { Terminal } from "@earendil-works/pi-tui";

import { HeadlessInteractiveCoordinatorService } from "./interactive/service.js";
import type { ReplCliOptions } from "./cli.js";
import {
  bootstrapPlainRepl,
  runPlainReplLoop,
  adaptLegacyCoordinator,
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
  const service = new HeadlessInteractiveCoordinatorService(adaptLegacyCoordinator(coordinator));
  try {
    await service.start();
    await runPlainReplLoop(service, rl, io, ui);
  } finally { await service.dispose(); }
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
