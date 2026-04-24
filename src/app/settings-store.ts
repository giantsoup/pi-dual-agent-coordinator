import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { PortalCliOptions, ReplCliOptions, ReplThinkingLevel } from "./cli.js";
import {
  getCoordinatorConfigPath,
  loadCoordinatorConfig,
  writeCoordinatorConfig,
  type CoordinatorConfigV1
} from "./coordinator-config.js";
import {
  createProjectHash,
  getWorkspaceProjectDir,
  getWorkspaceThreadDir
} from "./workspace-index.js";
import type {
  UiSettingsFieldSource,
  UiSettingsOverrides,
  UiSettingsScope,
  UiSettingsScopeState,
  UiSettingsState,
  UiSettingsValues
} from "../types/ui.js";

export interface StoredProjectSettings {
  version: 1;
  overrides: UiSettingsOverrides;
}

export interface StoredThreadSettings {
  version: 1;
  overrides: UiSettingsOverrides;
}

type CliSettingsInput = Pick<
  PortalCliOptions | ReplCliOptions,
  "cwd" | "modelA" | "modelB" | "thinkingA" | "thinkingB" | "mcpEnabled"
>;

export async function resolveUiSettingsState(input: {
  cli?: Partial<CliSettingsInput> | undefined;
  projectPath: string;
  threadId?: string | undefined;
  selectedScope?: UiSettingsScope | undefined;
}): Promise<UiSettingsState> {
  const [globalConfig, projectSettings, threadSettings] = await Promise.all([
    loadCoordinatorConfig(),
    loadProjectSettings(input.projectPath),
    input.threadId ? loadThreadSettings(input.threadId) : Promise.resolve(undefined)
  ]);

  const globalValues = configDefaultsToOverrides(globalConfig.config);
  const projectValues = projectSettings?.overrides ?? {};
  const threadValues = threadSettings?.overrides ?? {};
  const cliValues = sanitizeOverrides(input.cli ?? {});

  const effective = resolveEffectiveValues({
    cli: cliValues,
    thread: threadValues,
    project: projectValues,
    global: globalValues
  });

  return {
    activeScope:
      input.selectedScope ?? (input.threadId ? "thread" : "project"),
    effective,
    providers: [],
    catalogByProvider: {},
    scopes: {
      global: createScopeState({
        scope: "global",
        label: "Global defaults",
        values: normalizeScopeValues(globalValues),
        hasOverrides: hasSettingsValues(globalValues),
        available: true
      }),
      project: createScopeState({
        scope: "project",
        label: "Project overrides",
        description: input.projectPath,
        values: normalizeScopeValues(projectValues),
        hasOverrides: hasSettingsValues(projectValues),
        available: true
      }),
      thread: createScopeState({
        scope: "thread",
        label: "Thread overrides",
        description: input.threadId,
        values: normalizeScopeValues(threadValues),
        hasOverrides: hasSettingsValues(threadValues),
        available: Boolean(input.threadId)
      })
    },
    providerOperation: undefined
  };
}

export async function saveUiSettings(input: {
  projectPath: string;
  scope: UiSettingsScope;
  threadId?: string | undefined;
  values: UiSettingsOverrides;
}): Promise<void> {
  const sanitized = sanitizeOverrides(input.values);
  if (input.scope === "global") {
    await saveGlobalSettings(sanitized);
    return;
  }

  if (input.scope === "project") {
    await saveProjectSettings(input.projectPath, sanitized);
    return;
  }

  if (!input.threadId) {
    throw new Error("A thread id is required when saving thread settings.");
  }
  await saveThreadSettings(input.threadId, sanitized);
}

export async function applyScopedSettingsToCliOptions<T extends PortalCliOptions | ReplCliOptions>(
  options: T
): Promise<T> {
  const [globalConfig, projectSettings] = await Promise.all([
    loadCoordinatorConfig(),
    loadProjectSettings(options.cwd)
  ]);
  const projectOverrides = projectSettings?.overrides ?? {};
  const globalDefaults = globalConfig.config?.defaults ?? {};

  return {
    ...options,
    ...(options.modelA ? {} : projectOverrides.modelA ? { modelA: projectOverrides.modelA } : globalDefaults.modelA ? { modelA: globalDefaults.modelA } : {}),
    ...(options.modelB ? {} : projectOverrides.modelB ? { modelB: projectOverrides.modelB } : globalDefaults.modelB ? { modelB: globalDefaults.modelB } : {}),
    ...(options.thinkingA ? {} : projectOverrides.thinkingA ? { thinkingA: projectOverrides.thinkingA } : globalDefaults.thinkingA ? { thinkingA: globalDefaults.thinkingA } : {}),
    ...(options.thinkingB ? {} : projectOverrides.thinkingB ? { thinkingB: projectOverrides.thinkingB } : globalDefaults.thinkingB ? { thinkingB: globalDefaults.thinkingB } : {}),
    ...(options.mcpEnabled !== undefined ? {} : projectOverrides.mcpEnabled !== undefined ? { mcpEnabled: projectOverrides.mcpEnabled } : {})
  };
}

