import { chmodSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type {
  AuthCliOptions,
  DoctorCliOptions,
  PortalCliOptions,
  ReplCliOptions,
  ReplThinkingLevel,
  SetupCliOptions
} from "./cli.js";

export interface CoordinatorConfigV1 {
  version: 1;
  defaults: {
    modelA?: string;
    modelB?: string;
    thinkingA?: "off" | "low" | "medium" | "high";
    thinkingB?: "off" | "low" | "medium" | "high";
  };
  onboarding?: {
    lastSelectedAgentAAuthFlow?:
      | "openai-api-key"
      | "openai-chatgpt-subscription";
    lastCompletedAt?: string;
  };
}

export interface LoadedCoordinatorConfig {
  path: string;
  exists: boolean;
  config?: CoordinatorConfigV1;
  warnings: string[];
}

export interface EffectiveValue<T> {
  value?: T;
  source: "cli" | "config" | "legacy";
}

type OptionsWithCoordinatorDefaults =
  | ReplCliOptions
  | PortalCliOptions
  | DoctorCliOptions
  | SetupCliOptions
  | AuthCliOptions;

const VALID_THINKING = new Set<ReplThinkingLevel>(["off", "low", "medium", "high"]);

export function getCoordinatorConfigDir(): string {
  const overrideRoot = process.env.PI_DUAL_COORDINATOR_HOME;
  return overrideRoot
    ? resolveOverrideConfigDir(overrideRoot)
    : join(homedir(), ".pi", "dual-agent-coordinator");
}

export function getCoordinatorConfigPath(): string {
  return join(getCoordinatorConfigDir(), "config.json");
}

export async function loadCoordinatorConfig(
  configPath = getCoordinatorConfigPath()
): Promise<LoadedCoordinatorConfig> {
  try {
    await access(configPath);
  } catch {
    return {
      path: configPath,
      exists: false,
      warnings: []
    };
  }

  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const normalized = normalizeCoordinatorConfig(parsed);
    const result: LoadedCoordinatorConfig = {
      path: configPath,
      exists: true,
      warnings: normalized.warnings
    };
    if (normalized.config) {
      result.config = normalized.config;
    }
    return result;
  } catch (error) {
    return {
      path: configPath,
      exists: true,
      warnings: [
        `Coordinator config could not be parsed. ${error instanceof Error ? error.message : String(error)}`
      ]
    };
  }
}

export async function writeCoordinatorConfig(
  config: CoordinatorConfigV1,
  configPath = getCoordinatorConfigPath()
): Promise<void> {
  const configDir = dirname(configPath);
  await mkdir(configDir, {
    recursive: true,
    mode: 0o700
  });
  chmodSync(configDir, 0o700);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  chmodSync(configPath, 0o600);
}

export function resolveEffectiveModelA(
  options: Pick<DoctorCliOptions | ReplCliOptions | PortalCliOptions, "modelA">,
  config?: CoordinatorConfigV1
): EffectiveValue<string> {
  if (options.modelA) {
    return { value: options.modelA, source: "cli" };
  }
  if (config?.defaults.modelA) {
    return { value: config.defaults.modelA, source: "config" };
  }
  return { source: "legacy" };
}

export function resolveEffectiveModelB(
  options: Pick<DoctorCliOptions | ReplCliOptions | PortalCliOptions, "modelB">,
  config?: CoordinatorConfigV1
): EffectiveValue<string> {
  if (options.modelB) {
    return { value: options.modelB, source: "cli" };
  }
  if (config?.defaults.modelB) {
    return { value: config.defaults.modelB, source: "config" };
  }
  return { source: "legacy" };
}

export function resolveEffectiveThinkingA(
  options: Pick<ReplCliOptions | PortalCliOptions, "thinkingA">,
  config?: CoordinatorConfigV1
): EffectiveValue<ReplThinkingLevel> {
  if (options.thinkingA) {
    return { value: options.thinkingA, source: "cli" };
  }
  if (config?.defaults.thinkingA) {
    return { value: config.defaults.thinkingA, source: "config" };
  }
  return { source: "legacy" };
}

