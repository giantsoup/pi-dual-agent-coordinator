import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import { z } from "zod";
import { defineTool, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { ToolIsolation } from "../security/isolation.js";
import { groupIdentities, processGroups, signalGroup } from "../security/process-groups.js";
import { redactText } from "../security/redact.js";
import { cleanupAll } from "../runtime/cleanup.js";

const inputSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("start"), command: z.string().trim().min(1).max(8_000) }),
  z.strictObject({ action: z.literal("status"), serverId: z.uuid() }),
  z.strictObject({ action: z.literal("stop"), serverId: z.uuid() })
]);
type Server = {
  child: ChildProcessWithoutNullStreams; output: string; groups: Map<number, Set<string>>; rootIdentity: Set<string>;
  monitor: ReturnType<typeof setInterval>; closed: Promise<void>; stopping?: Promise<void>;
};

/** Session-owned foreground commands; models can stop only servers registered here. */
export class LocalServers {
  private readonly servers = new Map<string, Server>();
  private disposed = false;
  private failed = false;
  private tail: Promise<unknown> = Promise.resolve();
  public constructor(private readonly isolation: ToolIsolation) {}

  public readonly extensionFactory: ExtensionFactory = pi => {
    pi.on("session_shutdown", event => event.reason === "reload" ? this.reset() : this.dispose());
    pi.registerTool(defineTool({
      name: "local_server", label: "Local project server",
      description: "Start, inspect, or stop a sandboxed local project server. Start takes a foreground shell command, for example python3 -m http.server 4173 --bind 127.0.0.1. Do not background or daemonize it. Bind explicitly to 127.0.0.1 or ::1. Status returns bounded recent logs; a returned serverId is required for status/stop. Start does not prove HTTP readiness: request the endpoint using bash, then use browser at an operator-approved origin. Public networking, UDP, inference/control and provider-broker ports remain blocked. Stop your servers when verification finishes; cancellation and session teardown also stop managed servers.",
      parameters: Type.Object({
        action: Type.Union([Type.Literal("start"), Type.Literal("status"), Type.Literal("stop")]),
        command: Type.Optional(Type.String()), serverId: Type.Optional(Type.String())
      }, { additionalProperties: false }),
      execute: async (_id, input, signal) => {
        const action = inputSchema.parse(input);
        const operation = this.tail.then(async () => {
          signal?.throwIfAborted();
          if (this.disposed || this.failed) throw new Error("Local server cleanup failed or session closed. Restart Pi before starting servers.");
          let serverId: string;
          if (action.action === "start") {
            if (this.servers.size >= 4) throw new Error("Stop an existing local server before starting another. Limit: four per session.");
            serverId = await this.start(action.command);
          } else {
            serverId = action.serverId;
            const server = this.servers.get(serverId);
            if (!server) throw new Error("Unknown local server in this session.");
            if (action.action === "stop") { await this.stop(server); this.servers.delete(serverId); }
          }
          signal?.throwIfAborted();
          const server = this.servers.get(serverId);
          return { content: [{ type: "text" as const, text: JSON.stringify({ serverId,
            state: !server ? "stopped" : server.child.exitCode !== null || server.child.signalCode !== null ? "exited" : "running",
            output: redactText(server?.output ?? "") }) }], details: {} };
        });
        this.tail = operation.catch(() => undefined);
        try { return await operation; }
        catch (error) { if (signal?.aborted) await this.reset(); throw error; }
      }
    }));
  };

  private async start(command: string): Promise<string> {
    const launch = this.isolation.command("/bin/bash", ["-c", command]);
    const child = spawn(launch.command, launch.args, { cwd: launch.cwd, env: launch.env, detached: true, stdio: "pipe" });
    child.stdin.end();
    const closed = new Promise<void>(resolve => child.once("close", () => resolve()));
    let output = "";
    const append = (chunk: string) => { output = (output + chunk).slice(-32_768); };
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", append); child.stderr.on("data", append);
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    const pid = child.pid;
    let identities: Set<string>;
    try {
      const captured = pid ? groupIdentities().get(pid) : undefined;
      if (!pid || !captured) throw new Error("Missing local server identity");
      identities = captured;
    } catch {
      this.failed = true;
      child.kill("SIGKILL");
      await this.waitForClose(closed);
      throw new Error("Local server exited before process ownership could be established. Restart Pi before starting servers.");
    }
    const groups = new Map([[pid, identities]]);
    const monitor = setInterval(() => {
      try { for (const [group, members] of processGroups(pid, identities)) groups.set(group, members); }
      catch { this.failed = true; }
    }, 250);
    monitor.unref();
    child.once("exit", () => clearInterval(monitor));
    const server: Server = { child, get output() { return output; }, groups, rootIdentity: identities, monitor, closed };
    const id = randomUUID(); this.servers.set(id, server);
    return id;
  }

  private stop(server: Server): Promise<void> {
    return server.stopping ??= (async () => {
      clearInterval(server.monitor);
      const signalOwned = (signal: NodeJS.Signals) => {
        const current = groupIdentities();
        for (const [group, captured] of server.groups) {
          const members = current.get(group);
          if (members && [...captured].some(identity => members.has(identity))) signalGroup(group, signal);
          else server.groups.delete(group);
        }
      };
      const pid = server.child.pid;
      try {
        signalOwned("SIGSTOP");
        for (let pass = 0; pid && pass < 20; pass++) {
          const before = server.groups.size;
          for (const [group, members] of processGroups(pid, server.rootIdentity)) server.groups.set(group, members);
          signalOwned("SIGSTOP");
          if (server.groups.size === before) break;
        }
      } finally {
        if (server.child.exitCode === null && server.child.signalCode === null) server.child.kill("SIGKILL");
        signalOwned("SIGKILL");
      }
      await this.waitForClose(server.closed);
      for (let attempt = 0; attempt < 20; attempt++) {
        signalOwned("SIGKILL");
        if (!server.groups.size) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error("Local server descendants did not stop. Restart Pi before starting servers.");
    })().catch((error: unknown) => { this.failed = true; throw error; });
  }

  private waitForClose(closed: Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Local server pipes did not drain.")), 5_000);
      void closed.then(() => { clearTimeout(timer); resolve(); });
    });
  }

  public reset(): Promise<void> {
    const resetting = this.tail.then(async () => {
      await cleanupAll(Array.from(this.servers.values(), server => () => this.stop(server)));
      this.servers.clear();
    });
    this.tail = resetting.catch(() => undefined);
    return resetting;
  }
  public async dispose(): Promise<void> { this.disposed = true; await this.reset(); }
}
