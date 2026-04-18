#!/usr/bin/env node

import { bootstrapRepl } from "./app/bootstrap.js";
import { parseCliArgs } from "./app/cli.js";

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  await bootstrapRepl(options);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
