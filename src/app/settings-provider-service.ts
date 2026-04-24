import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { getModels, type Model } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  ModelRegistry,
  getAgentDir
} from "@mariozechner/pi-coding-agent";

import { openUrlInBrowser } from "./browser.js";
import type {
  UiProviderAuthState,
  UiProviderDiscoveryState,
  UiProviderKind,
  UiProviderVerifyState,
  UiSelectableModel,
  UiSettingsProviderCatalog,
  UiSettingsProviderState,
  UiSettingsState
} from "../types/ui.js";

const PROVIDER_CACHE_TTL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 2_500;
const DEFAULT_OPENAI_MODEL = "gpt-5.4";
const DEFAULT_CODEX_MODEL = "gpt-5.4";
const MANAGED_LM_STUDIO_PROVIDER = "managed-lm-studio";
const MANAGED_OLLAMA_PROVIDER = "managed-ollama";
const MANAGED_CUSTOM_PREFIX = "managed-custom-";
const LOCAL_PROVIDER_DEFAULTS = {
  input: ["text"] as const,
  reasoning: false,
  compat: {
    supportsDeveloperRole: false,
    supportsReasoningEffort: false
  }
};

type ApiKeySaveMode = "paste-now" | "openai-api-key-env" | "custom-env";
type CustomProviderAuthMode = "paste-now" | "env-var" | "custom-env" | "no-auth";
type ResolvedRequestAuth = Awaited<ReturnType<ModelRegistry["getApiKeyAndHeaders"]>>;

interface ProviderCatalogCore {
  providers: UiSettingsProviderState[];
  catalogByProvider: Record<string, UiSelectableModel[]>;
  lastDiscoveryAt?: string | undefined;
}

interface ManagedProviderModelRecord {
  id: string;
  name?: string | undefined;
  api?: string | undefined;
  reasoning?: boolean | undefined;
  input?: string[] | undefined;
  contextWindow?: number | undefined;
  maxTokens?: number | undefined;
  cost?: {
    input?: number | undefined;
    output?: number | undefined;
    cacheRead?: number | undefined;
    cacheWrite?: number | undefined;
  } | undefined;
  compat?: Record<string, unknown> | undefined;
}

interface ManagedProviderRecord {
  baseUrl?: string | undefined;
  api?: string | undefined;
  apiKey?: string | undefined;
  authHeader?: boolean | undefined;
  models?: ManagedProviderModelRecord[] | undefined;
}

interface ManagedModelsFile {
  providers?: Record<string, ManagedProviderRecord> | undefined;
}

interface LmStudioApiModel {
  key?: string | undefined;
  id?: string | undefined;
  display_name?: string | undefined;
  max_context_length?: number | undefined;
  type?: string | undefined;
}

interface OllamaApiModel {
  model?: string | undefined;
  name?: string | undefined;
  details?: {
    context_length?: number | undefined;
  } | undefined;
}

interface SettingsProviderServiceDependencies {
  agentDir?: string | undefined;
  createAuthStorage?(authPath: string): AuthStorage;
  createModelRegistry?(authStorage: AuthStorage, modelsPath: string): ModelRegistry;
  fetch?: typeof fetch;
  now?: () => Date;
  openBrowser?(url: string): Promise<{ status: "opened" | "failed" | "unsupported" }>;
  pathHasExecutable?(name: string): Promise<boolean>;
  timeoutMs?: number | undefined;
}

export class SettingsProviderService {
  private readonly agentDir: string;
  private readonly authPath: string;
  private readonly modelsPath: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly openBrowserImpl: NonNullable<SettingsProviderServiceDependencies["openBrowser"]>;
  private readonly timeoutMs: number;
  private readonly pathHasExecutableImpl: NonNullable<
    SettingsProviderServiceDependencies["pathHasExecutable"]
  >;
  private readonly createAuthStorageImpl: NonNullable<
    SettingsProviderServiceDependencies["createAuthStorage"]
  >;
  private readonly createModelRegistryImpl: NonNullable<
    SettingsProviderServiceDependencies["createModelRegistry"]
  >;
  private cachedCatalog:
    | {
        expiresAt: number;
        value: ProviderCatalogCore;
      }
    | undefined;
  private readonly verifyStates = new Map<string, UiProviderVerifyState>();

  public constructor(dependencies: SettingsProviderServiceDependencies = {}) {
    this.agentDir = dependencies.agentDir ?? getAgentDir();
    this.authPath = join(this.agentDir, "auth.json");
    this.modelsPath = join(this.agentDir, "models.json");
    this.fetchImpl = dependencies.fetch ?? fetch;
    this.now = dependencies.now ?? (() => new Date());
    this.openBrowserImpl = dependencies.openBrowser ?? openUrlInBrowser;
    this.timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.pathHasExecutableImpl =
      dependencies.pathHasExecutable ?? defaultPathHasExecutable;
    this.createAuthStorageImpl =
      dependencies.createAuthStorage ?? ((authPath) => AuthStorage.create(authPath));
    this.createModelRegistryImpl =
      dependencies.createModelRegistry ??
      ((authStorage, modelsPath) => ModelRegistry.create(authStorage, modelsPath));
  }

  public async getCatalog(options: {
    force?: boolean | undefined;
  } = {}): Promise<UiSettingsProviderCatalog> {
    const now = this.now();
    const current = this.cachedCatalog;
    if (!options.force && current && current.expiresAt > now.getTime()) {
      return this.decorateCatalog(current.value);
    }

    const next = await this.discoverCatalog();
    this.cachedCatalog = {
      expiresAt: now.getTime() + PROVIDER_CACHE_TTL_MS,
      value: next
    };
    return this.decorateCatalog(next);
  }

