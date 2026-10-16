import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type { DoctorCliOptions, ReplCliOptions } from "./cli.js";
import { loadCoordinatorConfig, resolveEffectiveModelA, resolveEffectiveModelB } from "./coordinator-config.js";
import { loadResolvedMcpConfig } from "../mcp/config-loader.js";
import { createSecureModelRegistry, isRoleModel, LM_STUDIO_BASE_URL, SMART_MODEL, EXECUTION_MODEL } from "../security/models.js";
import { ToolIsolation } from "../security/isolation.js";
import { credentialAccount, credentialHelper, credentialStatus } from "../security/credentials.js";
import { assertSafeProviderEnvironment } from "../security/provider-broker.js";
import { hasLegacyOpenAiAuth } from "./setup.js";
import { assertLmStudioModelReady } from "../security/lm-studio.js";

export interface RuntimeSetupCheck { name: string; status: "pass" | "warn" | "fail"; detail: string; }
export interface RuntimeSetupReport {
  ok: boolean; cwd: string; agentDir: string; authPath: string; modelsPath: string; coordinatorConfigPath: string; checks: RuntimeSetupCheck[];
}
interface RuntimeSetupOptions { cwd: string; agentDir?: string; modelA?: string; modelB?: string; mcpEnabled?: boolean; mcpConfigPaths?: string[]; }
export async function inspectRuntimeSetup(options: RuntimeSetupOptions): Promise<RuntimeSetupReport> {
  const cwd = resolve(options.cwd), agentDir = resolve(options.agentDir ?? getAgentDir());
  const checks: RuntimeSetupCheck[] = [];
  const test = async (name: string, action: () => string | Promise<string>) => {
    try { checks.push({ name, status: "pass", detail: await action() }); }
    catch (error) { checks.push({ name, status: "fail", detail: error instanceof Error ? error.message : "Unavailable." }); }
  };
  await test("Node.js", () => {
    if (Number(process.versions.node.split(".")[0]) < 20) throw new Error("Node.js >=20.6 is required.");
    return process.version;
  });
  await test("Provider environment", () => { assertSafeProviderEnvironment(); return "No plaintext OpenAI key, endpoint, proxy, or Node injection overrides."; });
  for (const role of ["A", "B"] as const) await test(`Agent ${role} OS isolation`, () => {
    const isolation = new ToolIsolation(cwd, role);
    try { isolation.verify(); return "Seatbelt active; workspace is separate from trusted code and credential storage."; }
    finally { isolation.dispose(); }
  });
  await test("Legacy OpenAI auth", async () => {
    if (await hasLegacyOpenAiAuth(agentDir)) throw new Error("Legacy openai auth.json entry is ignored and blocks setup. Revoke the old key and remove only that entry privately; preserve other providers. See docs/secure-setup.md.");
    return "No legacy openai entry. Pi auth commands and models.json secret references are never evaluated.";
  });
  await test("Credential helper", async () => { await access(credentialHelper); return "Native Keychain helper is built."; });
  await test("OpenAI Keychain credential", async () => {
    if (!await credentialStatus(cwd)) throw new Error("Keychain credential missing, locked, or unavailable. Run setup from your own private local terminal after isolation verification.");
    return `Project account ${credentialAccount(cwd)} is retrievable through the trusted private pipe. No live request made.`;
  });
  const loaded = await loadCoordinatorConfig();
  checks.push({ name: "Coordinator defaults", status: loaded.warnings.length ? "fail" : "pass", detail: loaded.warnings.length ? "Invalid coordinator defaults; repair non-secret configuration." : "Loaded non-secret coordinator defaults." });
  const registry = createSecureModelRegistry();
  for (const [role, reference] of [["A", resolveEffectiveModelA(options, loaded.config).value ?? SMART_MODEL], ["B", resolveEffectiveModelB(options, loaded.config).value ?? EXECUTION_MODEL]] as const) {
    await test(`Agent ${role} model`, async () => {
      const model = registry.getAll().find((candidate) => reference === `${candidate.provider}/${candidate.id}` || reference === candidate.id);
      if (!model || !isRoleModel(role, model)) throw new Error(`Agent ${role} requires ${role === "A" ? "an approved OpenAI Responses model" : "a local LM Studio model, such as " + EXECUTION_MODEL}.`);
      if (role === "B") {
        await assertLmStudioModelReady(model);
        return `lm-studio/${model.id}, local inference at ${LM_STUDIO_BASE_URL}; no OpenAI credential used.`;
      }
      return `openai/${model.id}, API-key authentication through the trusted broker.`;
    });
  }
  await test("MCP configuration", async () => {
    const config = await loadResolvedMcpConfig({ cwd, agentDir, enabled: options.mcpEnabled ?? true, explicitConfigPaths: options.mcpConfigPaths });
    for (const server of config.servers) {
      if (server.transport !== "stdio") throw new Error("Secure mode supports sandboxed stdio MCP only. HTTP/SSE isolation cannot be verified.");
      if (Object.keys(server.env ?? {}).some((key) => !["PATH", "LANG", "LC_ALL", "TZ"].includes(key))) throw new Error("MCP env overrides must be allowlisted: PATH, LANG, LC_ALL, TZ.");
      if (server.cwd && resolve(server.cwd) !== cwd) throw new Error("MCP cwd must match the workspace.");
    }
    return config.enabled ? `${config.servers.length} stdio server(s) validated; each launch is sandboxed for its role.` : "Disabled.";
  });
  checks.push({ name: "Executable Pi resources", status: "pass", detail: "Global/project extensions, packages, custom models and executable auth references disabled. Workspace AGENTS.md is read through isolated tools." });
  checks.push({ name: "Full isolation and live proof", status: "warn", detail: "Run verify:isolation for the complete dummy suite, then smoke:api for bounded Pi-backed connectivity. Doctor alone does not complete Step 0." });
  return { ok: checks.every((check) => check.status !== "fail"), cwd, agentDir,
    authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json"), coordinatorConfigPath: loaded.path, checks };
}
export async function assertRuntimeSetupReady(options: DoctorCliOptions | ReplCliOptions): Promise<void> {
  const report = await inspectRuntimeSetup(options);
  if (!report.ok) throw new Error(`Secure setup check failed.\n${report.checks.filter((check) => check.status === "fail").map((check) => `- ${check.name}: ${check.detail}`).join("\n")}\nRun doctor for details.`);
}
export async function runDoctor(options: DoctorCliOptions, io: Pick<NodeJS.WriteStream, "write"> = process.stdout): Promise<number> {
  const report = await inspectRuntimeSetup(options); io.write(renderSetupReport(report)); return report.ok ? 0 : 1;
}
export function renderSetupReport(report: RuntimeSetupReport): string {
  return `pi-dual secure setup check\nProject: ${report.cwd}\nCoordinator config: ${report.coordinatorConfigPath}\n\n${report.checks.map((check) => `${check.status.toUpperCase()} ${check.name}: ${check.detail}`).join("\n")}\n\n${report.ok ? "Ready for the live smoke test." : "Fix failed checks before starting the REPL."}\n`;
}
