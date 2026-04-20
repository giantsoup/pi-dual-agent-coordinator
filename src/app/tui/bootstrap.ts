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
  await service.start();

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
    tui.requestRender(true);
    if (state.shouldExit) {
      resolveExit?.();
    }
  });

  terminal.write("\u001B[?1049h");
  try {
    tui.start();
    tui.requestRender(true);
    await exitPromise;
  } finally {
    unsubscribe();
    tui.stop();
    await terminal.drainInput().catch(() => undefined);
    terminal.write("\u001B[?1049l");
    await service.dispose();
  }
}