  public async connectProviderOauth(
    provider: "openai-codex"
  ): Promise<UiSettingsProviderCatalog> {
    const authStorage = this.createAuthStorage();
    let browserUrl: string | undefined;

    await authStorage.login(provider, {
      onAuth: async (info) => {
        browserUrl = info.url;
        await this.openBrowserImpl(info.url);
      },
      onProgress: () => {},
      onPrompt: async () => {
        throw new Error(
          "Browser-only ChatGPT sign-in could not complete. Run `pi-dual auth` in a terminal if manual code entry is required."
        );
      },
      onManualCodeInput: async () => {
        throw new Error(
          "Manual ChatGPT OAuth fallback is not available from the web settings UI."
        );
      }
    });

    const authError = authStorage.drainErrors()[0];
    if (authError) {
      throw authError;
    }

    if (!browserUrl) {
      throw new Error("ChatGPT sign-in did not produce a browser authorization URL.");
    }

    this.invalidateCache();
    return this.getCatalog({
      force: true
    });
  }

  public async saveOpenAiApiKey(input: {
    mode: ApiKeySaveMode;
    value?: string | undefined;
  }): Promise<UiSettingsProviderCatalog> {
    const authStorage = this.createAuthStorage();
    const key =
      input.mode === "paste-now"
        ? input.value?.trim()
        : input.mode === "openai-api-key-env"
          ? "OPENAI_API_KEY"
          : input.value?.trim();

    if (!key) {
      throw new Error("A value is required for this OpenAI API auth mode.");
    }

    authStorage.set("openai", {
      type: "api_key",
      key
    });
    const authError = authStorage.drainErrors()[0];
    if (authError) {
      throw authError;
    }

    this.invalidateCache();
    return this.getCatalog({
      force: true
    });
  }

  public async saveCustomProvider(input: {
    label: string;
    baseUrl: string;
    authMode: CustomProviderAuthMode;
    authValue?: string | undefined;
    modelId: string;
  }): Promise<UiSettingsProviderCatalog> {
    const label = input.label.trim();
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const modelId = input.modelId.trim();
    if (!label) {
      throw new Error("A custom provider label is required.");
    }
    if (!baseUrl) {
      throw new Error("A custom provider base URL is required.");
    }
    if (!modelId) {
      throw new Error("A custom provider model id is required.");
    }

    const providerId = buildManagedCustomProviderId(label, baseUrl, modelId);
    const authStorage = this.createAuthStorage();
    if (input.authMode === "no-auth") {
      authStorage.remove(providerId);
    } else {
      const authKey =
        input.authMode === "env-var"
          ? "OPENAI_API_KEY"
          : input.authValue?.trim();
      if (!authKey) {
        throw new Error("A key or env var name is required for this custom provider.");
      }
      authStorage.set(providerId, {
        type: "api_key",
        key: authKey
      });
    }

    const authError = authStorage.drainErrors()[0];
    if (authError) {
      throw authError;
    }

    await this.upsertManagedProvider(providerId, {
      baseUrl,
      api: "openai-completions",
      models: [
        {
          id: modelId,
          name: formatCustomModelName(label, modelId),
          api: "openai-completions",
          reasoning: false,
          input: ["text"],
          contextWindow: 128000,
          maxTokens: 16384,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0
          },
          compat: {
            supportsDeveloperRole: false,
            supportsReasoningEffort: false
          }
        }
      ]
    });