export async function loadProjectSettings(
  projectPath: string
): Promise<StoredProjectSettings | undefined> {
  return readSettingsFile<StoredProjectSettings>(getProjectSettingsPath(projectPath));
}

export async function loadThreadSettings(
  threadId: string
): Promise<StoredThreadSettings | undefined> {
  return readSettingsFile<StoredThreadSettings>(getThreadSettingsPath(threadId));
}

export function getProjectSettingsPath(projectPath: string): string {
  return join(getWorkspaceProjectDir(projectPath), "settings.json");
}

export function getThreadSettingsPath(threadId: string): string {
  return join(getWorkspaceThreadDir(threadId), "settings.json");
}

async function saveGlobalSettings(values: UiSettingsOverrides): Promise<void> {
  const existing = await loadCoordinatorConfig();
  const nextConfig: CoordinatorConfigV1 = {
    version: 1,
    defaults: stripUndefined({
      ...existing.config?.defaults,
      ...coerceGlobalValues(values)
    }),
    ...(existing.config?.onboarding ? { onboarding: existing.config.onboarding } : {})
  };
  await writeCoordinatorConfig(nextConfig, getCoordinatorConfigPath());
}

async function saveProjectSettings(
  projectPath: string,
  values: UiSettingsOverrides
): Promise<void> {
  await writeSettingsFile(getProjectSettingsPath(projectPath), {
    version: 1,
    overrides: stripUndefinedObject(values)
  } satisfies StoredProjectSettings);
}

async function saveThreadSettings(
  threadId: string,
  values: UiSettingsOverrides
): Promise<void> {
  await writeSettingsFile(getThreadSettingsPath(threadId), {
    version: 1,
    overrides: stripUndefined({
      modelA: values.modelA,
      modelB: values.modelB,
      thinkingA: values.thinkingA,
      thinkingB: values.thinkingB
    })
  } satisfies StoredThreadSettings);
}

function createScopeState(input: {
  available: boolean;
  description?: string | undefined;
  hasOverrides: boolean;
  label: string;
  scope: UiSettingsScope;
  values: UiSettingsValues;
}): UiSettingsScopeState {
  return {
    scope: input.scope,
    label: input.label,
    description: input.description,
    available: input.available,
    hasOverrides: input.hasOverrides,
    values: input.values
  };
}

function normalizeScopeValues(values: UiSettingsOverrides): UiSettingsValues {
  return {
    modelA: values.modelA ?? undefined,
    modelB: values.modelB ?? undefined,
    thinkingA: values.thinkingA ?? undefined,
    thinkingB: values.thinkingB ?? undefined,
    mcpEnabled: values.mcpEnabled ?? undefined
  };
}