export function resolveEffectiveThinkingB(
  options: Pick<ReplCliOptions | PortalCliOptions, "thinkingB">,
  config?: CoordinatorConfigV1
): EffectiveValue<ReplThinkingLevel> {
  if (options.thinkingB) {
    return { value: options.thinkingB, source: "cli" };
  }
  if (config?.defaults.thinkingB) {
    return { value: config.defaults.thinkingB, source: "config" };
  }
  return { source: "legacy" };
}

export function applyCoordinatorDefaultsToCliOptions(
  options: ReplCliOptions,
  config?: CoordinatorConfigV1
): ReplCliOptions;
export function applyCoordinatorDefaultsToCliOptions(
  options: PortalCliOptions,
  config?: CoordinatorConfigV1
): PortalCliOptions;
export function applyCoordinatorDefaultsToCliOptions(
  options: DoctorCliOptions,
  config?: CoordinatorConfigV1
): DoctorCliOptions;
export function applyCoordinatorDefaultsToCliOptions(
  options: SetupCliOptions,
  config?: CoordinatorConfigV1
): SetupCliOptions;
export function applyCoordinatorDefaultsToCliOptions(
  options: AuthCliOptions,
  config?: CoordinatorConfigV1
): AuthCliOptions;
export function applyCoordinatorDefaultsToCliOptions(
  options: OptionsWithCoordinatorDefaults,
  config?: CoordinatorConfigV1
): OptionsWithCoordinatorDefaults {
  if (
    options.command !== "repl" &&
    options.command !== "portal" &&
    options.command !== "doctor"
  ) {
    return options;
  }

  const resolvedModelA = resolveEffectiveModelA(options, config);
  const resolvedModelB = resolveEffectiveModelB(options, config);

  if (options.command === "doctor") {
    const resolved: DoctorCliOptions = {
      ...options,
      ...(resolvedModelA.value ? { modelA: resolvedModelA.value } : {}),
      ...(resolvedModelB.value ? { modelB: resolvedModelB.value } : {})
    };
    return resolved;
  }

  const resolvedThinkingA = resolveEffectiveThinkingA(options, config);
  const resolvedThinkingB = resolveEffectiveThinkingB(options, config);

  if (options.command === "portal") {
    const resolved: PortalCliOptions = {
      ...options,
      ...(resolvedModelA.value ? { modelA: resolvedModelA.value } : {}),
      ...(resolvedModelB.value ? { modelB: resolvedModelB.value } : {}),
      ...(resolvedThinkingA.value ? { thinkingA: resolvedThinkingA.value } : {}),
      ...(resolvedThinkingB.value ? { thinkingB: resolvedThinkingB.value } : {})
    };
    return resolved;
  }

  const resolved: ReplCliOptions = {
    ...options,
    ...(resolvedModelA.value ? { modelA: resolvedModelA.value } : {}),
    ...(resolvedModelB.value ? { modelB: resolvedModelB.value } : {}),
    ...(resolvedThinkingA.value ? { thinkingA: resolvedThinkingA.value } : {}),
    ...(resolvedThinkingB.value ? { thinkingB: resolvedThinkingB.value } : {})
  };
  return resolved;
}

export function createCoordinatorConfigPatch(input: {
  modelA?: string;
  modelB?: string;
  thinkingA?: ReplThinkingLevel;
  thinkingB?: ReplThinkingLevel;
  onboarding?: CoordinatorConfigV1["onboarding"];
}): CoordinatorConfigV1 {
  return {
    version: 1,
    defaults: {
      ...(input.modelA ? { modelA: input.modelA } : {}),
      ...(input.modelB ? { modelB: input.modelB } : {}),
      ...(input.thinkingA ? { thinkingA: input.thinkingA } : {}),
      ...(input.thinkingB ? { thinkingB: input.thinkingB } : {})
    },
    ...(input.onboarding ? { onboarding: input.onboarding } : {})
  };
}