    this.invalidateCache();
    return this.getCatalog({
      force: true
    });
  }

  public async verifyTarget(input: {
    provider: string;
    modelId?: string | undefined;
  }): Promise<UiSettingsProviderCatalog> {
    const current = await this.getCatalog({
      force: false
    });
    const providerState = current.providers.find((provider) => provider.id === input.provider);
    if (!providerState) {
      this.verifyStates.set(input.provider, {
        status: "failed",
        message: "The selected provider is not available in settings anymore.",
        target: formatCanonicalModelRef(input.provider, input.modelId ?? ""),
        checkedAt: this.now().toISOString(),
        nextStep: "Refresh providers or select a different provider and model."
      });
      const catalogByProvider = structuredClone(current.catalogByProvider);
      if (input.modelId) {
        const models = catalogByProvider[input.provider] ?? [];
        if (!models.some((model) => model.id === input.modelId)) {
          models.push({
            id: input.modelId,
            provider: input.provider,
            canonicalRef: formatCanonicalModelRef(input.provider, input.modelId),
            name: `${input.modelId} (Unavailable)`,
            available: false,
            reasoning: false,
            supportsReasoningEffort: false,
            input: ["text"],
            detail: "This saved target is no longer available and can be replaced."
          });
        }
        catalogByProvider[input.provider] = models;
      }

      return this.decorateCatalog({
        providers: [
          ...current.providers,
          createProviderState({
            id: input.provider,
            kind: inferProviderKind(input.provider),
            label: `${input.provider} (Unavailable)`,
            auth: createDisconnectedAuthState(
              "This saved provider is no longer configured."
            ),
            discovery: createDiscoveryState({
              available: false,
              reachable: false,
              modelsFound: catalogByProvider[input.provider]?.length ?? 0,
              label: "Unavailable",
              detail:
                "This provider was saved earlier but is not currently discoverable."
            }),
            defaultModelId: input.modelId,
            hidden: input.provider.startsWith(MANAGED_CUSTOM_PREFIX),
            sourceModelCount: catalogByProvider[input.provider]?.length ?? 0
          })
        ],
        catalogByProvider,
        lastDiscoveryAt: current.lastDiscoveryAt
      });
    }

    const targetModelId = input.modelId?.trim() || providerState.defaultModelId;
    if (!targetModelId) {
      this.verifyStates.set(input.provider, {
        status: "failed",
        message: "No model is selected for verification.",
        target: providerState.id,
        checkedAt: this.now().toISOString(),
        nextStep: "Pick a model first, then verify the target."
      });
      return this.decorateCatalog(
        this.cachedCatalog?.value ?? {
          providers: current.providers,
          catalogByProvider: current.catalogByProvider,
          lastDiscoveryAt: current.lastDiscoveryAt
        }
      );
    }

    this.verifyStates.set(input.provider, {
      status: "running",
      target: formatCanonicalModelRef(input.provider, targetModelId)
    });

    const result = await this.runVerification({
      provider: input.provider,
      modelId: targetModelId
    });
    this.verifyStates.set(input.provider, result);

    return this.decorateCatalog(
      this.cachedCatalog?.value ?? {
        providers: current.providers,
        catalogByProvider: current.catalogByProvider,
        lastDiscoveryAt: current.lastDiscoveryAt
      }
    );
  }

  public async ensureManagedProviderForModelRef(modelRef: string): Promise<void> {
    const parsed = parseCanonicalModelRef(modelRef);
    if (!parsed) {
      return;
    }

    if (parsed.provider === MANAGED_LM_STUDIO_PROVIDER) {
      const discovery = await this.getCatalog({
        force: true
      });
      const models = discovery.catalogByProvider[MANAGED_LM_STUDIO_PROVIDER] ?? [];
      if (models.length === 0) {
        throw new Error("LM Studio is not reachable, so its managed provider could not be saved.");
      }
      await this.writeManagedLmStudioProvider(models);
      this.invalidateCache();
      return;
    }

    if (parsed.provider === MANAGED_OLLAMA_PROVIDER) {
      const discovery = await this.getCatalog({
        force: true
      });
      const models = discovery.catalogByProvider[MANAGED_OLLAMA_PROVIDER] ?? [];
      if (models.length === 0) {
        throw new Error("Ollama is not reachable, so its managed provider could not be saved.");
      }
      await this.writeManagedOllamaProvider(models, parsed.modelId);
      this.invalidateCache();
      return;
    }

    if (parsed.provider.startsWith(MANAGED_CUSTOM_PREFIX)) {
      const file = await this.readManagedModelsFile();
      if (!file.providers?.[parsed.provider]) {
        throw new Error(
          `Custom provider ${parsed.provider} is no longer defined in Pi models.json.`
        );
      }
    }
  }

  public invalidateCache(): void {
    this.cachedCatalog = undefined;
  }

  private decorateCatalog(catalog: ProviderCatalogCore): UiSettingsProviderCatalog {
    return {
      providers: catalog.providers.map((provider) => ({
        ...provider,
        verify:
          this.verifyStates.get(provider.id) ??
          provider.verify ??
          {
            status: "idle"
          }
      })),
      catalogByProvider: structuredClone(catalog.catalogByProvider),
      lastDiscoveryAt: catalog.lastDiscoveryAt
    };
  }

  private async discoverCatalog(): Promise<ProviderCatalogCore> {
    const authStorage = this.createAuthStorage();
    const modelRegistry = this.createModelRegistry(authStorage);
    const [openAi, codex, lmStudio, ollama, customProviders] = await Promise.all([
      this.discoverOpenAiProvider(modelRegistry),
      this.discoverCodexProvider(authStorage),
      this.discoverLmStudioProvider(),
      this.discoverOllamaProvider(),
      this.discoverManagedCustomProviders(authStorage)
    ]);

    const providers = [
      codex.provider,
      openAi.provider,
      lmStudio.provider,
      ollama.provider,
      ...customProviders.providers
    ];
    const catalogByProvider = {
      [codex.provider.id]: codex.catalog,
      [openAi.provider.id]: openAi.catalog,
      [lmStudio.provider.id]: lmStudio.catalog,
      [ollama.provider.id]: ollama.catalog,
      ...customProviders.catalogByProvider
    };

    return {
      providers,
      catalogByProvider,
      lastDiscoveryAt: this.now().toISOString()
    };
  }

  private async discoverOpenAiProvider(
    modelRegistry: ModelRegistry
  ): Promise<{ provider: UiSettingsProviderState; catalog: UiSelectableModel[] }> {
    const builtInCatalog = getModels("openai");
    const defaultModel = builtInCatalog.find((model) => model.id === DEFAULT_OPENAI_MODEL) ?? builtInCatalog[0];
    if (!defaultModel) {
      return {
        provider: createProviderState({
          id: "openai",
          kind: "openai",
          label: "OpenAI API",
          auth: createDisconnectedAuthState("No OpenAI models are registered."),
          discovery: createDiscoveryState({
            available: false,
            reachable: false,
            modelsFound: 0,
            label: "Not connected",
            detail: "Pi does not have a built-in OpenAI catalog available."
          }),
          sourceModelCount: 0
        }),
        catalog: []
      };
    }

    const auth = await modelRegistry.getApiKeyAndHeaders(defaultModel);
    if (!auth.ok) {
      return {
        provider: createProviderState({
          id: "openai",
          kind: "openai",
          label: "OpenAI API",
          auth: describeOpenAiAuthState(this.createAuthStorage()),
          discovery: createDiscoveryState({
            available: false,
            reachable: false,
            modelsFound: 0,
            label: "Not connected",
            detail: auth.error
          }),
          defaultModelId: defaultModel.id,
          sourceModelCount: 0
        }),
        catalog: []
      };
    }

    try {
      const response = await this.fetchJson(
        "https://api.openai.com/v1/models",
        toAuthRequestInit(auth)
      );
      const remoteIds = new Set(extractOpenAiModelIds(response));
      const catalog = builtInCatalog
        .filter((model) => remoteIds.has(model.id))
        .map((model) => toSelectableModel(model));

      return {
        provider: createProviderState({
          id: "openai",
          kind: "openai",
          label: "OpenAI API",
          auth: describeOpenAiAuthState(this.createAuthStorage()),
          discovery: createDiscoveryState({
            available: true,
            reachable: true,
            modelsFound: catalog.length,
            label: "Authenticated"
          }),
          defaultModelId: pickDefaultModelId(catalog, DEFAULT_OPENAI_MODEL),
          sourceModelCount: catalog.length
        }),
        catalog
      };
    } catch (error) {
      return {
        provider: createProviderState({
          id: "openai",
          kind: "openai",
          label: "OpenAI API",
          auth: describeOpenAiAuthState(this.createAuthStorage()),
          discovery: createDiscoveryState({
            available: false,
            reachable: false,
            modelsFound: 0,
            label: "Not reachable",
            detail: error instanceof Error ? error.message : String(error)
          }),
          defaultModelId: defaultModel.id,
          sourceModelCount: 0
        }),
        catalog: []
      };
    }
  }

  private async discoverCodexProvider(
    authStorage: AuthStorage
  ): Promise<{ provider: UiSettingsProviderState; catalog: UiSelectableModel[] }> {
    const builtInCatalog = getModels("openai-codex").map((model) => toSelectableModel(model));
    const credential = authStorage.get("openai-codex");

    return {
      provider: createProviderState({
        id: "openai-codex",
        kind: "openai-codex",
        label: "OpenAI Codex",
        auth:
          credential?.type === "oauth"
            ? {
                connected: true,
                label: "Authenticated",
                source: "oauth"
              }
            : createDisconnectedAuthState("Sign in with ChatGPT to enable Codex models."),
        discovery: createDiscoveryState({
          available: builtInCatalog.length > 0,
          reachable: builtInCatalog.length > 0,
          modelsFound: builtInCatalog.length,
          label: credential?.type === "oauth" ? "Authenticated" : "Not connected"
        }),
        defaultModelId: pickDefaultModelId(builtInCatalog, DEFAULT_CODEX_MODEL),
        sourceModelCount: builtInCatalog.length
      }),
      catalog: builtInCatalog
    };
  }

  private async discoverLmStudioProvider(): Promise<{
    provider: UiSettingsProviderState;
    catalog: UiSelectableModel[];
  }> {
    const installed = await this.pathHasExecutableImpl("lms");
    try {
      const response = await this.fetchJson("http://127.0.0.1:1234/api/v1/models");
      const models = extractLmStudioModels(response);
      const catalog = models.map((model) => toLmStudioSelectableModel(model));
      return {
        provider: createProviderState({
          id: MANAGED_LM_STUDIO_PROVIDER,
          kind: "lm-studio",
          label: "LM Studio",
          auth: {
            connected: true,
            label: installed ? "Running" : "Running",
            source: "no-auth"
          },
          discovery: createDiscoveryState({
            available: true,
            reachable: true,
            running: true,
            installed,
            modelsFound: catalog.length,
            label: "Running"
          }),
          defaultModelId: catalog[0]?.id,
          sourceModelCount: catalog.length
        }),
        catalog
      };
    } catch (primaryError) {
      try {
        const response = await this.fetchJson("http://127.0.0.1:1234/v1/models");
        const catalog = extractOpenAiModelsFromListResponse(response).map((modelId) =>
          toSelectableModel({
            id: modelId,
            name: modelId,
            api: "openai-completions",
            provider: MANAGED_LM_STUDIO_PROVIDER,
            baseUrl: "http://127.0.0.1:1234/v1",
            reasoning: false,
            input: ["text"],
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0
            },
            contextWindow: 128000,
            maxTokens: 16384
          })
        );
        return {
          provider: createProviderState({
            id: MANAGED_LM_STUDIO_PROVIDER,
            kind: "lm-studio",
            label: "LM Studio",
            auth: {
              connected: true,
              label: "Running",
              source: "no-auth"
            },
            discovery: createDiscoveryState({
              available: true,
              reachable: true,
              running: true,
              installed,
              modelsFound: catalog.length,
              label: "Running"
            }),
            defaultModelId: catalog[0]?.id,
            sourceModelCount: catalog.length
          }),
          catalog
        };
      } catch (fallbackError) {
        const detail = primaryError instanceof Error ? primaryError.message : String(primaryError);
        return {
          provider: createProviderState({
            id: MANAGED_LM_STUDIO_PROVIDER,
            kind: "lm-studio",
            label: "LM Studio",
            auth: {
              connected: installed,
              label: installed ? "Installed" : "Not connected",
              source: "no-auth"
            },
            discovery: createDiscoveryState({
              available: false,
              reachable: false,
              running: false,
              installed,
              modelsFound: 0,
              label: "Not reachable",
              detail:
                fallbackError instanceof Error
                  ? `${detail}. Fallback: ${fallbackError.message}`
                  : detail
            }),
            sourceModelCount: 0
          }),
          catalog: []
        };
      }
    }
  }

  private async discoverOllamaProvider(): Promise<{
    provider: UiSettingsProviderState;
    catalog: UiSelectableModel[];
  }> {
    const installed = await this.pathHasExecutableImpl("ollama");
    try {
      const response = await this.fetchJson("http://127.0.0.1:11434/api/tags");
      const models = extractOllamaModels(response);
      const catalog = models.map((model) => toOllamaSelectableModel(model));
      return {
        provider: createProviderState({
          id: MANAGED_OLLAMA_PROVIDER,
          kind: "ollama",
          label: "Ollama",
          auth: {
            connected: true,
            label: "Running",
            source: "no-auth"
          },
          discovery: createDiscoveryState({
            available: true,
            reachable: true,
            running: true,
            installed,
            modelsFound: catalog.length,
            label: "Running"
          }),
          defaultModelId: catalog[0]?.id,
          sourceModelCount: catalog.length
        }),
        catalog
      };
    } catch (primaryError) {
      try {
        const response = await this.fetchJson("http://127.0.0.1:11434/v1/models");
        const catalog = extractOpenAiModelsFromListResponse(response).map((modelId) =>
          toSelectableModel({
            id: modelId,
            name: modelId,
            api: "openai-completions",
            provider: MANAGED_OLLAMA_PROVIDER,
            baseUrl: "http://127.0.0.1:11434/v1",
            reasoning: false,
            input: ["text"],
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0
            },
            contextWindow: 32768,
            maxTokens: 4096
          })
        );
        return {
          provider: createProviderState({
            id: MANAGED_OLLAMA_PROVIDER,
            kind: "ollama",
            label: "Ollama",
            auth: {
              connected: true,
              label: "Running",
              source: "no-auth"
            },
            discovery: createDiscoveryState({
              available: true,
              reachable: true,
              running: true,
              installed,
              modelsFound: catalog.length,
              label: "Running"
            }),
            defaultModelId: catalog[0]?.id,
            sourceModelCount: catalog.length
          }),
          catalog
        };
      } catch (fallbackError) {
        const detail = primaryError instanceof Error ? primaryError.message : String(primaryError);
        return {
          provider: createProviderState({
            id: MANAGED_OLLAMA_PROVIDER,
            kind: "ollama",
            label: "Ollama",
            auth: {
              connected: installed,
              label: installed ? "Installed" : "Not connected",
              source: "no-auth"
            },
            discovery: createDiscoveryState({
              available: false,
              reachable: false,
              running: false,
              installed,
              modelsFound: 0,
              label: "Not reachable",
              detail:
                fallbackError instanceof Error
                  ? `${detail}. Fallback: ${fallbackError.message}`
                  : detail
            }),
            sourceModelCount: 0
          }),
          catalog: []
        };
      }
    }
  }

  private async discoverManagedCustomProviders(
    authStorage: AuthStorage
  ): Promise<ProviderCatalogCore> {
    const file = await this.readManagedModelsFile();
    const providerEntries = Object.entries(file.providers ?? {}).filter(([providerId]) =>
      providerId.startsWith(MANAGED_CUSTOM_PREFIX)
    );

    const providers: UiSettingsProviderState[] = [];
    const catalogByProvider: Record<string, UiSelectableModel[]> = {};
    for (const [providerId, provider] of providerEntries) {
      const models = (provider.models ?? []).map((model) =>
        toSelectableModel({
          id: model.id,
          name: model.name ?? model.id,
          api: (model.api ?? provider.api ?? "openai-completions") as Model<string>["api"],
          provider: providerId,
          baseUrl: provider.baseUrl ?? "",
          reasoning: model.reasoning ?? false,
          input: parseModelInputs(model.input),
          cost: {
            input: model.cost?.input ?? 0,
            output: model.cost?.output ?? 0,
            cacheRead: model.cost?.cacheRead ?? 0,
            cacheWrite: model.cost?.cacheWrite ?? 0
          },
          contextWindow: model.contextWindow ?? 128000,
          maxTokens: model.maxTokens ?? 16384
        })
      );
      const providerLabel = inferCustomProviderLabel(providerId, models);
      catalogByProvider[providerId] = models;
      providers.push(
        createProviderState({
          id: providerId,
          kind: "custom-openai-compatible",
          label: providerLabel,
          auth: describeCustomProviderAuthState(authStorage, providerId),
          discovery: createDiscoveryState({
            available: models.length > 0,
            reachable: false,
            modelsFound: models.length,
            label: models.length > 0 ? "Configured" : "Not configured"
          }),
          defaultModelId: models[0]?.id,
          hidden: true,
          sourceModelCount: models.length
        })
      );
    }

    return {
      providers,
      catalogByProvider
    };
  }

  private async runVerification(input: {
    provider: string;
    modelId: string;
  }): Promise<UiProviderVerifyState> {
    const checkedAt = this.now().toISOString();
    const target = formatCanonicalModelRef(input.provider, input.modelId);

    if (input.provider === "openai-codex") {
      const authStorage = this.createAuthStorage();
      const token = await authStorage.getApiKey("openai-codex");
      if (!token) {
        return {
          status: "failed",
          message: "ChatGPT/Codex credentials are not configured.",
          target,
          checkedAt,
          nextStep: "Connect ChatGPT, then verify the selected Codex target again."
        };
      }
      const known = getModels("openai-codex").some((model) => model.id === input.modelId);
      return known
        ? {
            status: "passed",
            message: "Codex credentials resolved and the model exists in Pi's built-in catalog.",
            target,
            checkedAt
          }
        : {
            status: "failed",
            message: "The selected Codex model is not in Pi's built-in catalog.",
            target,
            checkedAt,
            nextStep: "Pick a different Codex model."
          };
    }

    if (input.provider === "openai") {
      const modelRegistry = this.createModelRegistry(this.createAuthStorage());
      const model = modelRegistry.find("openai", input.modelId);
      if (!model) {
        return {
          status: "failed",
          message: "The selected OpenAI model is not supported by Pi.",
          target,
          checkedAt,
          nextStep: "Pick a model from the OpenAI dropdown."
        };
      }
      const auth = await modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok) {
        return {
          status: "failed",
          message: auth.error,
          target,
          checkedAt,
          nextStep: "Add an API key or store an env-var reference, then verify again."
        };
      }
      try {
        await this.fetchJson(`${model.baseUrl}/models/${encodeURIComponent(model.id)}`, toAuthRequestInit(auth));
        return {
          status: "passed",
          message: "OpenAI auth resolved and the selected model exists.",
          target,
          checkedAt
        };
      } catch (error) {
        return {
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
          target,
          checkedAt,
          nextStep: "Check the API key and selected model, then verify again."
        };
      }
    }

    if (input.provider === MANAGED_LM_STUDIO_PROVIDER) {
      const lmStudio = await this.discoverLmStudioProvider();
      const found = lmStudio.catalog.some((model) => model.id === input.modelId);
      return found
        ? {
            status: "passed",
            message: "LM Studio is reachable and the selected model is advertised.",
            target,
            checkedAt
          }
        : {
            status: "failed",
            message: "LM Studio is reachable, but the selected model is not advertised.",
            target,
            checkedAt,
            nextStep: "Refresh LM Studio models or pick a different local model."
          };
    }

    if (input.provider === MANAGED_OLLAMA_PROVIDER) {
      const ollama = await this.discoverOllamaProvider();
      const found = ollama.catalog.some((model) => model.id === input.modelId);
      return found
        ? {
            status: "passed",
            message: "Ollama is reachable and the selected model is advertised.",
            target,
            checkedAt
          }
        : {
            status: "failed",
            message: "Ollama is reachable, but the selected model is not advertised.",
            target,
            checkedAt,
            nextStep: "Refresh Ollama models or pick a different local model."
          };
    }

    return this.verifyCustomOpenAiCompatibleTarget(input.provider, input.modelId, checkedAt);
  }

  private async verifyCustomOpenAiCompatibleTarget(
    providerId: string,
    modelId: string,
    checkedAt: string
  ): Promise<UiProviderVerifyState> {
    const target = formatCanonicalModelRef(providerId, modelId);
    const modelRegistry = this.createModelRegistry(this.createAuthStorage());
    const model = modelRegistry.find(providerId, modelId);
    if (!model) {
      return {
        status: "failed",
        message: "The custom provider entry no longer defines that model.",
        target,
        checkedAt,
        nextStep: "Refresh Advanced providers or recreate the custom provider entry."
      };
    }

    const auth = await modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok && this.requiresAuthForCustomProvider(providerId)) {
      return {
        status: "failed",
        message: auth.error,
        target,
        checkedAt,
        nextStep: "Update the custom provider auth settings, then verify again."
      };
    }

    try {
      await this.fetchJson(
        `${model.baseUrl}/models/${encodeURIComponent(model.id)}`,
        toAuthRequestInit(auth.ok ? auth : undefined)
      );
      return {
        status: "passed",
        message: "The custom provider is reachable and the selected model exists.",
        target,
        checkedAt
      };
    } catch {
      try {
        const response = await this.fetchJson(
          `${model.baseUrl}/models`,
          toAuthRequestInit(auth.ok ? auth : undefined)
        );
        const found = extractOpenAiModelIds(response).includes(model.id);
        return found
          ? {
              status: "passed",
              message: "The custom provider is reachable and the selected model is advertised.",
              target,
              checkedAt
            }
          : {
              status: "failed",
              message: "The custom provider is reachable, but the selected model is not advertised.",
              target,
              checkedAt,
              nextStep: "Update the model id or adjust the provider entry."
            };
      } catch (error) {
        return {
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
          target,
          checkedAt,
          nextStep: "Check the custom provider base URL and auth configuration, then verify again."
        };
      }
    }
  }

  private async writeManagedLmStudioProvider(models: UiSelectableModel[]): Promise<void> {
    await this.upsertManagedProvider(MANAGED_LM_STUDIO_PROVIDER, {
      baseUrl: "http://127.0.0.1:1234/v1",
      api: "openai-completions",
      apiKey: "lm-studio",
      models: models.map((model) => ({
        id: model.id,
        name: model.name,
        api: "openai-completions",
        reasoning: false,
        input: ["text"],
        contextWindow: model.contextWindow ?? 128000,
        maxTokens: model.maxTokens ?? 16384,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0
        },
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false
        }
      }))
    });
  }

  private async writeManagedOllamaProvider(
    models: UiSelectableModel[],
    selectedModelId: string
  ): Promise<void> {
    const enriched = await this.enrichOllamaModels(models, selectedModelId);
    await this.upsertManagedProvider(MANAGED_OLLAMA_PROVIDER, {
      baseUrl: "http://127.0.0.1:11434/v1",
      api: "openai-completions",
      apiKey: "ollama",
      models: enriched.map((model) => ({
        id: model.id,
        name: model.name,
        api: "openai-completions",
        reasoning: false,
        input: ["text"],
        contextWindow: model.contextWindow ?? 32768,
        maxTokens: model.maxTokens ?? 4096,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0
        },
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false
        }
      }))
    });
  }

  private async enrichOllamaModels(
    models: UiSelectableModel[],
    selectedModelId: string
  ): Promise<UiSelectableModel[]> {
    const selected = models.find((model) => model.id === selectedModelId);
    if (!selected) {
      return models;
    }

    try {
      const response = await this.fetchJson("http://127.0.0.1:11434/api/show", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: selectedModelId
        })
      });
      const contextWindow = extractOllamaContextWindow(response);
      const enriched = {
        ...selected,
        contextWindow: contextWindow ?? selected.contextWindow ?? 32768,
        maxTokens: Math.min(4096, contextWindow ?? selected.contextWindow ?? 32768)
      };
      return models.map((model) => (model.id === selectedModelId ? enriched : model));
    } catch {
      return models.map((model) =>
        model.id === selectedModelId
          ? {
              ...model,
              contextWindow: model.contextWindow ?? 32768,
              maxTokens: model.maxTokens ?? 4096
            }
          : model
      );
    }
  }

  private async readManagedModelsFile(): Promise<ManagedModelsFile> {
    try {
      const raw = await readFile(this.modelsPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return {};
      }
      return parsed as ManagedModelsFile;
    } catch {
      return {};
    }
  }

  private async upsertManagedProvider(
    providerId: string,
    provider: ManagedProviderRecord
  ): Promise<void> {
    const file = await this.readManagedModelsFile();
    await mkdir(this.agentDir, {
      recursive: true,
      mode: 0o700
    });
    const next: ManagedModelsFile = {
      ...file,
      providers: {
        ...(file.providers ?? {}),
        [providerId]: provider
      }
    };
    await writeFile(this.modelsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  }

  private async fetchJson(
    url: string,
    init: RequestInit = {}
  ): Promise<unknown> {
    const response = await this.fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) {
      throw new Error(`Request to ${url} failed with HTTP ${response.status}.`);
    }
    return response.json();
  }

  private createAuthStorage(): AuthStorage {
    return this.createAuthStorageImpl(this.authPath);
  }

  private createModelRegistry(authStorage = this.createAuthStorage()): ModelRegistry {
    return this.createModelRegistryImpl(authStorage, this.modelsPath);
  }

  private requiresAuthForCustomProvider(providerId: string): boolean {
    return this.createAuthStorage().hasAuth(providerId);
  }
}

