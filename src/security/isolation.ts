import { spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Role } from "../types/role.js";

let root = dirname(fileURLToPath(import.meta.url));
while (!existsSync(join(root, "package.json"))) {
  const parent = dirname(root);
  if (parent === root) throw new Error("Trusted installation is unavailable.");
  root = parent;
}
export const installationRoot = realpathSync(root);
const nodeDirectory = dirname(realpathSync(process.execPath));
const nodePrefix = dirname(nodeDirectory) === "/" ? nodeDirectory : dirname(nodeDirectory);
const sandboxExecutable = "/usr/bin/sandbox-exec";

function within(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !path.startsWith(sep));
}

export function assertWorkspaceBoundary(cwd: string): string {
  const workspace = realpathSync(cwd);
  const protectedRoots = [installationRoot, nodePrefix, "/usr", "/System", "/opt/homebrew", "/bin", "/sbin", join(homedir(), "Library"), join(homedir(), ".pi")];
  if (protectedRoots.some((path) => within(workspace, path) || within(path, workspace))) {
    throw new Error("Isolation requires a dedicated workspace outside the trusted installation, ~/.pi, and ~/Library. Run secure:install to prepare a separate trusted installation.");
  }
  if (workspace === "/" || workspace === homedir()) {
    throw new Error("Isolation requires a dedicated project directory.");
  }
  return workspace;
}

export function assertStateOutsideWorkspace(cwd: string, state: string): void {
  const workspace = realpathSync(cwd);
  let existing = resolve(state);
  const suffix: string[] = [];
  while (!existsSync(existing)) { suffix.unshift(existing.slice(dirname(existing).length + 1)); existing = dirname(existing); }
  const canonical = resolve(realpathSync(existing), ...suffix);
  if (within(workspace, canonical) || within(canonical, workspace)) throw new Error("Coordinator state must be outside the agent workspace.");
}

export class ToolIsolation {
  public readonly cwd: string;
  public readonly scratch: string;
  public readonly env: Record<string, string>;
  public readonly profile: string;

  public constructor(cwd: string, role: Role, skillsDir?: string) {
    if (process.platform !== "darwin") throw new Error("Secure tool isolation requires macOS Seatbelt. No unrestricted fallback is available.");
    this.cwd = assertWorkspaceBoundary(cwd);
    this.scratch = realpathSync(mkdtempSync(join(tmpdir(), "pi-dual-tools-")));
    mkdirSync(join(this.scratch, "home"));
    mkdirSync(join(this.scratch, "tmp"));
    this.env = {
      PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
      HOME: join(this.scratch, "home"),
      TMPDIR: `${join(this.scratch, "tmp")}/`,
      SHELL: "/bin/bash",
      LANG: "en_US.UTF-8",
      TERM: "dumb"
    };
    if (skillsDir && existsSync(skillsDir) && lstatSync(skillsDir).isSymbolicLink()) {
      this.dispose();
      throw new Error("The global skills directory must be a real directory, not a symlink.");
    }
    const skillsRoot = skillsDir && existsSync(skillsDir) ? realpathSync(skillsDir) : undefined;
    const roots = ["/usr", "/System", "/bin", "/sbin", "/opt/homebrew", nodePrefix, installationRoot, this.cwd, this.scratch, ...(skillsRoot ? [skillsRoot] : [])];
    const filters = roots.map((path) => `(subpath ${JSON.stringify(path)})`).join(" ");
    this.profile = `(version 1)
(deny default)
(import "system.sb")
(allow process-exec process-fork)
(allow file-read* file-map-executable ${filters})
(allow file-read-metadata (path-ancestors ${JSON.stringify(this.cwd)}) (path-ancestors ${JSON.stringify(installationRoot)}) ${skillsRoot ? `(path-ancestors ${JSON.stringify(skillsRoot)})` : ""})
(allow file-write* (subpath ${JSON.stringify(this.scratch)}) ${role === "B" ? `(subpath ${JSON.stringify(this.cwd)})` : ""})
(allow sysctl-read)
(deny sysctl-read (sysctl-name-regex #"^kern.proc"))
(allow process-info* (target self))
(deny process-info* (target others))
(deny mach-lookup mach-register mach-priv* ipc-posix* network* system-socket)
(deny file-read* file-write* (subpath "/dev/ttys") (literal "/dev/tty"))
(deny file-write* (subpath "/cores"))
(allow signal (target self))`;
  }

  public command(command: string, args: string[] = []) {
    return { command: sandboxExecutable, args: ["-p", this.profile, command, ...args], cwd: this.cwd, env: this.env };
  }

  public verify(): void {
    const probeRoot = realpathSync(mkdtempSync(join(tmpdir(), "pi-dual-boundary-")));
    const probe = join(probeRoot, "protected");
    writeFileSync(probe, "startup-boundary-probe");
    try {
      const check = spawnSync(sandboxExecutable, ["-p", this.profile, process.execPath, "-e",
        'const fs=require("node:fs");try{fs.readFileSync(process.argv[1]);process.exit(12)}catch(e){if(!["EPERM","EACCES"].includes(e.code))process.exit(13)};process.stdout.write("ISOLATED")', probe],
        { cwd: this.cwd, env: this.env, encoding: "utf8", timeout: 10_000 });
      if (check.status !== 0 || check.stdout !== "ISOLATED") {
        throw new Error("OS isolation startup verification failed. Tool execution is disabled.");
      }
    } finally { rmSync(probeRoot, { recursive: true, force: true }); }
  }

  public dispose(): void { rmSync(this.scratch, { recursive: true, force: true }); }
}

export async function runIsolatedTool(options: {
  isolation: ToolIsolation;
  role: Role;
  name: string;
  args: unknown;
  skillsDir?: string | undefined;
  signal?: AbortSignal | undefined;
  onUpdate?: ((result: unknown) => void) | undefined;
}): Promise<unknown> {
  const worker = join(installationRoot, "dist", "src", "tools", "isolated-worker.js");
  const launch = options.isolation.command(process.execPath, [worker, options.role]);
  return new Promise((resolveResult, reject) => {
    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd, env: launch.env, stdio: ["pipe", "pipe", "pipe"], detached: true
    });
    let output = "";
    let bytes = 0;
    let result: unknown;
    let received = false;
    const kill = () => { try { if (child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { child.kill("SIGKILL"); } };
    const deadline = setTimeout(kill, 120_000);
    const abort = () => kill();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) kill();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 8 * 1024 * 1024) { kill(); return; }
      output += chunk;
      let end: number;
      while ((end = output.indexOf("\n")) !== -1) {
        const line = output.slice(0, end); output = output.slice(end + 1);
        try {
          const message: unknown = JSON.parse(line);
          if (typeof message === "object" && message !== null && "result" in message) {
            result = message.result; received = true;
          }
          if (typeof message === "object" && message !== null && "update" in message) options.onUpdate?.(message.update);
        } catch { kill(); }
      }
    });
    // Never forward worker stderr into trusted diagnostics.
    child.stderr.resume();
    child.on("error", () => reject(new Error("Isolated tool could not start.")));
    child.on("close", (code) => {
      clearTimeout(deadline);
      options.signal?.removeEventListener("abort", abort);
      kill();
      if (code === 0 && received) resolveResult(result);
      else reject(new Error(options.signal?.aborted ? "Tool cancelled." : "Isolated tool failed or access was denied."));
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(JSON.stringify({ name: options.name, args: options.args, skillsDir: options.skillsDir }));
  });
}
