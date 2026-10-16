import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { installationRoot } from "./isolation.js";

export const credentialHelper = join(installationRoot, "dist", "native", "credential-store");
export function credentialAccount(cwd: string): string {
  return createHash("sha256").update(realpathSync(cwd)).digest("hex");
}
const helperEnv = { PATH: "/usr/bin:/bin", HOME: homedir() };

export async function credentialStatus(cwd: string): Promise<boolean> {
  try { await callHelper("status", credentialAccount(cwd)); return true; } catch { return false; }
}

export async function enterCredential(cwd: string): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Private credential entry requires your own interactive local terminal and the macOS secure dialog. No piped or chat entry is accepted.");
  }
  await callHelper("enter", credentialAccount(cwd), true);
}

// Trusted backend only. This module is never imported by a tool worker.
export async function loadCredential(cwd: string): Promise<string> {
  return callHelper("load", credentialAccount(cwd));
}

async function callHelper(mode: "enter" | "load" | "status", account: string, interactive = false): Promise<string> {
  if (process.platform !== "darwin") throw new Error("Secure Keychain storage requires macOS.");
  return new Promise((resolve, reject) => {
    const child = spawn(credentialHelper, [mode, account], {
      env: helperEnv, stdio: interactive ? ["inherit", "inherit", "ignore", "pipe"] : ["ignore", "ignore", "ignore", "pipe"]
    });
    let secret = "";
    const pipe = child.stdio[3];
    if (pipe && "on" in pipe) pipe.on("data", (chunk: Buffer) => {
      secret += chunk.toString("utf8");
      if (secret.length > 4096) child.kill("SIGKILL");
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), interactive ? 180_000 : 10_000);
    child.once("error", () => reject(new Error("Secure credential helper unavailable. Run the build on macOS.")));
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || (mode === "load" && !secret)) reject(new Error("Keychain credential is missing, locked, or unavailable. Use private local setup; no plaintext fallback is available."));
      else resolve(secret);
    });
  });
}
