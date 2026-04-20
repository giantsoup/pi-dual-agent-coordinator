import { constants as fsConstants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { version as nodeVersion } from "node:process";

import {
  AuthStorage,
  getAgentDir,
  ModelRegistry
} from "@mariozechner/pi-coding-agent";

import type { DoctorCliOptions, ReplCliOptions } from "./cli.js";
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

  const authResult = await checkJsonFile(
    "Pi auth file",
    authPath,
    `Copy examples/pi-agent/auth.json.example to ${authPath} and set your API key source.`
  );
  checks.push(authResult.check);

  const modelsResult = await checkJsonFile(
    "Pi models file",
    modelsPath,
    `Copy one of the templates from examples/pi-agent/ to ${modelsPath}, then update the provider URL and local model id.`
  );
  checks.push(modelsResult.check);

  if (authResult.parsed && modelsResult.parsed) {
    try {
      const authStorage = AuthStorage.create(authPath);
      const modelRegistry = ModelRegistry.create(authStorage, modelsPath);

      if (options.modelA) {
        checks.push(resolveModelCheck("Agent A model", options.modelA, modelRegistry));
      } else {
        checks.push({
          name: "Agent A model",
          status: "warn",
          detail: "No --model-a override supplied. The REPL will fall back to Pi's default model selection."
        });
      }

      if (options.modelB) {
        checks.push(resolveModelCheck("Agent B model", options.modelB, modelRegistry));
      } else {
        checks.push({
          name: "Agent B model",
          status: "warn",
          detail: "No --model-b override supplied. The REPL will fall back to Pi's default model selection."
        });
      }
    } catch (error) {
      checks.push({
        name: "Pi model registry",
        status: "fail",
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

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
    checks
  };
}

export async function assertRuntimeSetupReady(
  options: DoctorCliOptions | ReplCliOptions
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

async function checkJsonFile(
  name: string,
  path: string,
  missingHint: string
): Promise<{ check: RuntimeSetupCheck; parsed?: unknown }> {
  try {
    await access(path, fsConstants.R_OK);
  } catch {
    return {
      check: {
        name,
        status: "fail",
        detail: `${path} is missing. ${missingHint}`
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

function resolveModelCheck(
  name: string,
  modelReference: string,
  modelRegistry: ModelRegistry
): RuntimeSetupCheck {
  try {
    const model = resolveModelReference(modelReference, modelRegistry);
    return {
      name,
      status: "pass",
      detail: `${modelReference} resolves to ${model.name ?? model.id}.`
    };
  } catch (error) {
    return {
      name,
      status: "fail",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

function resolveModelReference(
  modelReference: string,
  modelRegistry: ModelRegistry
): { id: string; name?: string } {
  const canonicalMatch = modelReference.includes("/")
    ? parseCanonicalModelReference(modelReference, modelRegistry)
    : undefined;

  if (canonicalMatch) {
    return canonicalMatch;
  }

  const all = modelRegistry.getAll();
  const exact = all.filter((model) => model.id === modelReference);
  if (exact.length === 1) {
    return exact[0] as { id: string; name?: string };
  }
  if (exact.length > 1) {
    throw new Error(`Ambiguous model override: ${modelReference}`);
  }
  throw new Error(`Unknown model override: ${modelReference}`);
}

function parseCanonicalModelReference(
  modelReference: string,
  modelRegistry: ModelRegistry
): { id: string; name?: string } | undefined {
  const [provider, ...rest] = modelReference.split("/");
  const modelId = rest.join("/");
  if (!provider || !modelId) {
    return undefined;
  }

  const resolved = modelRegistry.find(provider, modelId);
  return resolved ? (resolved as { id: string; name?: string }) : undefined;
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
  options: DoctorCliOptions | ReplCliOptions
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
