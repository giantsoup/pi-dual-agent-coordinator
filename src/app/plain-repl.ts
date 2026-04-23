import { createInterface } from "node:readline/promises";
import { stdin, stdout, stderr } from "node:process";

import type { ReplCliOptions } from "./cli.js";
import { ReplProgressRenderer } from "./repl-progress.js";
import { Coordinator } from "../coordinator/coordinator.js";
import {
  HeadlessInteractiveCoordinatorService,
  type InteractiveCoordinatorService,
  type InteractiveCoordinatorLike
} from "./interactive/service.js";
import { renderConversationEntry } from "./interactive/presentation.js";
import { renderNotificationText } from "./presentation/notices.js";
import type { UiModalState } from "../types/ui.js";
import type { NormalizedTelemetryEvent } from "../types/telemetry.js";
import type { CoordinatorTurnResult } from "../types/workflow.js";
import type { CoordinatorStatusSnapshot } from "../types/status.js";
import type { Role } from "../types/role.js";

export interface ReplReadlineLike {
  question(prompt: string): Promise<string>;
  close(): void;
}

export interface PlainReplDependencies {
  createCoordinator?(options: ReplCliOptions): LegacyCoordinatorLike;
  createService?(options: ReplCliOptions): InteractiveCoordinatorService;
  createReadline?(): ReplReadlineLike;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
  isTTY?: boolean;
}

export interface LegacyCoordinatorLike {
  start(): Promise<void>;
  submitUserInput(text: string): Promise<CoordinatorTurnResult>;
  approvePendingPlan(): Promise<CoordinatorTurnResult>;
  discardPendingPlan(): void;
  getStatus(): CoordinatorStatusSnapshot;
  getSessions(): unknown;
  getLastHandoff(): Promise<unknown>;
  subscribeEvents(listener: (event: NormalizedTelemetryEvent) => void): () => void;
  replaceRuntime(
    role: Role,
    action: { type: "new"; role: Role } | { type: "switch"; role: Role; sessionPath: string }
  ): Promise<void>;
  dispose(): Promise<void>;
}

export async function bootstrapPlainRepl(
  options: ReplCliOptions,
  dependencies: PlainReplDependencies = {}
): Promise<void> {
  const service =
    dependencies.createService?.(options) ??
    (dependencies.createCoordinator
      ? new HeadlessInteractiveCoordinatorService(
          adaptLegacyCoordinator(dependencies.createCoordinator(options))
        )
      : undefined) ??
    new HeadlessInteractiveCoordinatorService(new Coordinator(options));
  await service.start();

  const output = dependencies.stdout ?? stdout;
  const errorOutput = dependencies.stderr ?? stderr;
  const ui = new ReplProgressRenderer({
    stdout: output,
    stderr: errorOutput,
    isTTY:
      dependencies.isTTY ??
      Boolean(
        "isTTY" in (errorOutput as object) && (errorOutput as NodeJS.WriteStream).isTTY
      ),
    getStatus: () => service.getState().status
  });
  ui.renderStartupBanner();

  const unsubscribe = service.subscribeUiEvents((event) => {
    ui.handleUiEvent(event);
  });

  const rl = dependencies.createReadline?.() ??
    createInterface({
      input: stdin,
      output: stdout
    });

  try {
    await runPlainReplLoop(service, rl, { stdout: output, stderr: errorOutput }, ui);
  } finally {
    unsubscribe();
  }
}

export async function runPlainReplLoop(
  service: InteractiveCoordinatorService,
  rl: ReplReadlineLike,
  io: {
    stdout: Pick<NodeJS.WriteStream, "write">;
    stderr: Pick<NodeJS.WriteStream, "write">;
  },
  ui: Pick<ReplProgressRenderer, "getPrompt" | "beforeTextOutput">
): Promise<void> {
  const printedState = {
    conversationCount: service.getState().conversation.length,
    modalTimestamp: "",
    notificationTimestamp: "",
    errorTimestamp: ""
  };

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

      await service.dispatch({
        type: "submit_input",
        input
      });

      ui.beforeTextOutput();
      flushPlainUiOutput(service, printedState, io);
      running = !service.getState().shouldExit;
    }
  } finally {
    rl.close();
    await service.dispose();
  }
}

export function flushPlainUiOutput(
  service: InteractiveCoordinatorService,
  printedState: {
    conversationCount: number;
    modalTimestamp: string;
    notificationTimestamp: string;
    errorTimestamp: string;
  },
  io: {
    stdout: Pick<NodeJS.WriteStream, "write">;
    stderr: Pick<NodeJS.WriteStream, "write">;
  }
): void {
  const state = service.getState();
  const newEntries = state.conversation.slice(printedState.conversationCount);
  printedState.conversationCount = state.conversation.length;

  for (const entry of newEntries) {
    io.stdout.write(`${renderConversationEntry(entry)}\n`);
  }

  if (shouldPrintModal(state.modal, printedState.modalTimestamp)) {
    printedState.modalTimestamp = state.modal.createdAt;
    io.stdout.write(`${state.modal.content}\n`);
  }

  if (
    state.notification &&
    state.notification.createdAt !== printedState.notificationTimestamp
  ) {
    printedState.notificationTimestamp = state.notification.createdAt;
    io.stdout.write(`${renderNotificationText(state.notification)}\n`);
  }

  if (state.lastError && state.lastError.createdAt !== printedState.errorTimestamp) {
    printedState.errorTimestamp = state.lastError.createdAt;
    io.stderr.write(`${renderNotificationText(state.lastError)}\n`);
  }
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

function shouldPrintModal(modal: UiModalState, previousTimestamp: string): modal is Exclude<UiModalState, { kind: "none" }> {
  return modal.kind !== "none" && modal.createdAt !== previousTimestamp;
}

function adaptLegacyCoordinator(
  coordinator: LegacyCoordinatorLike
): InteractiveCoordinatorLike {
  return {
    ...coordinator,
    subscribeRuntimeUiEvents() {
      return () => {};
    }
  };
}
