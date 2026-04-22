import { existsSync } from "node:fs";
import { access, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { PortalBootstrapConfigDto } from "./protocol.js";

export interface PortalAssetBundle {
  css: string;
  js: string;
}

let bundlePromise: Promise<PortalAssetBundle> | undefined;

export async function loadPortalAssetBundle(): Promise<PortalAssetBundle> {
  bundlePromise ??= readBuiltPortalAssetBundle()
    .then((builtBundle) => {
      if (builtBundle) {
        return builtBundle;
      }
      return buildPortalAssetBundleFromSource();
    })
    .catch((error) => {
      bundlePromise = undefined;
      throw error;
    });

  return bundlePromise;
}

export function renderPortalIndexHtml(
  bootstrap: PortalBootstrapConfigDto,
  cspNonce: string
): string {
  const configJson = JSON.stringify(bootstrap).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <title>pi-dual portal</title>
    <link rel="stylesheet" href="/assets/portal.css" />
    <script nonce="${cspNonce}">window.__PI_DUAL_PORTAL__ = ${configJson};</script>
    <script type="module" src="/assets/portal.js"></script>
  </head>
  <body>
    <noscript>This portal requires JavaScript.</noscript>
    <div id="root"></div>
  </body>
</html>`;
}

async function readBuiltPortalAssetBundle(): Promise<PortalAssetBundle | undefined> {
  const repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
  const jsPath = resolve(repoRoot, "dist/ui/web/assets/portal.js");
  const cssPath = resolve(repoRoot, "dist/ui/web/assets/portal.css");

  try {
    await Promise.all([access(jsPath), access(cssPath)]);
  } catch {
    return undefined;
  }

  const [js, css] = await Promise.all([
    readFile(jsPath, "utf8"),
    readFile(cssPath, "utf8")
  ]);

  return {
    css,
    js
  };
}

async function buildPortalAssetBundleFromSource(): Promise<PortalAssetBundle> {
  const repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
  const outDir = resolve(repoRoot, "ui/web/.cache-assets");
  const { build } = await import("vite");
  await rm(outDir, {
    recursive: true,
    force: true
  });
  await build({
    configFile: resolve(repoRoot, "ui/web/vite.config.ts"),
    build: {
      emptyOutDir: true,
      minify: false,
      outDir
    }
  });

  const [js, css] = await Promise.all([
    readFile(resolve(outDir, "portal.js"), "utf8"),
    readFile(resolve(outDir, "portal.css"), "utf8")
  ]);

  return {
    css,
    js
  };
}

function findRepoRoot(startDir: string): string {
  let currentDir = startDir;

  for (;;) {
    const packageJsonPath = resolve(currentDir, "package.json");
    if (existsSync(packageJsonPath)) {
      return currentDir;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error("Unable to locate the repository root for portal assets.");
    }
    currentDir = parentDir;
  }
}