function normalizeCoordinatorConfig(value: unknown): {
  config?: CoordinatorConfigV1;
  warnings: string[];
} {
  const warnings: string[] = [];
  if (!isRecord(value)) {
    return {
      warnings: ["Coordinator config must be a JSON object."]
    };
  }

  const version = value.version;
  if (version !== 1) {
    return {
      warnings: ["Coordinator config has an unsupported version. Run `pi-dual setup` to rewrite it."]
    };
  }

  const defaults = isRecord(value.defaults) ? value.defaults : {};
  if (!isRecord(value.defaults) && value.defaults !== undefined) {
    warnings.push("Coordinator config ignored an invalid `defaults` object.");
  }

  const onboarding = isRecord(value.onboarding) ? value.onboarding : undefined;
  if (!isRecord(value.onboarding) && value.onboarding !== undefined) {
    warnings.push("Coordinator config ignored an invalid `onboarding` object.");
  }

  const config: CoordinatorConfigV1 = {
    version: 1,
    defaults: {
      ...pickOptionalString(defaults.modelA, "defaults.modelA", warnings),
      ...pickOptionalString(defaults.modelB, "defaults.modelB", warnings),
      ...pickOptionalThinking(defaults.thinkingA, "defaults.thinkingA", warnings),
      ...pickOptionalThinking(defaults.thinkingB, "defaults.thinkingB", warnings)
    }
  };

  const normalizedOnboarding = normalizeOnboarding(onboarding, warnings);
  if (normalizedOnboarding) {
    config.onboarding = normalizedOnboarding;
  }

  return {
    config,
    warnings
  };
}

function normalizeOnboarding(
  value: Record<string, unknown> | undefined,
  warnings: string[]
): CoordinatorConfigV1["onboarding"] | undefined {
  if (!value) {
    return undefined;
  }

  const onboarding: NonNullable<CoordinatorConfigV1["onboarding"]> = {};
  if (
    value.lastSelectedAgentAAuthFlow === "openai-api-key" ||
    value.lastSelectedAgentAAuthFlow === "openai-chatgpt-subscription"
  ) {
    onboarding.lastSelectedAgentAAuthFlow = value.lastSelectedAgentAAuthFlow;
  } else if (value.lastSelectedAgentAAuthFlow !== undefined) {
    warnings.push("Coordinator config ignored an invalid onboarding auth flow.");
  }

  if (typeof value.lastCompletedAt === "string" && value.lastCompletedAt.trim()) {
    onboarding.lastCompletedAt = value.lastCompletedAt;
  } else if (value.lastCompletedAt !== undefined) {
    warnings.push("Coordinator config ignored an invalid onboarding completion timestamp.");
  }

  return Object.keys(onboarding).length > 0 ? onboarding : undefined;
}

function pickOptionalString(
  value: unknown,
  label: string,
  warnings: string[]
): Partial<Pick<CoordinatorConfigV1["defaults"], "modelA" | "modelB">> {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "string" || !value.trim()) {
    warnings.push(`Coordinator config ignored invalid ${label}.`);
    return {};
  }
  return { [label.endsWith("modelA") ? "modelA" : "modelB"]: value } as Partial<
    Pick<CoordinatorConfigV1["defaults"], "modelA" | "modelB">
  >;
}

function pickOptionalThinking(
  value: unknown,
  label: string,
  warnings: string[]
): Partial<Pick<CoordinatorConfigV1["defaults"], "thinkingA" | "thinkingB">> {
  if (value === undefined) {
    return {};
  }
  if (!VALID_THINKING.has(value as ReplThinkingLevel)) {
    warnings.push(`Coordinator config ignored invalid ${label}.`);
    return {};
  }
  return { [label.endsWith("thinkingA") ? "thinkingA" : "thinkingB"]: value } as Partial<
    Pick<CoordinatorConfigV1["defaults"], "thinkingA" | "thinkingB">
  >;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveOverrideConfigDir(root: string): string {
  return join(root, "dual-agent-coordinator");
}