export function augmentSettingsWithProviderCatalog(
  settings: UiSettingsState,
  catalog: UiSettingsProviderCatalog
): UiSettingsState {
  const providers = [...catalog.providers];
  const catalogByProvider = structuredClone(catalog.catalogByProvider);
  const knownProviderIds = new Set(providers.map((provider) => provider.id));
  const relevantModelRefs = new Set<string>();

  for (const scope of Object.values(settings.scopes)) {
    if (scope.values.modelA) {
      relevantModelRefs.add(scope.values.modelA);
    }
    if (scope.values.modelB) {
      relevantModelRefs.add(scope.values.modelB);
    }
  }
  if (settings.effective.values.modelA) {
    relevantModelRefs.add(settings.effective.values.modelA);
  }
  if (settings.effective.values.modelB) {
    relevantModelRefs.add(settings.effective.values.modelB);
  }

  for (const modelRef of relevantModelRefs) {
    const parsed = parseCanonicalModelRef(modelRef);
    if (!parsed) {
      continue;
    }

    if (!catalogByProvider[parsed.provider]) {
      catalogByProvider[parsed.provider] = [];
    }
    const models = catalogByProvider[parsed.provider] ?? [];
    if (!models.some((model) => model.id === parsed.modelId)) {
      models.push({
        id: parsed.modelId,
        provider: parsed.provider,
        canonicalRef: modelRef,
        name: `${parsed.modelId} (Unavailable)`,
        available: false,
        reasoning: false,
        supportsReasoningEffort: false,
        input: ["text"],
        detail: "This saved target is no longer available and can be replaced."
      });
      catalogByProvider[parsed.provider] = models;
    }

    if (!knownProviderIds.has(parsed.provider)) {
      providers.push(
        createProviderState({
          id: parsed.provider,
          kind: inferProviderKind(parsed.provider),
          label: `${parsed.provider} (Unavailable)`,
          auth: createDisconnectedAuthState("This saved provider is no longer configured."),
          discovery: createDiscoveryState({
            available: false,
            reachable: false,
            modelsFound: catalogByProvider[parsed.provider]?.length ?? 0,
            label: "Unavailable",
            detail: "This provider was saved earlier but is not currently discoverable."
          }),
          hidden: parsed.provider.startsWith(MANAGED_CUSTOM_PREFIX),
          sourceModelCount: catalogByProvider[parsed.provider]?.length ?? 0
        })
      );
      knownProviderIds.add(parsed.provider);
    }
  }

  return {
    ...settings,
    providers,
    catalogByProvider,
    lastDiscoveryAt: catalog.lastDiscoveryAt
  };
}

