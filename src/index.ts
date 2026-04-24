#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import { formatCliHelp, parseCliArgs } from "./app/cli.js";
import {
  applyCoordinatorDefaultsToCliOptions,
  loadCoordinatorConfig
} from "./app/coordinator-config.js";
import { assertRuntimeSetupReady, runDoctor } from "./app/doctor.js";
import { bootstrapRepl } from "./app/bootstrap.js";
import { applyScopedSettingsToCliOptions } from "./app/settings-store.js";
import { bootstrapPortal } from "./app/portal/bootstrap.js";
import { runAuthWizard, runSetupWizard } from "./app/setup.js";

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));

  switch (options.command) {
    case "help":
      process.stdout.write(formatCliHelp(options.topic));
      return;
    case "version":
      process.stdout.write(`${await readPackageVersion()}\n`);
      return;
    case "setup":
      process.exitCode = await runSetupWizard(options);
      return;
    case "auth":
      process.exitCode = await runAuthWizard(options);
      return;
    case "doctor":
      process.exitCode = await runDoctor(options);
      return;
    case "repl": {
      const loadedConfig = await loadCoordinatorConfig();
      const resolvedOptions = applyCoordinatorDefaultsToCliOptions(
        await applyScopedSettingsToCliOptions(options),
        loadedConfig.config
      );
      await assertRuntimeSetupReady(resolvedOptions);
      await bootstrapRepl(resolvedOptions);
      return;
    }
    case "portal": {
      const loadedConfig = await loadCoordinatorConfig();
      const resolvedOptions = applyCoordinatorDefaultsToCliOptions(
        await applyScopedSettingsToCliOptions(options),
        loadedConfig.config
      );
      await assertRuntimeSetupReady(resolvedOptions);
      await bootstrapPortal(resolvedOptions, {
        launchOptions: options
      });
      return;
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

async function readPackageVersion(): Promise<string> {
  const raw = await readFile(new URL("../../package.json", import.meta.url), "utf8");
  const parsed = JSON.parse(raw) as { version?: string };
  return parsed.version ?? "0.0.0";
}