function resolveEffectiveValues(input: {
  cli: UiSettingsOverrides;
  global: UiSettingsOverrides;
  project: UiSettingsOverrides;
  thread: UiSettingsOverrides;
}): UiSettingsState["effective"] {
  return {
    values: {
      modelA: resolveValue(
        "modelA",
        input.cli.modelA ?? undefined,
        input.thread.modelA ?? undefined,
        input.project.modelA ?? undefined,
        input.global.modelA ?? undefined
      ).value,
      modelB: resolveValue(
        "modelB",
        input.cli.modelB ?? undefined,
        input.thread.modelB ?? undefined,
        input.project.modelB ?? undefined,
        input.global.modelB ?? undefined
      ).value,
      thinkingA: resolveValue<UiSettingsValues["thinkingA"]>(
        "thinkingA",
        input.cli.thinkingA ?? undefined,
        input.thread.thinkingA ?? undefined,
        input.project.thinkingA ?? undefined,
        input.global.thinkingA ?? undefined,
        "high"
      ).value,
      thinkingB: resolveValue<UiSettingsValues["thinkingB"]>(
        "thinkingB",
        input.cli.thinkingB ?? undefined,
        input.thread.thinkingB ?? undefined,
        input.project.thinkingB ?? undefined,
        input.global.thinkingB ?? undefined,
        "medium"
      ).value,
      mcpEnabled: resolveValue(
        "mcpEnabled",
        input.cli.mcpEnabled ?? undefined,
        undefined,
        input.project.mcpEnabled ?? undefined,
        input.global.mcpEnabled ?? undefined
      ).value
    },
    sources: {
      modelA: resolveValue(
        "modelA",
        input.cli.modelA ?? undefined,
        input.thread.modelA ?? undefined,
        input.project.modelA ?? undefined,
        input.global.modelA ?? undefined
      ).source,
      modelB: resolveValue(
        "modelB",
        input.cli.modelB ?? undefined,
        input.thread.modelB ?? undefined,
        input.project.modelB ?? undefined,
        input.global.modelB ?? undefined
      ).source,
      thinkingA: resolveValue(
        "thinkingA",
        input.cli.thinkingA ?? undefined,
        input.thread.thinkingA ?? undefined,
        input.project.thinkingA ?? undefined,
        input.global.thinkingA ?? undefined,
        "high"
      ).source,
      thinkingB: resolveValue(
        "thinkingB",
        input.cli.thinkingB ?? undefined,
        input.thread.thinkingB ?? undefined,
        input.project.thinkingB ?? undefined,
        input.global.thinkingB ?? undefined,
        "medium"
      ).source,
      mcpEnabled: resolveValue(
        "mcpEnabled",
        input.cli.mcpEnabled ?? undefined,
        undefined,
        input.project.mcpEnabled ?? undefined,
        input.global.mcpEnabled ?? undefined
      ).source
    }
  };
}

function resolveValue<T>(
  _field: keyof UiSettingsValues,
  cli: T | undefined,
  thread: T | undefined,
  project: T | undefined,
  global: T | undefined,
  legacy?: T | undefined
): { value?: T | undefined; source: UiSettingsFieldSource } {
  if (cli !== undefined) {
    return { value: cli, source: "cli" };
  }
  if (thread !== undefined) {
    return { value: thread, source: "thread" };
  }
  if (project !== undefined) {
    return { value: project, source: "project" };
  }
  if (global !== undefined) {
    return { value: global, source: "global" };
  }
  return { value: legacy, source: "legacy" };
}

function configDefaultsToOverrides(
  config: CoordinatorConfigV1 | undefined
): UiSettingsOverrides {
  return {
    modelA: config?.defaults.modelA,
    modelB: config?.defaults.modelB,
    thinkingA: config?.defaults.thinkingA,
    thinkingB: config?.defaults.thinkingB
  };
}

function sanitizeOverrides(values: Partial<CliSettingsInput | UiSettingsOverrides>): UiSettingsOverrides {
  return stripUndefined({
    modelA: typeof values.modelA === "string" && values.modelA.trim() ? values.modelA.trim() : undefined,
    modelB: typeof values.modelB === "string" && values.modelB.trim() ? values.modelB.trim() : undefined,
    thinkingA: isThinkingLevel(values.thinkingA) ? values.thinkingA : undefined,
    thinkingB: isThinkingLevel(values.thinkingB) ? values.thinkingB : undefined,
    mcpEnabled: typeof values.mcpEnabled === "boolean" ? values.mcpEnabled : undefined
  });
}

function coerceGlobalValues(values: UiSettingsOverrides): CoordinatorConfigV1["defaults"] {
  return {
    ...(values.modelA ? { modelA: values.modelA } : {}),
    ...(values.modelB ? { modelB: values.modelB } : {}),
    ...(values.thinkingA ? { thinkingA: values.thinkingA } : {}),
    ...(values.thinkingB ? { thinkingB: values.thinkingB } : {})
  };
}

function hasSettingsValues(values: UiSettingsOverrides): boolean {
  return Object.values(values).some((value) => value !== undefined);
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

function stripUndefinedObject<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

async function readSettingsFile<T>(path: string): Promise<T | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

async function writeSettingsFile<T>(path: string, value: T): Promise<void> {
  await mkdir(dirname(path), {
    recursive: true,
    mode: 0o700
  });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isThinkingLevel(value: unknown): value is ReplThinkingLevel {
  return value === "off" || value === "low" || value === "medium" || value === "high";
}

export function getSettingsProjectHash(projectPath: string): string {
  return createProjectHash(projectPath);
}
