import { ProcessTerminal, TUI, type Terminal } from "@mariozechner/pi-tui";

import type { ReplCliOptions } from "../cli.js";
import {
  HeadlessInteractiveCoordinatorService,
  type InteractiveCoordinatorService
} from "../interactive/service.js";
import { CoordinatorTuiApp } from "./app.js";
import { Coordinator } from "../../coordinator/coordinator.js";

export interface BootstrapTuiDependencies {
  createService?(options: ReplCliOptions): InteractiveCoordinatorService;
  createTerminal?(): Terminal;
}

export async function bootstrapTuiRepl(
  options: ReplCliOptions,
  dependencies: BootstrapTuiDependencies = {}
): Promise<void> {
  const service =
    dependencies.createService?.(options) ??
    new HeadlessInteractiveCoordinatorService(new Coordinator(options));
  try {
    await runTerminal(service, dependencies);
  } finally { await service.dispose(); }
}

async function runTerminal(service: InteractiveCoordinatorService, dependencies: BootstrapTuiDependencies): Promise<void> {
  const terminal = dependencies.createTerminal?.() ?? new ProcessTerminal();
  const tui = new TUI(terminal, true);
  let resolveExit: (() => void) | undefined;
  const exitPromise = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });

  const app = new CoordinatorTuiApp(tui, terminal, service, {
    onExit: () => {
      resolveExit?.();
    }
  });
  tui.addChild(app);
  tui.setFocus(app);

  const unsubscribe = service.subscribeState((state) => {
    tui.requestRender();
    if (state.shouldExit) {
      resolveExit?.();
    }
  });

  const shutdown = () => { void service.dispatch({ type: "quit" }).finally(() => resolveExit?.()); };
  const signals = ["SIGTERM", "SIGHUP", "SIGINT"] as const;
  for (const signal of signals) process.on(signal, shutdown);
  const elapsedTimer = setInterval(() => { if (service.getState().operation.kind === "running" || service.getState().modal.kind === "model_loading") tui.requestRender(); }, 500);
  terminal.write("\u001B[?1049h");
  try {
    tui.start();
    terminal.write("\u001B[?1000h\u001B[?1006h");
    tui.requestRender(true);
    await service.start();
    tui.requestRender(true);
    await exitPromise;
  } finally {
    clearInterval(elapsedTimer);
    for (const signal of signals) process.off(signal, shutdown);
    unsubscribe();
    try {
      // Pi 0.67.68 enables its keyboard fallback after 150 ms, even if startup throws.
      await terminal.drainInput(1000, 200).catch(() => undefined);
      tui.stop();
    } finally { terminal.write("\u001B[?1006l\u001B[?1000l\u001B[?25h\u001B[?1049l"); }
  }
}