export function buildManagedCustomProviderId(
  label: string,
  baseUrl: string,
  modelId: string
): string {
  const hash = createHash("sha256")
    .update([label.trim().toLowerCase(), normalizeBaseUrl(baseUrl), modelId.trim()].join("\u0000"))
    .digest("hex")
    .slice(0, 8);
  return `${MANAGED_CUSTOM_PREFIX}${hash}`;
}

export function parseCanonicalModelRef(
  value: string
): { provider: string; modelId: string } | undefined {
  const [provider, ...rest] = value.split("/");
  const modelId = rest.join("/");
  if (!provider || !modelId) {
    return undefined;
  }
  return {
    provider,
    modelId
  };
}

export function intersectOpenAiCatalog(
  builtInModels: Array<{ id: string }>,
  remoteModelIds: Iterable<string>
): string[] {
  const remote = new Set(remoteModelIds);
  return builtInModels.filter((model) => remote.has(model.id)).map((model) => model.id);
}

function inferProviderKind(providerId: string): UiProviderKind {
  if (providerId === "openai-codex") {
    return "openai-codex";
  }
  if (providerId === "openai") {
    return "openai";
  }
  if (providerId === MANAGED_LM_STUDIO_PROVIDER) {
    return "lm-studio";
  }
  if (providerId === MANAGED_OLLAMA_PROVIDER) {
    return "ollama";
  }
  return "custom-openai-compatible";
}

