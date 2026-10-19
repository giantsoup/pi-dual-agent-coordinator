import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, join } from "node:path";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessageSchema } from "@modelcontextprotocol/sdk/types.js";
import { serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import { installationRoot } from "../security/isolation.js";
import type { resolveBrowserInstallation } from "./policy.js";

export function browserSandboxProfile(scratch: string, runtimeRoot: string, proxyPort: number): string {
  const roots = ["/usr", "/System", "/bin", "/sbin", "/Applications/Google Chrome.app", installationRoot, runtimeRoot, scratch];
  return `(version 1)
(deny default)
(import "system.sb")
(allow process-exec process-fork)
(allow file-read* file-map-executable ${roots.map(path => `(subpath ${JSON.stringify(path)})`).join(" ")})
(allow file-read-metadata ${roots.map(path => `(path-ancestors ${JSON.stringify(path)})`).join(" ")})
(allow file-write* (subpath ${JSON.stringify(scratch)}))
(allow sysctl-read)
(deny sysctl-read (sysctl-name-regex #"^kern.proc"))
(allow process-info* (target self))
(allow signal (target self) (target same-sandbox))
(allow network-bind network-outbound (subpath ${JSON.stringify(scratch)}))
(allow network-outbound (remote tcp "localhost:${proxyPort}"))
(allow mach-lookup ${["com.apple.cfprefsd.agent", "com.apple.cfprefsd.daemon", "com.apple.system.logger", "com.apple.logd", "com.apple.notifyd", "com.apple.FontObjectsServer", "com.apple.coreservices.launchservicesd", "com.apple.coreservices.coreservicesd"].map(name => `(global-name ${JSON.stringify(name)})`).join(" ")}
  (global-name-regex #"^(org[.]chromium|com[.]google[.]Chrome)[.]")
  (local-name-regex #"^(org[.]chromium|com[.]google[.]Chrome)[.]"))
(allow mach-register (global-name-regex #"^(org[.]chromium|com[.]google[.]Chrome)[.]") (local-name-regex #"^(org[.]chromium|com[.]google[.]Chrome)[.]"))`;
}

type ProcessRow = { pid: number; parent: number; group: number; identity: string };
function processTable(): ProcessRow[] {
  const text = execFileSync("/bin/ps", ["-axo", "pid=,ppid=,pgid=,stat=,lstart="], { encoding: "utf8", timeout: 2_000 });
  const rows: ProcessRow[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
    if (match?.[1] && match[2] && match[3] && match[4] && match[5] && !match[4].startsWith("Z")) rows.push({ pid: Number(match[1]), parent: Number(match[2]), group: Number(match[3]), identity: `${match[1]}:${match[5]}` });
  }
  return rows;
}
function groupIdentities(rows = processTable()): Map<number, Set<string>> {
  const groups = new Map<number, Set<string>>();
  for (const row of rows) { const identities = groups.get(row.group) ?? new Set<string>(); identities.add(row.identity); groups.set(row.group, identities); }
  return groups;
}
function processGroups(root: number, rootIdentity: Set<string> | undefined): Map<number, Set<string>> {
  const rows = processTable();
  if (!rows.some(row => row.pid === root && rootIdentity?.has(row.identity))) return new Map();
  const children = new Map<number, ProcessRow[]>();
  for (const row of rows) { const list = children.get(row.parent) ?? []; list.push(row); children.set(row.parent, list); }
  const owned: ProcessRow[] = [], queue = [root], seen = new Set<number>();
  for (let index = 0; index < queue.length; index++) {
    const parent = queue[index]; if (parent === undefined || seen.has(parent)) continue;
    seen.add(parent);
    for (const child of children.get(parent) ?? []) { owned.push(child); queue.push(child.pid); }
  }
  return groupIdentities(owned);
}

function signalGroup(group: number, signal: NodeJS.Signals): void {
  try { process.kill(-group, signal); }
  catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ESRCH" || error.code === "EPERM" && !groupIdentities().has(group))) return;
    throw error;
  }
}

