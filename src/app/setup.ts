import type { AuthCliOptions, SetupCliOptions } from "./cli.js";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createSecureModelCatalog, isRoleModel, SMART_MODEL, EXECUTION_MODEL, defaultLocalThinking } from "../security/models.js";
import { enterCredential } from "../security/credentials.js";
import { ToolIsolation } from "../security/isolation.js";
import { assertSafeProviderEnvironment } from "../security/provider-broker.js";
import { verifyCredentialIsolation } from "../security/verify-isolation.js";
import { loadCoordinatorConfig, writeCoordinatorConfig } from "./coordinator-config.js";

interface WizardDependencies {
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
  verify?: typeof verifyCredentialIsolation;
  enter?: typeof enterCredential;
  loadConfig?: typeof loadCoordinatorConfig;
  writeConfig?: typeof writeCoordinatorConfig;
}
export function renderNextSteps(): string {
  return "Next: run doctor, then smoke:api from the trusted installation. Step 0 stays incomplete until the live Pi request returns LOCAL_API_OK.";
}
export async function runSetupWizard(options: SetupCliOptions, dependencies: WizardDependencies = {}): Promise<number> {
  return runWizard(options, dependencies);
}
export async function runAuthWizard(options: AuthCliOptions, dependencies: WizardDependencies = {}): Promise<number> {
  return runWizard(options, dependencies);
}
async function runWizard(options: SetupCliOptions | AuthCliOptions, dependencies: WizardDependencies): Promise<number> {
  const output = dependencies.stdout ?? process.stdout;
  const errors = dependencies.stderr ?? process.stderr;
  try {
    assertSafeProviderEnvironment();
    const isolation = new ToolIsolation(options.cwd, "B");
    try { isolation.verify(); } finally { isolation.dispose(); }
    const legacy = await hasLegacyOpenAiAuth(options.agentDir ?? getAgentDir());
    if (legacy) {
      errors.write("Legacy openai auth.json entry detected and ignored. Revoke its plaintext key, remove only the openai entry privately, preserve other providers, then rerun setup. See docs/secure-setup.md.\n");
      return 1;
    }
    output.write("Checking the credential boundary with temporary dummy secrets before private entry...\n");
    const report = await (dependencies.verify ?? verifyCredentialIsolation)();
    output.write(`Isolation passed: ${report.assertions} assertions.\nOpenAI API-key authentication only. Close screen sharing and recording. The next window is a local secure macOS dialog. Never paste a key into chat or a terminal command.\n`);
    await (dependencies.enter ?? enterCredential)(options.cwd);
    const loaded = await (dependencies.loadConfig ?? loadCoordinatorConfig)();
    await (dependencies.writeConfig ?? writeCoordinatorConfig)({
      version: 1,
      defaults: { ...loaded.config?.defaults, thinkingA: loaded.config?.defaults.thinkingA ?? "high",
        modelA: configuredOpenAiModel(loaded.config?.defaults.modelA, SMART_MODEL),
        modelB: configuredLocalModel(loaded.config?.defaults.modelB), thinkingB: loaded.config?.defaults.thinkingB ?? defaultLocalThinking(configuredLocalModel(loaded.config?.defaults.modelB)) },
      onboarding: { lastSelectedAgentAAuthFlow: "openai-api-key", lastCompletedAt: new Date().toISOString() }
    });
    output.write(`Stored in macOS Keychain. No literal key was saved in Pi configuration.\n${renderNextSteps()}\n`);
    return 0;
  } catch (error) {
    errors.write(`${error instanceof Error ? error.message : "Secure setup unavailable."}\n`);
    return 1;
  }
}
export async function hasLegacyOpenAiAuth(agentDir: string): Promise<boolean> {
  try {
    const data: unknown = JSON.parse(await readFile(join(agentDir, "auth.json"), "utf8"));
    return Boolean(data && typeof data === "object" && "openai" in data);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw new Error("Legacy Pi auth file is unreadable or invalid. Repair it privately; secure setup never evaluates its entries.");
  }
}

function configuredOpenAiModel(reference: string | undefined, fallback: string): string {
  const model = reference?.startsWith("openai/")
    ? createSecureModelCatalog().find("openai", reference.slice("openai/".length)) : undefined;
  return model?.api === "openai-responses" ? `openai/${model.id}` : fallback;
}

function configuredLocalModel(reference: string | undefined): string {
  const model = createSecureModelCatalog().getAll().find((candidate) => `${candidate.provider}/${candidate.id}` === reference && isRoleModel("B", candidate));
  return model ? `${model.provider}/${model.id}` : EXECUTION_MODEL;
}
