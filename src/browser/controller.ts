import { randomUUID } from "node:crypto";
import { constants, fstatSync, lstatSync, readdirSync, openSync, readSync, closeSync, realpathSync, mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import { z } from "zod";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { defineTool, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Role } from "../types/role.js";
import { cleanupAll } from "../runtime/cleanup.js";
import { redactText } from "../security/redact.js";
import { resolveBrowserInstallation, type BrowserConfiguration } from "./policy.js";
import { startLocalBrowserProxy } from "./proxy.js";
import { createBrowserTransport } from "./process.js";

const observations = ["navigate", "snapshot", "screenshot", "console", "close"] as const;
const interactions = ["click", "type", "press", "select"] as const;
const actionSchema = z.strictObject({
  action: z.enum([...observations, ...interactions]), url: z.string().max(4096).optional(),
  ref: z.string().regex(/^e\d+$/).optional(), snapshotId: z.uuid().optional(), text: z.string().max(20_000).optional(),
  key: z.string().max(100).optional(), values: z.array(z.string().max(1000)).max(100).optional()
});
type BrowserState = {
  scratch: string;
  proxy?: Awaited<ReturnType<typeof startLocalBrowserProxy>>;
  transport?: ReturnType<typeof createBrowserTransport>;
  client?: Client;
  calls: number;
};

function readArtifact(state: BrowserState, name: string, limit: number): Buffer {
  const path = join(state.scratch, name);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    unlinkSync(path);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw new Error("Invalid or oversized browser evidence.");
    const data = Buffer.alloc(limit + 1);
    const bytes = readSync(fd, data, 0, data.length, 0);
    if (bytes > limit) throw new Error("Browser evidence exceeded its limit.");
    return data.subarray(0, bytes);
  } finally { closeSync(fd); }
}

function checkScratchSize(root: string): void {
  let bytes = 0, files = 0;
  const directories = [root];
  for (const directory of directories) for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    let stat;
    try { stat = lstatSync(path); } catch { continue; }
    if (++files > 10_000 || (bytes += stat.size) > 128 * 1024 * 1024) throw new Error("Browser scratch limit reached. Close this browser before continuing.");
    if (stat.isDirectory()) directories.push(path);
  }
}

/** One role and one Pi session. Private MCP is never exposed through generic tools. */
export class ProjectBrowser {
  private state: BrowserState | undefined;
  private starting: Promise<BrowserState> | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private releasing: Promise<void> = Promise.resolve();
  private disposed = false;
  private snapshotId: string | undefined;
  public constructor(private readonly role: Role, private readonly config: BrowserConfiguration) {}

  public readonly extensionFactory: ExtensionFactory = pi => {
    const actions = this.role === "A" ? [...observations] : [...observations, ...interactions];
    pi.on("session_shutdown", event => event.reason === "reload" ? this.reset() : this.dispose());
    pi.registerTool(defineTool({
      name: "browser", label: "Project browser",
      description: `Use your separate Playwright browser for this project's approved local HTTP(S) origins: ${this.config.allowedOrigins.join(", ")}. Call navigate with url, then use snapshot/console for text verification. Screenshots are captured in the session archive, but their pixels are not sent to the model while image token accounting is unavailable. Do not claim visual verification from a screenshot. ${this.role === "B" ? "For click/type/select use ref and snapshotId from the latest snapshot; press also requires snapshotId. Type requires text; select requires values; press requires key." : "You may navigate and inspect. UI input actions belong to Agent B."} The project must already be running. Public web, file URLs, uploads and downloads are unavailable.`,
      parameters: Type.Object({
        action: Type.Union(actions.map(value => Type.Literal(value))), url: Type.Optional(Type.String()), ref: Type.Optional(Type.String()),
        snapshotId: Type.Optional(Type.String()), text: Type.Optional(Type.String()), key: Type.Optional(Type.String()), values: Type.Optional(Type.Array(Type.String()))
      }, { additionalProperties: false }),
      execute: async (_id, input, signal) => this.call(input, signal)
    }));
  };

  private async connect(): Promise<BrowserState> {
    await this.releasing;
    if (this.state?.client) return this.state;
    if (this.starting) return this.starting;
    const state: BrowserState = { scratch: realpathSync(mkdtempSync("/tmp/pi-browser-")), calls: 0 };
    this.state = state;
    this.starting = (async () => {
      try {
        const runtime = resolveBrowserInstallation(this.config.workspace);
        state.proxy = await startLocalBrowserProxy(this.config);
        if (this.disposed || this.state !== state) throw new Error("Browser session was reset.");
        writeFileSync(join(state.scratch, "config.json"), JSON.stringify({
          browser: { launchOptions: { chromiumSandbox: false, proxy: { server: state.proxy.server, username: state.proxy.username, password: state.proxy.password, bypass: "<-loopback>" },
            args: ["--force-dark-mode", "--disable-gpu", "--disable-quic", "--disable-background-networking"] }, contextOptions: { ignoreHTTPSErrors: true, colorScheme: "dark", serviceWorkers: "block", acceptDownloads: false, viewport: { width: 1280, height: 720 } } },
          codegen: "none", network: { allowedOrigins: this.config.allowedOrigins }
        }), { mode: 0o600 });
        state.transport = createBrowserTransport({ scratch: state.scratch, proxyPort: state.proxy.port, runtime, onUnexpectedExit: () => { if (this.state === state) void this.reset().catch(() => undefined); } });
        state.client = new Client({ name: "pi-local-project-browser", version: "1" });
        await state.client.connect(state.transport, { timeout: 15_000 });
        return state;
      } catch {
        throw new Error("Local browser could not start inside its isolation policy.");
      }
    })();
    try { return await this.starting; } finally { this.starting = undefined; }
  }

