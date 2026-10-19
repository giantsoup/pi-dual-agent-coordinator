import { lstatSync, readFileSync, realpathSync, existsSync, readdirSync, readlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import { z } from "zod";
import { installationRoot, assertStateOutsideWorkspace } from "../security/isolation.js";

export const browserConfigPath = join(homedir(), ".pi/dual-agent-coordinator/browser.json");
export const browserRuntimeRoot = join(homedir(), ".local/share/pi-dual/browser-runtime");
export const browserExecutable = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export function validateLocalOrigin(value: string): string {
  const url = new URL(value);
  const host = url.hostname;
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || value !== url.origin
    || !["localhost", "127.0.0.1", "[::1]"].includes(host) && !host.endsWith(".test")
    || port !== 80 && port !== 443 && (port < 1024 || port >= 49152)
    || [1234, 5900, 9222, 9223].includes(port)) {
    throw new Error("Browser origins must be exact local HTTP(S) project origins. Inference, browser-control and ephemeral broker ports are forbidden.");
  }
  return url.origin;
}

const projectSchema = z.strictObject({
  workspace: z.string().min(1).refine(isAbsolute, "Expected an absolute canonical project path."),
  allowedOrigins: z.array(z.string().refine(value => { try { validateLocalOrigin(value); return true; } catch { return false; } }, "Expected an exact local HTTP(S) project origin.")).min(1).max(32)
});
export const browserConfigSchema = z.strictObject({
  version: z.literal(2), enabled: z.boolean(), projects: z.array(projectSchema).max(100)
});
export type BrowserConfiguration = z.output<typeof projectSchema>;

export function loadBrowserConfiguration(cwd: string, path = browserConfigPath): BrowserConfiguration | undefined {
  let stat;
  try { stat = lstatSync(path); }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined; throw error; }
  assertStateOutsideWorkspace(cwd, path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) {
    throw new Error("Browser policy must be an operator-owned private regular file outside the workspace.");
  }
  let input: unknown;
  try { input = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error("Invalid browser policy JSON."); }
  if (typeof input === "object" && input !== null && "version" in input && input.version === 1) {
    throw new Error("Browser policy version 1 has no project ownership. Configure project origins with npm run browser:allow.");
  }
  const parsed = browserConfigSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid browser policy. Configure exact local HTTP(S) project origins with npm run browser:allow.");
  if (!parsed.data.enabled) return undefined;
  const workspace = realpathSync(cwd);
  return parsed.data.projects.find(project => project.workspace === workspace);
}

export function resolveBrowserInstallation(cwd: string): { entry: string; root: string; executable: string } {
  const bundled = join(installationRoot, "browser-runtime");
  if (existsSync(join(installationRoot, "installation-manifest.json")) && !existsSync(bundled)) throw new Error("This trusted installation has no verified browser bundle. Prepare a new browser-capable installation.");
  const root = realpathSync(existsSync(bundled) ? bundled : browserRuntimeRoot);
  if (existsSync(bundled)) verifyBrowserBundle(root);
  assertStateOutsideWorkspace(cwd, root);
  const entry = realpathSync(join(root, "node_modules/@playwright/mcp/cli.js"));
  const path = relative(root, entry);
  if (path.startsWith("..") || isAbsolute(path)) throw new Error("Browser runtime entry escaped its installation.");
  const metadata: unknown = JSON.parse(readFileSync(join(root, "node_modules/@playwright/mcp/package.json"), "utf8"));
  z.object({ name: z.literal("@playwright/mcp"), version: z.literal("0.0.83") }).parse(metadata);
  return { root, entry, executable: realpathSync(browserExecutable) };
}

function verifyBrowserBundle(root: string): void {
  const entry = z.union([z.strictObject({ sha256: z.string(), mode: z.number() }), z.strictObject({ link: z.string() })]);
  const manifest = z.object({ files: z.record(z.string(), entry) }).parse(JSON.parse(readFileSync(join(installationRoot, "installation-manifest.json"), "utf8")));
  const expected = new Set(Object.keys(manifest.files).filter(name => name.startsWith("browser-runtime/")));
  function visit(directory: string): void {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) { visit(path); continue; }
      const key = relative(installationRoot, path);
      const record = manifest.files[key];
      if (!record || !expected.delete(key)) throw new Error("Browser bundle differs from its trusted installation.");
      if ("link" in record) {
        const target = relative(root, realpathSync(path));
        if (readlinkSync(path) !== record.link || target.startsWith("..") || isAbsolute(target)) throw new Error("Browser bundle link escaped its installation.");
      } else if (lstatSync(path).isSymbolicLink() || (lstatSync(path).mode & 0o777) !== record.mode || createHash("sha256").update(readFileSync(path)).digest("hex") !== record.sha256) throw new Error("Browser bundle integrity check failed.");
    }
  }
  visit(root);
  if (expected.size) throw new Error("Browser bundle files are missing.");
}