function createProviderState(input: {
  id: string;
  kind: UiProviderKind;
  label: string;
  auth: UiProviderAuthState;
  discovery: UiProviderDiscoveryState;
  defaultModelId?: string | undefined;
  hidden?: boolean | undefined;
  sourceModelCount: number;
}): UiSettingsProviderState {
  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    auth: input.auth,
    discovery: input.discovery,
    verify: {
      status: "idle"
    },
    hidden: input.hidden,
    sourceModelCount: input.sourceModelCount,
    defaultModelId: input.defaultModelId
  };
}

function createDiscoveryState(input: {
  available: boolean;
  reachable: boolean;
  modelsFound: number;
  label: string;
  detail?: string | undefined;
  running?: boolean | undefined;
  installed?: boolean | undefined;
}): UiProviderDiscoveryState {
  return {
    available: input.available,
    reachable: input.reachable,
    running: input.running,
    installed: input.installed,
    modelsFound: input.modelsFound,
    label: input.label,
    detail: input.detail
  };
}

function createDisconnectedAuthState(detail?: string): UiProviderAuthState {
  return {
    connected: false,
    label: "Not connected",
    source: "unknown",
    detail
  };
}

function describeOpenAiAuthState(authStorage: AuthStorage): UiProviderAuthState {
  const credential = authStorage.get("openai");
  if (!credential) {
    if (process.env.OPENAI_API_KEY) {
      return {
        connected: true,
        label: "Authenticated",
        source: "env-var",
        detail: "Resolved from OPENAI_API_KEY."
      };
    }
    return createDisconnectedAuthState("Add an API key or store an env-var reference.");
  }

  if (credential.type === "oauth") {
    return {
      connected: true,
      label: "Authenticated",
      source: "oauth"
    };
  }

  if (credential.key === "OPENAI_API_KEY") {
    return {
      connected: Boolean(process.env.OPENAI_API_KEY),
      label: process.env.OPENAI_API_KEY ? "Authenticated" : "Not connected",
      source: "env-var",
      detail: "Uses OPENAI_API_KEY."
    };
  }

  if (isEnvVarReference(credential.key)) {
    return {
      connected: Boolean(process.env[credential.key]),
      label: process.env[credential.key] ? "Authenticated" : "Not connected",
      source: "custom-env-var",
      detail: `Uses ${credential.key}.`
    };
  }

  return {
    connected: true,
    label: "Authenticated",
    source: "stored-key"
  };
}

