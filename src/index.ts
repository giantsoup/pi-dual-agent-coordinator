#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import { formatCliHelp, parseCliArgs } from "./app/cli.js";
import { assertRuntimeSetupReady, runDoctor } from "./app/doctor.js";
import { bootstrapRepl } from "./app/bootstrap.js";

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));

  switch (options.command) {
    case "help":
      process.stdout.write(formatCliHelp(options.topic));
      return;
    case "version":
      process.stdout.write(`${await readPackageVersion()}\n`);
      return;
    case "doctor":
      process.exitCode = await runDoctor(options);
      return;
    case "repl":
      await assertRuntimeSetupReady(options);
      await bootstrapRepl(options);
      return;
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
