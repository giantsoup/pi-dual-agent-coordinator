import { safeDisplayText } from "../security/display-text.js";
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

export interface ReplReadlineLike {
  question(prompt: string): Promise<string>;
  close(): void;
  write?(data: string): void;
  on?(event: "SIGINT" | "close", listener: () => void): unknown;
  off?(event: "SIGINT" | "close", listener: () => void): unknown;
}

export interface PlainReplDependencies {
  createCoordinator?(options: ReplCliOptions): LegacyCoordinatorLike;
  createService?(options: ReplCliOptions): InteractiveCoordinatorService;
  createReadline?(): ReplReadlineLike;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
  isTTY?: boolean;
}

export type LegacyCoordinatorLike = Omit<InteractiveCoordinatorLike, "subscribeRuntimeUiEvents">;

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
  try {
    await service.start();
    await runPlainTerminal(service, dependencies);
  } finally { await service.dispose(); }
}

async function runPlainTerminal(service: InteractiveCoordinatorService, dependencies: PlainReplDependencies): Promise<void> {

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

  let readlineClosed = false;
  const close = () => { if (!readlineClosed) { readlineClosed = true; rl.close(); } };
  const pending = new Set<Promise<void>>();
  let resolveExit: (value: undefined) => void = () => {};
  const exit = new Promise<undefined>((resolve) => { resolveExit = resolve; });
  const closed = () => { readlineClosed = true; resolveExit(undefined); };
  const flush = () => {
    ui.beforeTextOutput();
    flushPlainUiOutput(service, printedState, io);
    if (service.getState().shouldExit) { resolveExit(undefined); close(); }
  };
  const unsubscribe = service.subscribeState(flush);
  let lastInterrupt = 0;
  const interrupt = () => {
    if (["running", "cancelling"].includes(service.getState().operation.kind)) {
      void service.dispatch({ type: "cancel" });
    } else if (Date.now() - lastInterrupt < 1200) {
      void service.dispatch({ type: "quit" });
      close();
    } else {
      lastInterrupt = Date.now();
      io.stdout.write("\nPress Ctrl+C again to exit, or use /quit.\n");
    }
  };
  const shutdown = () => { void service.dispatch({ type: "quit" }).finally(() => rl.close()); };
  rl.on?.("SIGINT", interrupt);
  rl.on?.("close", closed);
  process.on("SIGTERM", shutdown);
  process.on("SIGHUP", shutdown);
  try {
    let running = true;
    let rejectedDraft: string | undefined;
    while (running) {
      let input: string;
      try {
        const answer = rl.question(ui.getPrompt());
        if (rejectedDraft && rl.write) rl.write(rejectedDraft);
        rejectedDraft = undefined;
        const result = await Promise.race([answer, exit]);
        if (result === undefined) break;
        input = result;
      } catch (error) {
        if (isReplTerminationError(error)) {
          break;
        }
        throw error;
      }

      let accepted = false;
      const work = service.dispatch({ type: "submit_input", input }, () => { accepted = true; });
      pending.add(work);
      void work.finally(() => pending.delete(work));
      // Give immediate commands time to settle; keep readline available during provider work.
      await Promise.race([work, new Promise<void>((resolve) => setImmediate(resolve))]);

      if (!accepted && input.trim()) {
        rejectedDraft = input;
        io.stdout.write(`Unsubmitted draft: ${input}\n`);
      }
      ui.beforeTextOutput();
      flushPlainUiOutput(service, printedState, io);
      running = !service.getState().shouldExit;
    }
  } finally {
    unsubscribe();
    rl.off?.("SIGINT", interrupt);
    rl.off?.("close", closed);
    process.off("SIGTERM", shutdown);
    process.off("SIGHUP", shutdown);
    close();
    await service.dispose();
    await Promise.allSettled(pending);
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
    if (entry.kind !== "error") io.stdout.write(`${safeDisplayText(renderConversationEntry(entry))}\n`);
  }

  if (shouldPrintModal(state.modal, printedState.modalTimestamp)) {
    printedState.modalTimestamp = state.modal.createdAt;
    io.stdout.write(`${safeDisplayText(state.modal.content)}\n`);
  }

  if (
    state.notification &&
    state.notification.id !== printedState.notificationTimestamp
  ) {
    printedState.notificationTimestamp = state.notification.id;
    io.stdout.write(`${safeDisplayText(renderNotificationText(state.notification))}\n`);
  }

  if (state.lastError && state.lastError.id !== printedState.errorTimestamp) {
    printedState.errorTimestamp = state.lastError.id;
    io.stderr.write(`${safeDisplayText(renderNotificationText(state.lastError))}\n`);
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

export function adaptLegacyCoordinator(
  coordinator: LegacyCoordinatorLike
): InteractiveCoordinatorLike {
  return {
    start: () => coordinator.start(),
    submitUserInput: (text) => coordinator.submitUserInput(text),
    approvePendingPlan: () => coordinator.approvePendingPlan(),
    discardPendingPlan: () => coordinator.discardPendingPlan(),
    getStatus: () => coordinator.getStatus(),
    getSessions: () => coordinator.getSessions(),
    getLastHandoff: () => coordinator.getLastHandoff(),
    subscribeEvents: (listener) => coordinator.subscribeEvents(listener),
    replaceRuntime: (role, action) => coordinator.replaceRuntime(role, action),
    dispose: () => coordinator.dispose(),
    ...(coordinator.cancelActive ? { cancelActive: coordinator.cancelActive.bind(coordinator) } : {}),
    ...(coordinator.getAvailableModels ? { getAvailableModels: coordinator.getAvailableModels.bind(coordinator) } : {}),
    ...(coordinator.getSavedSessions ? { getSavedSessions: coordinator.getSavedSessions.bind(coordinator) } : {}),
    ...(coordinator.getSessionHistory ? { getSessionHistory: coordinator.getSessionHistory.bind(coordinator) } : {}),
    ...(coordinator.configureRole ? { configureRole: coordinator.configureRole.bind(coordinator) } : {}),
    ...(coordinator.configureDefaults ? { configureDefaults: coordinator.configureDefaults.bind(coordinator) } : {}),
    subscribeRuntimeUiEvents() {
      return () => {};
    }
  };
}