function describeCustomProviderAuthState(
  authStorage: AuthStorage,
  providerId: string
): UiProviderAuthState {
  const credential = authStorage.get(providerId);
  if (!credential) {
    return {
      connected: true,
      label: "No auth",
      source: "no-auth"
    };
  }

  if (credential.type !== "api_key") {
    return {
      connected: true,
      label: "Authenticated",
      source: "oauth"
    };
  }

  if (credential.key === "OPENAI_API_KEY") {
    return {
      connected: Boolean(process.env.OPENAI_API_KEY),
      label: process.env.OPENAI_API_KEY ? "Authenticated" : "Not connected",
      source: "env-var",
      detail: "Uses OPENAI_API_KEY."
    };
  }

  if (isEnvVarReference(credential.key)) {
    return {
      connected: Boolean(process.env[credential.key]),
      label: process.env[credential.key] ? "Authenticated" : "Not connected",
      source: "custom-env-var",
      detail: `Uses ${credential.key}.`
    };
  }

  return {
    connected: true,
    label: "Authenticated",
    source: "stored-key"
  };
}

function formatCanonicalModelRef(provider: string, modelId: string): string {
  return `${provider}/${modelId}`;
}

function formatCustomModelName(label: string, modelId: string): string {
  return `${label} (${modelId})`;
}

