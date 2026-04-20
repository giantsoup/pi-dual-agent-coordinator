import { constants as fsConstants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { version as nodeVersion } from "node:process";

import { getEnvApiKey } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  getAgentDir,
  ModelRegistry
} from "@mariozechner/pi-coding-agent";

import type { DoctorCliOptions, PortalCliOptions, ReplCliOptions } from "./cli.js";
import {
  loadCoordinatorConfig,
  resolveEffectiveModelA,
  resolveEffectiveModelB
} from "./coordinator-config.js";
import { loadResolvedMcpConfig } from "../mcp/config-loader.js";

export interface RuntimeSetupCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface RuntimeSetupReport {
  ok: boolean;
  cwd: string;
  agentDir: string;
  authPath: string;
  modelsPath: string;
  coordinatorConfigPath: string;
  checks: RuntimeSetupCheck[];
}

interface RuntimeSetupOptions {
  cwd: string;
  agentDir?: string;
  modelA?: string;
  modelB?: string;
  mcpEnabled?: boolean;
  mcpConfigPaths?: string[];
}

export async function inspectRuntimeSetup(
  options: RuntimeSetupOptions
): Promise<RuntimeSetupReport> {
  const cwd = resolve(options.cwd);
  const agentDir = resolve(options.agentDir ?? getAgentDir());
  const authPath = join(agentDir, "auth.json");
  const modelsPath = join(agentDir, "models.json");
  const checks: RuntimeSetupCheck[] = [];

  checks.push(checkNodeVersion());
  checks.push(await checkDirectory("Project directory", cwd));
  checks.push(await checkDirectory("Pi agent directory", agentDir));

  const authFileCheck = await checkOptionalJsonFile("Pi auth file", authPath, {
    missingDetail:
      "No auth.json exists yet. That is fine if your provider auth comes entirely from environment variables, otherwise run `pi-dual setup`."
  });
  checks.push(authFileCheck.check);

  const modelsFileCheck = await checkOptionalJsonFile("Pi models file", modelsPath, {
    missingDetail:
      "No models.json exists yet. Built-in providers still work, but add one if you want custom or local models such as Agent B on LM Studio or Ollama."
  });
  checks.push(modelsFileCheck.check);

  const coordinatorConfig = await loadCoordinatorConfig();
  checks.push(checkCoordinatorConfig(coordinatorConfig));

  const effectiveModelA = resolveEffectiveModelA(options, coordinatorConfig.config);
  const effectiveModelB = resolveEffectiveModelB(options, coordinatorConfig.config);

  const authStorage = AuthStorage.inMemory(asAuthStorageData(authFileCheck.parsed));
  const modelRegistry = ModelRegistry.create(authStorage, modelsPath);

  const authStorageErrors = authStorage.drainErrors();
  if (authStorageErrors.length > 0) {
    checks.push({
      name: "Pi auth storage",
      status: "fail",
      detail: authStorageErrors[0]?.message ?? "Unknown auth storage error."
    });
  }

  const modelRegistryError = modelRegistry.getError();
  if (modelRegistryError) {
    checks.push({
      name: "Pi model registry",
      status: "fail",
      detail: modelRegistryError
    });
  }

  checks.push(checkEffectiveAgentAModel(effectiveModelA.value, effectiveModelA.source, modelRegistry));
  if (effectiveModelA.value) {
    checks.push(checkEffectiveAgentAAuth(effectiveModelA.value, authStorage, modelRegistry));
  }

  checks.push(checkEffectiveAgentBModel(effectiveModelB.value, effectiveModelB.source, modelRegistry));

  try {
    const resolvedMcpConfig = await loadResolvedMcpConfig({
      cwd,
      agentDir,
      enabled: options.mcpEnabled ?? true,
      explicitConfigPaths: options.mcpConfigPaths
    });

    if (!resolvedMcpConfig.enabled) {
      checks.push({
        name: "MCP configuration",
        status: "pass",
        detail: "MCP is disabled for this run."
      });
    } else if (resolvedMcpConfig.configSources.length === 0) {
      checks.push({
        name: "MCP configuration",
        status: "pass",
        detail: "No MCP config files were found. The coordinator will run without extra MCP servers."
      });
    } else {
      checks.push({
        name: "MCP configuration",
        status: "pass",
        detail: `Validated ${resolvedMcpConfig.configSources.length} config file(s): ${resolvedMcpConfig.configSources.join(", ")}`
      });
    }
  } catch (error) {
    checks.push({
      name: "MCP configuration",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error)
    });
  }

  return {
    ok: checks.every((check) => check.status !== "fail"),
    cwd,
    agentDir,
    authPath,
    modelsPath,
    coordinatorConfigPath: coordinatorConfig.path,
    checks
  };
}