/** Private MCP transport. The coordinator owns every detached browser group. */
export function createBrowserTransport(options: {
  scratch: string; proxyPort: number; runtime: ReturnType<typeof resolveBrowserInstallation>; onUnexpectedExit?: () => void;
}): Transport {
  let child: ChildProcessWithoutNullStreams | undefined;
  let closing: Promise<void> | undefined;
  let exited: Promise<void> = Promise.resolve();
  const waitForExit = () => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Browser process pipes did not drain; restart is required.")), 5_000);
    void exited.then(() => { clearTimeout(timer); resolve(); });
  });
  let buffer = "";
  let unexpectedExit = false;
  let rootIdentity: Set<string> | undefined;
  const capturedGroups = new Map<number, Set<string>>();
  const capture = (groups: Set<number>) => { const current = groupIdentities(); for (const group of groups) { const identities = current.get(group); if (identities) capturedGroups.set(group, identities); } };
  const signalOwned = (groups: Set<number>, signal: NodeJS.Signals) => {
    const current = groupIdentities();
    for (const group of groups) {
      const identities = current.get(group), captured = capturedGroups.get(group);
      if (captured && identities && [...captured].some(identity => identities.has(identity))) signalGroup(group, signal);
      else { groups.delete(group); capturedGroups.delete(group); }
    }
  };
  let monitor: ReturnType<typeof setInterval> | undefined;
  const transport: Transport = {
    async start() {
      if (child || closing) throw new Error("Browser transport cannot restart.");
      child = spawn("/usr/bin/sandbox-exec", ["-p", browserSandboxProfile(options.scratch, options.runtime.root, options.proxyPort),
        process.execPath, options.runtime.entry, "--config", join(options.scratch, "config.json"), "--executable-path", options.runtime.executable, "--headless", "--no-sandbox", "--isolated",
        "--output-dir", options.scratch, "--block-service-workers", "--no-webmcp", "--image-responses", "allow"], {
        cwd: options.scratch, detached: true, stdio: ["pipe", "pipe", "pipe"],
        env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: options.scratch, TMPDIR: `${options.scratch}/`,
          MAC_CHROMIUM_TMPDIR: options.scratch, PWTEST_SOCKETS_DIR: options.scratch, LANG: "en_US.UTF-8" }
      });
      const process_ = child;
      process_.once("exit", () => { if (monitor) clearInterval(monitor); if (!closing) { unexpectedExit = true; options.onUnexpectedExit?.(); } });
      exited = new Promise(resolve => process_.once("close", () => { transport.onclose?.(); resolve(); }));
      if (process_.pid) {
        try { capture(new Set([process_.pid])); rootIdentity = capturedGroups.get(process_.pid); if (!rootIdentity) throw new Error("Missing browser root identity."); }
        catch { process_.kill("SIGKILL"); await waitForExit(); throw new Error("Browser ownership could not be established."); }
      }
      monitor = setInterval(() => {
        if (process_.pid && !closing) { try {
          for (const [group, identities] of processGroups(process_.pid, rootIdentity)) capturedGroups.set(group, identities);
        } catch { options.onUnexpectedExit?.(); } }
      }, 250); monitor.unref();
      process_.stderr.resume();
      process_.on("error", () => { transport.onerror?.(new Error("Browser worker could not start.")); options.onUnexpectedExit?.(); });
      process_.stdin.on("error", () => undefined);
      process_.stdout.setEncoding("utf8");
      process_.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        if (Buffer.byteLength(buffer) > 8 * 1024 * 1024) { transport.onerror?.(new Error("Browser response exceeded the limit.")); options.onUnexpectedExit?.(); void transport.close().catch(() => undefined); return; }
        let end: number;
        while ((end = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          try { transport.onmessage?.(JSONRPCMessageSchema.parse(JSON.parse(line))); }
          catch { transport.onerror?.(new Error("Invalid browser protocol response.")); options.onUnexpectedExit?.(); void transport.close().catch(() => undefined); return; }
        }
      });
    },
    send(message) {
      if (!child || closing) return Promise.reject(new Error("Browser transport is closed."));
      return new Promise<void>((resolve, reject) => child?.stdin.write(serializeMessage(message), error => error ? reject(new Error("Browser transport write failed.")) : resolve()));
    },
    close() {
      return closing ??= (async () => {
        if (!child?.pid) return;
        if (monitor) clearInterval(monitor);
        const root = child.pid;
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGSTOP");
        const groups = new Set(capturedGroups.keys());
        try {
          signalOwned(groups, "SIGSTOP");
          for (let pass = 0; pass < 20; pass++) {
            const before = groups.size;
            const descendants = processGroups(root, rootIdentity);
            for (const [group, identities] of descendants) { capturedGroups.set(group, identities); groups.add(group); }
            signalOwned(groups, "SIGSTOP");
            if (groups.size === before) break;
          }
        } finally {
          child.kill("SIGKILL");
          const failures: unknown[] = [];
          for (const group of groups) { try { signalOwned(new Set([group]), "SIGKILL"); } catch (error) { failures.push(error); } }
          if (failures.length) throw new AggregateError(failures, "Could not terminate browser process groups.");
        }
        await waitForExit();
        for (let attempt = 0; attempt < 20; attempt++) {
          const remaining = execFileSync("/bin/ps", ["-axo", "pgid=,stat="], { encoding: "utf8", timeout: 2_000 }).trim().split("\n")
            .some(line => { const [group, state] = line.trim().split(/\s+/); return groups.has(Number(group)) && !state?.startsWith("Z"); });
          if (!remaining) {
            if (unexpectedExit) throw new Error("Browser worker exited unexpectedly. Proxy access was revoked; detached-child cleanup cannot be proved. Restart Pi before browser access.");
            return;
          }
          signalOwned(groups, "SIGKILL");
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error("Browser descendants did not stop; restart is required.");
      })();
    }
  };
  return transport;
}