function inferCustomProviderLabel(
  providerId: string,
  models: UiSelectableModel[]
): string {
  const first = models[0];
  if (!first) {
    return providerId;
  }
  const suffix = ` (${first.id})`;
  return first.name.endsWith(suffix)
    ? first.name.slice(0, Math.max(0, first.name.length - suffix.length))
    : first.name;
}

function pickDefaultModelId(
  catalog: UiSelectableModel[],
  preferredId: string
): string | undefined {
  return catalog.find((model) => model.id === preferredId)?.id ?? catalog[0]?.id;
}

function toSelectableModel(model: Model<string>): UiSelectableModel {
  return {
    id: model.id,
    provider: model.provider,
    canonicalRef: formatCanonicalModelRef(model.provider, model.id),
    name: model.name,
    available: true,
    reasoning: model.reasoning,
    supportsReasoningEffort:
      model.reasoning &&
      (typeof model.compat !== "object" ||
        model.compat === null ||
        (model.compat as { supportsReasoningEffort?: boolean }).supportsReasoningEffort !==
          false),
    input: model.input,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens
  };
}

function toLmStudioSelectableModel(model: LmStudioApiModel): UiSelectableModel {
  const id = model.key ?? model.id ?? "unknown-model";
  const contextWindow = model.max_context_length ?? 128000;
  return {
    id,
    provider: MANAGED_LM_STUDIO_PROVIDER,
    canonicalRef: formatCanonicalModelRef(MANAGED_LM_STUDIO_PROVIDER, id),
    name: model.display_name ?? id,
    available: true,
    reasoning: false,
    supportsReasoningEffort: false,
    input: ["text"],
    contextWindow,
    maxTokens: Math.min(16384, contextWindow)
  };
}

function toOllamaSelectableModel(model: OllamaApiModel): UiSelectableModel {
  const id = model.model ?? model.name ?? "unknown-model";
  return {
    id,
    provider: MANAGED_OLLAMA_PROVIDER,
    canonicalRef: formatCanonicalModelRef(MANAGED_OLLAMA_PROVIDER, id),
    name: model.name ?? id,
    available: true,
    reasoning: false,
    supportsReasoningEffort: false,
    input: ["text"],
    contextWindow: model.details?.context_length ?? 32768,
    maxTokens: 4096
  };
}

function extractOpenAiModelIds(value: unknown): string[] {
  return extractOpenAiModelsFromListResponse(value);
}

function extractOpenAiModelsFromListResponse(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    return [];
  }
  return value.data
    .map((entry) => (isRecord(entry) && typeof entry.id === "string" ? entry.id : undefined))
    .filter((entry): entry is string => Boolean(entry));
}

function extractLmStudioModels(value: unknown): LmStudioApiModel[] {
  if (!isRecord(value) || !Array.isArray(value.models)) {
    return [];
  }
  return value.models.filter(isRecord) as LmStudioApiModel[];
}

function extractOllamaModels(value: unknown): OllamaApiModel[] {
  if (!isRecord(value) || !Array.isArray(value.models)) {
    return [];
  }
  return value.models.filter(isRecord) as OllamaApiModel[];
}

function extractOllamaContextWindow(value: unknown): number | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (typeof value.context_length === "number") {
    return value.context_length;
  }
  if (isRecord(value.details) && typeof value.details.context_length === "number") {
    return value.details.context_length;
  }
  if (isRecord(value.model_info)) {
    const architectureLength = value.model_info["llama.context_length"];
    if (typeof architectureLength === "number") {
      return architectureLength;
    }
  }
  return undefined;
}

function toAuthRequestInit(auth?: ResolvedRequestAuth): RequestInit {
  if (!auth || !auth.ok) {
    return {};
  }
  const headers = new Headers(auth.headers ?? {});
  if (auth.apiKey && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${auth.apiKey}`);
  }
  return {
    headers
  };
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/u, "");
}

function parseModelInputs(value: string[] | undefined): Array<"text" | "image"> {
  return value?.includes("image") ? ["text", "image"] : ["text"];
}

function isEnvVarReference(value: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/u.test(value);
}

async function defaultPathHasExecutable(name: string): Promise<boolean> {
  const pathValue = process.env.PATH;
  if (!pathValue) {
    return false;
  }

  const suffixes =
    process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const directory of pathValue.split(":")) {
    for (const suffix of suffixes) {
      try {
        await access(join(directory, `${name}${suffix}`), fsConstants.X_OK);
        return true;
      } catch {
        continue;
      }
    }
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