export async function assertRuntimeSetupReady(
  options: DoctorCliOptions | ReplCliOptions | PortalCliOptions
): Promise<void> {
  const report = await inspectRuntimeSetup(options);
  const failures = report.checks.filter((check) => check.status === "fail");
  if (failures.length === 0) {
    return;
  }

  const lines = [
    "Setup check failed.",
    ...failures.map((check) => `- ${check.name}: ${check.detail}`),
    "",
    `Run \`pi-dual doctor ${formatRecommendedDoctorArgs(options)}\` for a full checklist.`
  ];
  throw new Error(lines.join("\n"));
}

export async function runDoctor(
  options: DoctorCliOptions,
  io: Pick<NodeJS.WriteStream, "write"> = process.stdout
): Promise<number> {
  const report = await inspectRuntimeSetup(options);
  io.write(renderSetupReport(report));
  return report.ok ? 0 : 1;
}

export function renderSetupReport(report: RuntimeSetupReport): string {
  const lines = [
    "pi-dual setup check",
    "",
    `Project: ${report.cwd}`,
    `Pi agent dir: ${report.agentDir}`,
    `Auth file: ${report.authPath}`,
    `Models file: ${report.modelsPath}`,
    `Coordinator config: ${report.coordinatorConfigPath}`,
    ""
  ];

  for (const check of report.checks) {
    lines.push(`${formatStatus(check.status)} ${check.name}: ${check.detail}`);
  }

  lines.push("");
  lines.push(report.ok ? "Result: ready to run." : "Result: fix the failed checks before starting the REPL.");
  return `${lines.join("\n")}\n`;
}

function checkNodeVersion(): RuntimeSetupCheck {
  return isSupportedNodeVersion(nodeVersion)
    ? {
        name: "Node.js",
        status: "pass",
        detail: `${nodeVersion} meets the required >=20.6.0 version.`
      }
    : {
        name: "Node.js",
        status: "fail",
        detail: `${nodeVersion} is too old. Install Node.js 20.6.0 or newer.`
      };
}

async function checkDirectory(name: string, path: string): Promise<RuntimeSetupCheck> {
  try {
    const stats = await stat(path);
    if (!stats.isDirectory()) {
      return {
        name,
        status: "fail",
        detail: `${path} exists but is not a directory.`
      };
    }

    return {
      name,
      status: "pass",
      detail: `${path}`
    };
  } catch {
    return {
      name,
      status: "fail",
      detail: `${path} does not exist yet.`
    };
  }
}

async function checkOptionalJsonFile(
  name: string,
  path: string,
  options: { missingDetail: string }
): Promise<{ check: RuntimeSetupCheck; parsed?: unknown }> {
  try {
    await access(path, fsConstants.R_OK);
  } catch {
    return {
      check: {
        name,
        status: "warn",
        detail: options.missingDetail
      }
    };
  }

  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return {
      check: {
        name,
        status: "pass",
        detail: `${path} is present and valid JSON.`
      },
      parsed
    };
  } catch (error) {
    return {
      check: {
        name,
        status: "fail",
        detail: `${path} could not be parsed as JSON. ${error instanceof Error ? error.message : String(error)}`
      }
    };
  }
}

