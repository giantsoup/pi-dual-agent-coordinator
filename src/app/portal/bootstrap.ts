import type { PortalCliOptions } from "../cli.js";
import { openUrlInBrowser, type BrowserOpenResult } from "../browser.js";
import {
  HeadlessInteractiveCoordinatorService,
  type InteractiveCoordinatorService
} from "../interactive/service.js";
import { renderStartupInstructions } from "../presentation/notices.js";
import { startInteractivePortalServer } from "./server.js";
import { Coordinator } from "../../coordinator/coordinator.js";

export interface BootstrapPortalDependencies {
  createService?(options: PortalCliOptions): InteractiveCoordinatorService;
  launchOptions?: PortalCliOptions | undefined;
  startServer?(
    options: Parameters<typeof startInteractivePortalServer>[0]
  ): ReturnType<typeof startInteractivePortalServer>;
  openBrowser?(url: string): Promise<BrowserOpenResult>;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
}

export async function bootstrapPortal(
  options: PortalCliOptions,
  dependencies: BootstrapPortalDependencies = {}
): Promise<void> {
  const service =
    dependencies.createService?.(options) ??
    new HeadlessInteractiveCoordinatorService(new Coordinator(options), {
      createCoordinator: (nextOptions) => new Coordinator(nextOptions),
      portalOptions: dependencies.launchOptions ?? options
    });
  let portal:
    | Awaited<ReturnType<typeof startInteractivePortalServer>>
    | undefined;
  let removeSignalHandlers = () => {};
  let unsubscribe = () => {};
  try {
    await service.start();

    const stdout = dependencies.stdout ?? process.stdout;
    portal = await (dependencies.startServer ?? startInteractivePortalServer)({
      service,
      port: options.port
    });
    const browserOpenResult = await (dependencies.openBrowser ?? openUrlInBrowser)(
      portal.launchUrl
    );
    const startup = renderStartupInstructions({
      browserOpenStatus: browserOpenResult.status,
      healthCheckUrl: portal.healthCheckUrl,
      launchUrl: portal.launchUrl,
      projectPath: options.cwd
    });

    const stopGate = createStopGate();
    removeSignalHandlers = installSignalHandlers(stopGate.stop);
    unsubscribe = service.subscribeState((state) => {
      if (state.shouldExit) {
        stopGate.stop();
      }
    });

    for (const line of startup.lines) {
      stdout.write(`${line}\n`);
    }

    await stopGate.wait;
  } finally {
    try {
      removeSignalHandlers();
      unsubscribe();
      await portal?.stop();
    } finally {
      await service.dispose();
    }
  }
}

function createStopGate(): {
  wait: Promise<void>;
  stop(): void;
} {
  let stopped = false;
  let resolveStop: (() => void) | undefined;

  return {
    wait: new Promise<void>((resolve) => {
      resolveStop = resolve;
    }),
    stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      resolveStop?.();
    }
  };
}

function installSignalHandlers(stop: () => void): () => void {
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  for (const signal of signals) {
    process.on(signal, stop);
  }

  return () => {
    for (const signal of signals) {
      process.off(signal, stop);
    }
  };
}