  public async call(input: unknown, signal?: AbortSignal): Promise<AgentToolResult<Record<string, unknown>>> {
    const action = actionSchema.parse(input);
    if (this.role === "A" && interactions.some(value => value === action.action)) throw new Error("Agent A may navigate and inspect; UI input belongs to Agent B.");
    if (action.action === "navigate") {
      const url = new URL(action.url ?? "");
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !this.config.allowedOrigins.includes(url.origin)) throw new Error("URL is outside this project's local HTTP(S) origins.");
    }
    const operation = this.tail.then(async (): Promise<AgentToolResult<Record<string, unknown>>> => {
      if (this.disposed) throw new Error("Browser session is disposed.");
      signal?.throwIfAborted();
      if (action.action === "close") {
        try { await this.reset(); } catch { throw new Error("Browser cleanup failed. Restart Pi before browser access."); }
        return { content: [{ type: "text", text: "Project browser closed." }], details: {} };
      }
      if (interactions.some(value => value === action.action) && (!this.snapshotId || action.snapshotId !== this.snapshotId)) throw new Error("Use ref and snapshotId from a fresh browser snapshot in this session.");
      const abort = () => { void this.reset().catch(() => undefined); };
      signal?.addEventListener("abort", abort, { once: true });
      let interactionStarted = false;
      try {
        const state = await this.connect();
        signal?.throwIfAborted();
        const invoke = async (name: string, arguments_: Record<string, unknown>) => {
          if (++state.calls > 128) throw new Error("Browser session evidence limit reached. Open a new session before continuing.");
          if (["browser_navigate", "browser_click", "browser_type", "browser_press_key", "browser_select_option"].includes(name)) interactionStarted = true;
          const result = CallToolResultSchema.parse(await state.client?.callTool({ name, arguments: arguments_ }, CallToolResultSchema, { ...(signal ? { signal } : {}), timeout: 45_000 }));
          checkScratchSize(state.scratch);
          if (!result || result.isError) throw new Error("Browser action failed. Check the local project server and obtain a fresh snapshot.");
          return result;
        };
        switch (action.action) {
          case "navigate": await invoke("browser_navigate", { url: action.url }); break;
          case "click": if (!action.ref) throw new Error("click requires ref."); await invoke("browser_click", { target: action.ref, element: action.ref }); break;
          case "type": if (!action.ref || action.text === undefined) throw new Error("type requires ref and text."); await invoke("browser_type", { target: action.ref, element: action.ref, text: action.text, submit: false }); break;
          case "press": if (!action.key) throw new Error("press requires key."); await invoke("browser_press_key", { key: action.key }); break;
          case "select": if (!action.ref || !action.values) throw new Error("select requires ref and values."); await invoke("browser_select_option", { target: action.ref, element: action.ref, values: action.values }); break;
          case "screenshot": {
            const name = `evidence-${randomUUID()}.jpeg`;
            await invoke("browser_take_screenshot", { filename: name, type: "jpeg", fullPage: false });
            const data = readArtifact(state, name, 2 * 1024 * 1024);
            return { content: [{ type: "image", data: data.toString("base64"), mimeType: "image/jpeg" }], details: { action: "screenshot" } };
          }
          case "console": {
            const result = await invoke("browser_console_messages", { level: "warning" });
            const text = result.content.filter(item => item.type === "text").map(item => item.type === "text" ? item.text : "").join("\n");
            return { content: [{ type: "text", text: redactText(text).slice(0, 32_000) }], details: { action: "console" } };
          }
          case "snapshot": break;
        }
        const name = `snapshot-${randomUUID()}.yml`;
        await invoke("browser_snapshot", { filename: name });
        const snapshot = redactText(readArtifact(state, name, 64 * 1024).toString("utf8"));
        this.snapshotId = randomUUID();
        return { content: [{ type: "text", text: JSON.stringify({ snapshotId: this.snapshotId, snapshot }) }], details: { action: action.action } };
      } catch (error) {
        let cleanupFailed = false;
        try { await this.reset(); } catch { cleanupFailed = true; }
        const cleanup = cleanupFailed ? " Browser cleanup failed; browser access is blocked until Pi restarts." : "";
        throw new Error((interactionStarted ? "Browser interaction outcome is uncertain and may have changed the local application. Inspect fresh application state before deciding whether to repeat it. The browser session was closed." : signal?.aborted ? "Browser action cancelled; its browser session was closed." : error instanceof Error ? redactText(error.message) : "Browser action failed.") + cleanup);
      } finally { signal?.removeEventListener("abort", abort); }
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }

  private async release(state: BrowserState): Promise<void> {
    await cleanupAll([async () => state.proxy?.close(), async () => state.transport?.close(), async () => state.client?.close()]);
    rmSync(state.scratch, { recursive: true, force: true });
  }
  public reset(): Promise<void> {
    const state = this.state; this.state = undefined; this.snapshotId = undefined;
    if (state) {
      const starting = this.starting;
      this.releasing = Promise.all([this.releasing, (async () => { await starting?.catch(() => undefined); await this.release(state); })()]).then(() => undefined);
    }
    return this.releasing;
  }
  public async dispose(): Promise<void> { this.disposed = true; try { await this.reset(); } finally { await this.tail; } }
}