function checkCoordinatorConfig(result: Awaited<ReturnType<typeof loadCoordinatorConfig>>): RuntimeSetupCheck {
  if (!result.exists) {
    return {
      name: "Coordinator config",
      status: "warn",
      detail:
        "No saved coordinator defaults yet. Run `pi-dual setup` to choose a default Agent A auth path and model."
    };
  }

  if (result.warnings.length > 0) {
    return {
      name: "Coordinator config",
      status: "warn",
      detail: `Loaded with warnings from ${result.path}. ${result.warnings.join(" ")}`
    };
  }

  return {
    name: "Coordinator config",
    status: "pass",
    detail: `${result.path} is present and valid.`
  };
}

function checkEffectiveAgentAModel(
  modelReference: string | undefined,
  source: "cli" | "config" | "legacy",
  modelRegistry: ModelRegistry
): RuntimeSetupCheck {
  if (!modelReference) {
    return {
      name: "Agent A model",
      status: "warn",
      detail:
        "No `--model-a` override or saved coordinator default is set. The REPL will fall back to Pi's default model selection. Run `pi-dual setup` to choose a default OpenAI path."
    };
  }

  try {
    const model = resolveModelReference(modelReference, modelRegistry);
    return {
      name: "Agent A model",
      status: "pass",
      detail: `${modelReference} resolves to ${model.name ?? model.id} (${renderModelSourceLabel(source)}).`
    };
  } catch (error) {
    return {
      name: "Agent A model",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

function checkEffectiveAgentAAuth(
  modelReference: string,
  authStorage: AuthStorage,
  modelRegistry: ModelRegistry
): RuntimeSetupCheck {
  try {
    const model = resolveModelReference(modelReference, modelRegistry);
    const provider = model.provider;

    if (provider === "openai-codex") {
      if (authStorage.hasAuth("openai-codex")) {
        return {
          name: "Agent A auth",
          status: "pass",
          detail: `Found ChatGPT subscription auth for ${modelReference}.`
        };
      }

      return {
        name: "Agent A auth",
        status: "fail",
        detail:
          `The effective Agent A model ${modelReference} requires \`openai-codex\` ChatGPT subscription auth, but none is configured. Run \`pi-dual setup\` or \`pi-dual auth\`. A browser window will open for ChatGPT login.`
      };
    }

    if (provider === "openai") {
      const openAiCheck = checkOpenAiApiAuth(modelReference, authStorage);
      return {
        ...openAiCheck,
        name: "Agent A auth"
      };
    }

    return {
      name: "Agent A auth",
      status: "pass",
      detail: `No special coordinator auth check is required for provider \`${provider}\`.`
    };
  } catch (error) {
    return {
      name: "Agent A auth",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

function checkOpenAiApiAuth(
  modelReference: string,
  authStorage: AuthStorage
): Omit<RuntimeSetupCheck, "name"> {
  const credential = authStorage.get("openai");
  if (!credential) {
    if (getEnvApiKey("openai")) {
      return {
        status: "pass",
        detail: `The effective Agent A model ${modelReference} will use \`OPENAI_API_KEY\` from the current environment.`
      };
    }

    return {
      status: "fail",
      detail:
        `The effective Agent A model ${modelReference} requires \`openai\` API auth, but none is configured. Run \`pi-dual setup\`, run \`pi-dual auth\`, or export \`OPENAI_API_KEY\`.`
    };
  }

  if (credential.type === "oauth") {
    return {
      status: "pass",
      detail: `Found OAuth-based auth for \`openai\` and ${modelReference}.`
    };
  }

  if (looksLikeEnvReference(credential.key) && !process.env[credential.key]) {
    return {
      status: "fail",
      detail:
        `Pi auth for \`openai\` references environment variable \`${credential.key}\`, but that variable is not set in this shell. Set it, or rerun \`pi-dual auth\` to switch storage methods.`
    };
  }

  return {
    status: "pass",
    detail:
      looksLikeEnvReference(credential.key)
        ? `Found \`openai\` auth via environment variable reference \`${credential.key}\`.`
        : `Found stored \`openai\` API auth for ${modelReference}.`
  };
}

function checkEffectiveAgentBModel(
  modelReference: string | undefined,
  source: "cli" | "config" | "legacy",
  modelRegistry: ModelRegistry
): RuntimeSetupCheck {
  if (!modelReference) {
    return {
      name: "Agent B model",
      status: "warn",
      detail:
        "No `--model-b` override or saved coordinator default is set. The REPL will fall back to Pi's default model selection. If you want a local Agent B, add it in `models.json` and pass `--model-b`."
    };
  }

  try {
    const model = resolveModelReference(modelReference, modelRegistry);
    return {
      name: "Agent B model",
      status: "pass",
      detail: `${modelReference} resolves to ${model.name ?? model.id} (${renderModelSourceLabel(source)}).`
    };
  } catch (error) {
    return {
      name: "Agent B model",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

function resolveModelReference(
  modelReference: string,
  modelRegistry: ModelRegistry
): { id: string; name?: string; provider: string } {
  const canonicalMatch = modelReference.includes("/")
    ? parseCanonicalModelReference(modelReference, modelRegistry)
    : undefined;

  if (canonicalMatch) {
    return canonicalMatch;
  }

  const all = modelRegistry.getAll();
  const exact = all.filter((model) => model.id === modelReference);
  if (exact.length === 1 && exact[0]) {
    return exact[0] as { id: string; name?: string; provider: string };
  }
  if (exact.length > 1) {
    throw new Error(`Ambiguous model override: ${modelReference}`);
  }
  throw new Error(`Unknown model override: ${modelReference}`);
}

function parseCanonicalModelReference(
  modelReference: string,
  modelRegistry: ModelRegistry
): { id: string; name?: string; provider: string } | undefined {
  const [provider, ...rest] = modelReference.split("/");
  const modelId = rest.join("/");
  if (!provider || !modelId) {
    return undefined;
  }

  const resolved = modelRegistry.find(provider, modelId);
  return resolved ? (resolved as { id: string; name?: string; provider: string }) : undefined;
}

function isSupportedNodeVersion(version: string): boolean {
  const match = /^v?(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)/u.exec(version);
  if (!match?.groups) {
    return false;
  }

  const majorText = match.groups.major;
  const minorText = match.groups.minor;
  const patchText = match.groups.patch;
  if (!majorText || !minorText || !patchText) {
    return false;
  }
  const major = Number.parseInt(majorText, 10);
  const minor = Number.parseInt(minorText, 10);
  const patch = Number.parseInt(patchText, 10);

  if (major > 20) {
    return true;
  }
  if (major < 20) {
    return false;
  }
  if (minor > 6) {
    return true;
  }
  if (minor < 6) {
    return false;
  }
  return patch >= 0;
}

function formatStatus(status: RuntimeSetupCheck["status"]): string {
  switch (status) {
    case "pass":
      return "[PASS]";
    case "warn":
      return "[WARN]";
    case "fail":
      return "[FAIL]";
  }
}

function formatRecommendedDoctorArgs(
  options: DoctorCliOptions | ReplCliOptions | PortalCliOptions
): string {
  const parts: string[] = [];
  if (options.cwd) {
    parts.push(options.cwd);
  }
  if (options.modelA) {
    parts.push("--model-a", options.modelA);
  }
  if (options.modelB) {
    parts.push("--model-b", options.modelB);
  }
  if (options.agentDir) {
    parts.push("--agent-dir", options.agentDir);
  }
  if (options.mcpEnabled === false) {
    parts.push("--no-mcp");
  }
  for (const path of options.mcpConfigPaths ?? []) {
    parts.push("--mcp-config", path);
  }
  return parts.join(" ");
}

function renderModelSourceLabel(source: "cli" | "config" | "legacy"): string {
  switch (source) {
    case "cli":
      return "from `--model-*`";
    case "config":
      return "from saved coordinator defaults";
    case "legacy":
      return "from Pi fallback";
  }
}

function looksLikeEnvReference(value: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/u.test(value);
}

function asAuthStorageData(parsed: unknown): Parameters<typeof AuthStorage.inMemory>[0] {
  if (!isRecord(parsed)) {
    return {};
  }
  return parsed as Parameters<typeof AuthStorage.inMemory>[0];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
