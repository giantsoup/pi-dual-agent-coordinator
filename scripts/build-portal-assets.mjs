#!/usr/bin/env node

import { rm } from "node:fs/promises";
import { resolve } from "node:path";

import { build } from "vite";

const repoRoot = process.cwd();
const outdir = resolve(repoRoot, "dist/ui/web/assets");

await rm(outdir, {
  recursive: true,
  force: true
});

await build({
  configFile: resolve(repoRoot, "ui/web/vite.config.ts")
});
