import {
  useEffect,
  useMemo,
  useState,
  type ReactElement
} from "react";

import type {
  UiAction,
  UiSettingsOverrides,
  UiSettingsProviderState,
  UiSettingsScope,
  UiSettingsState
} from "../../../../src/types/ui.js";
import { Badge, Button, NoticeBanner } from "../components/ui.js";

interface AgentTargetDraft {
  providerId: string;
  modelId: string;
}

interface SettingsDraft {
  agentA: AgentTargetDraft;
  agentB: AgentTargetDraft;
  thinkingA: "" | "off" | "low" | "medium" | "high";
  thinkingB: "" | "off" | "low" | "medium" | "high";
  mcpEnabled: "" | "true" | "false";
}

interface CustomProviderDraft {
  label: string;
  baseUrl: string;
  authMode: "paste-now" | "env-var" | "custom-env" | "no-auth";
  authValue: string;
  modelId: string;
}

const PRIMARY_PROVIDER_ORDER = [
  "openai-codex",
  "openai",
  "managed-lm-studio",
  "managed-ollama"
] as const;

export function SettingsView(props: {
  canMutate: boolean;
  isSubmitting: boolean;
  onAction(action: UiAction): Promise<boolean>;
  settings: UiSettingsState;
}): ReactElement {
  const scopeState = props.settings.scopes[props.settings.activeScope];
  const providerOperation = props.settings.providerOperation;
  const providerActionRunning = providerOperation?.status === "running";
  const [draft, setDraft] = useState<SettingsDraft>(() =>
    scopeToDraft(scopeState.values)
  );
  const [openAiApiKey, setOpenAiApiKey] = useState("");
  const [openAiCustomEnv, setOpenAiCustomEnv] = useState("");
  const [customDraft, setCustomDraft] = useState<CustomProviderDraft>({
    label: "",
    baseUrl: "",
    authMode: "no-auth",
    authValue: "",
    modelId: ""
  });
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    setDraft(scopeToDraft(scopeState.values));
  }, [
    props.settings.activeScope,
    scopeState.values.modelA,
    scopeState.values.modelB,
    scopeState.values.thinkingA,
    scopeState.values.thinkingB,
    scopeState.values.mcpEnabled
  ]);

  const providersById = useMemo(
    () =>
      new Map(props.settings.providers.map((provider) => [provider.id, provider] as const)),
    [props.settings.providers]
  );
  const primaryProviders = PRIMARY_PROVIDER_ORDER
    .map((id) => providersById.get(id))
    .filter((provider): provider is UiSettingsProviderState => Boolean(provider));
  const advancedProviders = props.settings.providers.filter(
    (provider) => provider.hidden || provider.kind === "custom-openai-compatible"
  );

  return (
    <section className="settings-view">
      <header className="settings-view__header">
        <div>
          <div className="workspace-eyebrow">Scoped Defaults</div>
          <h2>Settings</h2>
          <p>
            Provider setup applies at the machine level. Model and thinking selections still save
            at the selected global, project, or thread scope.
          </p>
        </div>
        <Button
          onClick={() => {
            void props.onAction({ type: "close_settings" });
          }}
        >
          Back to Thread
        </Button>
      </header>

      <div className="settings-scopes">
        {(["global", "project", "thread"] as const).map((scope) => {
          const item = props.settings.scopes[scope];
          return (
            <button
              key={scope}
              className="settings-scope-card"
              data-active={scope === props.settings.activeScope ? "true" : "false"}
              disabled={!item.available}
              type="button"
              onClick={() => {
                void props.onAction({
                  type: "open_settings",
                  scope
                });
              }}
            >
              <strong>{item.label}</strong>
              <span>{item.description ?? "No target selected"}</span>
              <Badge tone={item.hasOverrides ? "accent" : "neutral"}>
                {item.hasOverrides ? "Overrides set" : "Inherited"}
              </Badge>
            </button>
          );
        })}
      </div>

      {props.settings.providerOperation?.status === "running" ? (
        <NoticeBanner tone="info">
          {formatProviderOperationLabel(props.settings.providerOperation)}
        </NoticeBanner>
      ) : null}
      {props.settings.providerOperation?.status === "error" ? (
        <NoticeBanner tone="error">
          {props.settings.providerOperation.message ?? "The provider operation failed."}
        </NoticeBanner>
      ) : null}

      <section className="settings-section">
        <div className="settings-section__header">
          <div>
            <div className="workspace-eyebrow">Machine Setup</div>
            <h3>Provider setup</h3>
          </div>
          <Button
            disabled={providerActionRunning}
            onClick={() => {
              void props.onAction({
                type: "refresh_settings_providers"
              });
            }}
          >
            {providerOperation?.status === "running" &&
            providerOperation.kind === "refresh"
              ? "Refreshing..."
              : "Refresh all"}
          </Button>
        </div>

        <div className="provider-setup" aria-busy={providerActionRunning}>
          {primaryProviders.map((provider) => (
            <ProviderRow
              key={provider.id}
              canMutate={props.canMutate}
              onAction={props.onAction}
              provider={provider}
              providerOperation={providerOperation}
              openAiApiKey={openAiApiKey}
              openAiCustomEnv={openAiCustomEnv}
              onOpenAiApiKeyChange={setOpenAiApiKey}
              onOpenAiCustomEnvChange={setOpenAiCustomEnv}
            />
          ))}

          <details
            className="provider-advanced"
            open={advancedOpen}
            onToggle={(event) => {
              setAdvancedOpen((event.currentTarget as HTMLDetailsElement).open);
            }}
          >
            <summary>Advanced</summary>
            <div className="provider-advanced__body">
              {advancedProviders.length > 0 ? (
                <div className="provider-setup provider-setup--nested">
                  {advancedProviders.map((provider) => (
                    <ProviderRow
                      key={provider.id}
                      canMutate={props.canMutate}
                      onAction={props.onAction}
                      provider={provider}
                      providerOperation={providerOperation}
                      openAiApiKey={openAiApiKey}
                      openAiCustomEnv={openAiCustomEnv}
                      onOpenAiApiKeyChange={setOpenAiApiKey}
                      onOpenAiCustomEnvChange={setOpenAiCustomEnv}
                    />
                  ))}
                </div>
              ) : null}

              <div className="provider-custom-form">
                <h4>Add custom provider</h4>
                <div className="provider-custom-grid">
                  <SettingsField
                    label="Label"
                    value={customDraft.label}
                    onChange={(value) =>
                      setCustomDraft((current) => ({
                        ...current,
                        label: value
                      }))
                    }
                  />
                  <SettingsField
                    label="Base URL"
                    value={customDraft.baseUrl}
                    onChange={(value) =>
                      setCustomDraft((current) => ({
                        ...current,
                        baseUrl: value
                      }))
                    }
                  />
                  <SettingsSelect
                    label="Auth mode"
                    value={customDraft.authMode}
                    options={["paste-now", "env-var", "custom-env", "no-auth"]}
                    onChange={(value) =>
                      setCustomDraft((current) => ({
                        ...current,
                        authMode: value as CustomProviderDraft["authMode"]
                      }))
                    }
                  />
                  <SettingsField
                    label={
                      customDraft.authMode === "paste-now"
                        ? "API key"
                        : customDraft.authMode === "custom-env"
                          ? "Env var"
                          : customDraft.authMode === "env-var"
                            ? "Env var"
                            : "Auth"
                    }
                    type={customDraft.authMode === "paste-now" ? "password" : "text"}
                    value={
                      customDraft.authMode === "env-var"
                        ? "OPENAI_API_KEY"
                        : customDraft.authValue
                    }
                    disabled={customDraft.authMode === "no-auth" || customDraft.authMode === "env-var"}
                    onChange={(value) =>
                      setCustomDraft((current) => ({
                        ...current,
                        authValue: value
                      }))
                    }
                  />
                  <SettingsField
                    label="Model id"
                    value={customDraft.modelId}
                    onChange={(value) =>
                      setCustomDraft((current) => ({
                        ...current,
                        modelId: value
                      }))
                    }
                  />
                </div>
                <div className="provider-actions provider-actions--inline">
                  <Button
                    disabled={!props.canMutate || providerActionRunning}
                    tone="accent"
                    variant="primary"
                    onClick={async () => {
                      const accepted = await props.onAction({
                        type: "save_custom_provider",
                        label: customDraft.label,
                        baseUrl: customDraft.baseUrl,
                        authMode: customDraft.authMode,
                        ...(customDraft.authMode === "env-var"
                          ? {
                              authValue: "OPENAI_API_KEY"
                            }
                          : customDraft.authMode !== "no-auth" && customDraft.authValue.trim()
                            ? {
                                authValue: customDraft.authValue.trim()
                              }
                            : {}),
                        modelId: customDraft.modelId
                      });
                      if (accepted) {
                        setCustomDraft({
                          label: "",
                          baseUrl: "",
                          authMode: "no-auth",
                          authValue: "",
                          modelId: ""
                        });
                      }
                    }}
                  >
                    {providerOperation?.status === "running" &&
                    providerOperation.kind === "save_custom_provider"
                      ? "Adding..."
                      : "Add custom provider"}
                  </Button>
                </div>
              </div>
            </div>
          </details>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section__header">
          <div>
            <div className="workspace-eyebrow">Scoped Selection</div>
            <h3>Agent targets</h3>
          </div>
        </div>

        <div className="agent-targets">
          <AgentTargetCard
            title="Model A"
            canMutate={props.canMutate}
            catalogByProvider={props.settings.catalogByProvider}
            draft={draft.agentA}
            onAction={props.onAction}
            onChange={(next) =>
              setDraft((current) => ({
                ...current,
                agentA: next
              }))
            }
            providers={props.settings.providers}
            providerOperation={providerOperation}
            thinking={draft.thinkingA}
            thinkingLabel="Thinking A"
            onThinkingChange={(value) =>
              setDraft((current) => ({
                ...current,
                thinkingA: value as SettingsDraft["thinkingA"]
              }))
            }
          />
          <AgentTargetCard
            title="Model B"
            canMutate={props.canMutate}
            catalogByProvider={props.settings.catalogByProvider}
            draft={draft.agentB}
            onAction={props.onAction}
            onChange={(next) =>
              setDraft((current) => ({
                ...current,
                agentB: next
              }))
            }
            providers={props.settings.providers}
            providerOperation={providerOperation}
            thinking={draft.thinkingB}
            thinkingLabel="Thinking B"
            onThinkingChange={(value) =>
              setDraft((current) => ({
                ...current,
                thinkingB: value as SettingsDraft["thinkingB"]
              }))
            }
          />
          <SettingsSelect
            label="MCP Default"
            value={draft.mcpEnabled}
            options={["", "true", "false"]}
            onChange={(value) =>
              setDraft((current) => ({
                ...current,
                mcpEnabled: value as SettingsDraft["mcpEnabled"]
              }))
            }
          />
        </div>
      </section>

      <div className="settings-effective">
        <h3>Effective values</h3>
        <div className="settings-effective__grid">
          {Object.entries(props.settings.effective.values).map(([field, value]) => (
            <div key={field} className="settings-effective__item">
              <span>{field}</span>
              <strong>{String(value ?? "inherit")}</strong>
              <Badge>
                {props.settings.effective.sources[
                  field as keyof typeof props.settings.effective.sources
                ]}
              </Badge>
            </div>
          ))}
        </div>
      </div>

      <div className="settings-actions">
        <Button
          disabled={!props.canMutate || props.isSubmitting || !scopeState.available}
          onClick={() => {
            void props.onAction({
              type: "save_settings",
              scope: props.settings.activeScope,
              values: draftToOverrides(draft)
            });
          }}
          tone="accent"
          variant="primary"
        >
          Save {scopeState.label}
        </Button>
        {props.settings.activeScope !== "global" ? (
          <Button
            disabled={!props.canMutate || props.isSubmitting || !scopeState.available}
            onClick={() => {
              void props.onAction({
                type: "save_settings",
                scope: props.settings.activeScope,
                values: {
                  modelA: null,
                  modelB: null,
                  thinkingA: null,
                  thinkingB: null,
                  mcpEnabled: null
                }
              });
            }}
          >
            Clear Overrides
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function ProviderRow(props: {
  canMutate: boolean;
  onAction(action: UiAction): Promise<boolean>;
  openAiApiKey: string;
  onOpenAiApiKeyChange(value: string): void;
  openAiCustomEnv: string;
  onOpenAiCustomEnvChange(value: string): void;
  provider: UiSettingsProviderState;
  providerOperation: UiSettingsState["providerOperation"];
}): ReactElement {
  const verifiedAt = props.provider.verify.checkedAt ?? props.provider.discovery.lastVerifiedAt;
  const providerActionRunning = props.providerOperation?.status === "running";
  const isCurrentProviderAction =
    providerActionRunning && props.providerOperation?.provider === props.provider.id;
  const isVerifying =
    isCurrentProviderAction && props.providerOperation?.kind === "verify_target";
  const isConnecting =
    isCurrentProviderAction && props.providerOperation?.kind === "connect_oauth";
  const isSavingApiKey =
    isCurrentProviderAction && props.providerOperation?.kind === "save_api_key";

  return (
    <article className="provider-row">
      <div className="provider-row__header">
        <div>
          <h4>{props.provider.label}</h4>
          <div className="provider-row__badges">
            <Badge tone={props.provider.auth.connected ? "success" : "neutral"}>
              {props.provider.auth.label}
            </Badge>
            <Badge tone={providerReachabilityTone(props.provider)}>
              {props.provider.discovery.label}
            </Badge>
            <Badge>Models found: {props.provider.discovery.modelsFound}</Badge>
            {verifiedAt ? <Badge>Last verified: {formatTimestamp(verifiedAt)}</Badge> : null}
          </div>
          {props.provider.verify.message ? (
            <p className="provider-row__meta">
              {props.provider.verify.target ? `${props.provider.verify.target}: ` : ""}
              {props.provider.verify.message}
            </p>
          ) : props.provider.discovery.detail ? (
            <p className="provider-row__meta">{props.provider.discovery.detail}</p>
          ) : props.provider.auth.detail ? (
            <p className="provider-row__meta">{props.provider.auth.detail}</p>
          ) : null}
        </div>
      </div>

      <div className="provider-actions">
        {props.provider.id === "openai-codex" ? (
          <>
            <Button
              disabled={!props.canMutate || providerActionRunning}
              onClick={() => {
                void props.onAction({
                  type: "connect_provider_oauth",
                  provider: "openai-codex"
                });
              }}
            >
              {isConnecting
                ? "Connecting..."
                : props.provider.auth.connected
                  ? "Reconnect"
                  : "Connect ChatGPT"}
            </Button>
            <Button
              disabled={providerActionRunning || !props.provider.defaultModelId}
              onClick={() => {
                void props.onAction({
                  type: "verify_provider_target",
                  provider: props.provider.id,
                  modelId: props.provider.defaultModelId
                });
              }}
            >
              {isVerifying ? "Verifying..." : "Verify"}
            </Button>
          </>
        ) : null}

        {props.provider.id === "openai" ? (
          <>
            <div className="provider-inline-field">
              <input
                placeholder="Paste API key"
                type="password"
                value={props.openAiApiKey}
                onChange={(event) => props.onOpenAiApiKeyChange(event.target.value)}
              />
              <Button
                disabled={!props.canMutate || providerActionRunning || !props.openAiApiKey.trim()}
                onClick={async () => {
                  const accepted = await props.onAction({
                    type: "save_provider_api_key",
                    provider: "openai",
                    mode: "paste-now",
                    value: props.openAiApiKey
                  });
                  if (accepted) {
                    props.onOpenAiApiKeyChange("");
                  }
                }}
              >
                {isSavingApiKey ? "Saving..." : "Add API key"}
              </Button>
            </div>
            <Button
              disabled={!props.canMutate || providerActionRunning}
              onClick={() => {
                void props.onAction({
                  type: "save_provider_api_key",
                  provider: "openai",
                  mode: "openai-api-key-env"
                });
              }}
            >
              {isSavingApiKey ? "Saving..." : "Use OPENAI_API_KEY"}
            </Button>
            <div className="provider-inline-field">
              <input
                placeholder="CUSTOM_ENV_NAME"
                value={props.openAiCustomEnv}
                onChange={(event) => props.onOpenAiCustomEnvChange(event.target.value)}
              />
              <Button
                disabled={!props.canMutate || providerActionRunning || !props.openAiCustomEnv.trim()}
                onClick={async () => {
                  const accepted = await props.onAction({
                    type: "save_provider_api_key",
                    provider: "openai",
                    mode: "custom-env",
                    value: props.openAiCustomEnv
                  });
                  if (accepted) {
                    props.onOpenAiCustomEnvChange("");
                  }
                }}
              >
                {isSavingApiKey ? "Saving..." : "Use custom env var"}
              </Button>
            </div>
            <Button
              disabled={providerActionRunning || !props.provider.defaultModelId}
              onClick={() => {
                void props.onAction({
                  type: "verify_provider_target",
                  provider: props.provider.id,
                  modelId: props.provider.defaultModelId
                });
              }}
            >
              {isVerifying ? "Verifying..." : "Verify"}
            </Button>
          </>
        ) : null}

        {(props.provider.id === "managed-lm-studio" || props.provider.id === "managed-ollama") ? (
          <>
            <Button
              disabled={providerActionRunning}
              onClick={() => {
                void props.onAction({
                  type: "refresh_settings_providers"
                });
              }}
            >
              {props.providerOperation?.status === "running" &&
              props.providerOperation.kind === "refresh"
                ? "Refreshing..."
                : "Refresh"}
            </Button>
            <Button
              disabled={providerActionRunning || !props.provider.defaultModelId}
              onClick={() => {
                void props.onAction({
                  type: "verify_provider_target",
                  provider: props.provider.id,
                  modelId: props.provider.defaultModelId
                });
              }}
            >
              {isVerifying ? "Verifying..." : "Verify"}
            </Button>
          </>
        ) : null}

        {props.provider.kind === "custom-openai-compatible" ? (
          <Button
            disabled={providerActionRunning || !props.provider.defaultModelId}
            onClick={() => {
              void props.onAction({
                type: "verify_provider_target",
                provider: props.provider.id,
                modelId: props.provider.defaultModelId
              });
            }}
          >
            {isVerifying ? "Verifying..." : "Verify"}
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function AgentTargetCard(props: {
  canMutate: boolean;
  catalogByProvider: UiSettingsState["catalogByProvider"];
  draft: AgentTargetDraft;
  onAction(action: UiAction): Promise<boolean>;
  onChange(next: AgentTargetDraft): void;
  onThinkingChange(value: string): void;
  providers: UiSettingsProviderState[];
  providerOperation: UiSettingsState["providerOperation"];
  thinking: string;
  thinkingLabel: string;
  title: string;
}): ReactElement {
  const providerOptions = props.providers
    .filter((provider) => !provider.hidden || provider.kind === "custom-openai-compatible")
    .sort((left, right) => {
      const leftRank = providerSortRank(left.id);
      const rightRank = providerSortRank(right.id);
      return leftRank - rightRank || left.label.localeCompare(right.label);
    });
  const modelOptions =
    props.catalogByProvider[props.draft.providerId]?.slice().sort((left, right) =>
      left.name.localeCompare(right.name)
    ) ?? [];
  const selectedProvider = props.providers.find((provider) => provider.id === props.draft.providerId);
  const selectedModel = modelOptions.find((model) => model.id === props.draft.modelId);
  const providerActionRunning = props.providerOperation?.status === "running";
  const isVerifyingSelectedTarget =
    providerActionRunning &&
    props.providerOperation?.kind === "verify_target" &&
    props.providerOperation.provider === props.draft.providerId;

  return (
    <article className="agent-target-card">
      <div className="agent-target-card__header">
        <h4>{props.title}</h4>
        {selectedModel && !selectedModel.available ? (
          <Badge tone="warning">Unavailable</Badge>
        ) : null}
      </div>
      <div className="agent-target-grid">
        <SettingsSelect
          label="Provider"
          value={props.draft.providerId}
          options={providerOptions.map((provider) => provider.id)}
          labels={Object.fromEntries(
            providerOptions.map((provider) => [
              provider.id,
              provider.hidden ? `Advanced · ${provider.label}` : provider.label
            ])
          )}
          onChange={(value) => {
            const nextProvider = props.providers.find((provider) => provider.id === value);
            const nextModels = props.catalogByProvider[value] ?? [];
            const nextModelId =
              nextProvider?.defaultModelId &&
              nextModels.some((model) => model.id === nextProvider.defaultModelId)
                ? nextProvider.defaultModelId
                : nextModels.slice().sort((left, right) => left.name.localeCompare(right.name))[0]
                    ?.id ?? "";
            props.onChange({
              providerId: value,
              modelId: nextModelId
            });
          }}
        />
        <SettingsSelect
          label="Model"
          value={props.draft.modelId}
          options={modelOptions.map((model) => model.id)}
          labels={Object.fromEntries(modelOptions.map((model) => [model.id, model.name]))}
          disabled={!props.draft.providerId}
          onChange={(value) => {
            props.onChange({
              ...props.draft,
              modelId: value
            });
          }}
        />
        <SettingsSelect
          label={props.thinkingLabel}
          value={props.thinking}
          options={["", "off", "low", "medium", "high"]}
          onChange={props.onThinkingChange}
        />
      </div>
      <div className="provider-actions provider-actions--inline">
        <Button
          disabled={
            providerActionRunning ||
            !props.draft.providerId ||
            !props.draft.modelId ||
            !selectedProvider
          }
          onClick={() => {
            void props.onAction({
              type: "verify_provider_target",
              provider: props.draft.providerId,
              modelId: props.draft.modelId
            });
          }}
        >
          {isVerifyingSelectedTarget ? "Verifying..." : "Verify selected target"}
        </Button>
      </div>
      {selectedProvider?.verify.target ===
      `${props.draft.providerId}/${props.draft.modelId}` ? (
        <p className="provider-row__meta">
          {selectedProvider.verify.message}
          {selectedProvider.verify.nextStep ? ` Next: ${selectedProvider.verify.nextStep}` : ""}
        </p>
      ) : selectedModel?.detail ? (
        <p className="provider-row__meta">{selectedModel.detail}</p>
      ) : null}
    </article>
  );
}

function SettingsField(props: {
  disabled?: boolean | undefined;
  label: string;
  onChange(value: string): void;
  type?: "password" | "text" | undefined;
  value: string;
}): ReactElement {
  return (
    <label className="settings-field">
      <span>{props.label}</span>
      <input
        disabled={props.disabled}
        type={props.type ?? "text"}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

function SettingsSelect(props: {
  disabled?: boolean | undefined;
  label: string;
  labels?: Record<string, string> | undefined;
  onChange(value: string): void;
  options: string[];
  value: string;
}): ReactElement {
  return (
    <label className="settings-field">
      <span>{props.label}</span>
      <select
        disabled={props.disabled}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      >
        {!props.options.includes("") ? (
          <option value="">
            {props.label === "Provider" ? "Select provider" : props.label === "Model" ? "Select model" : "inherit"}
          </option>
        ) : null}
        {props.options.map((option) => (
          <option key={option || "inherit"} value={option}>
            {props.labels?.[option] ?? option ?? "inherit"}
          </option>
        ))}
      </select>
    </label>
  );
}

function scopeToDraft(values: UiSettingsState["scopes"][UiSettingsScope]["values"]): SettingsDraft {
  return {
    agentA: parseTargetDraft(values.modelA),
    agentB: parseTargetDraft(values.modelB),
    thinkingA: values.thinkingA ?? "",
    thinkingB: values.thinkingB ?? "",
    mcpEnabled:
      values.mcpEnabled === undefined ? "" : values.mcpEnabled ? "true" : "false"
  };
}

function parseTargetDraft(value: string | undefined): AgentTargetDraft {
  if (!value) {
    return {
      providerId: "",
      modelId: ""
    };
  }
  const [providerId, ...rest] = value.split("/");
  return {
    providerId: providerId ?? "",
    modelId: rest.join("/")
  };
}

function draftToOverrides(draft: SettingsDraft): UiSettingsOverrides {
  return {
    modelA:
      draft.agentA.providerId && draft.agentA.modelId
        ? `${draft.agentA.providerId}/${draft.agentA.modelId}`
        : null,
    modelB:
      draft.agentB.providerId && draft.agentB.modelId
        ? `${draft.agentB.providerId}/${draft.agentB.modelId}`
        : null,
    thinkingA: draft.thinkingA || null,
    thinkingB: draft.thinkingB || null,
    mcpEnabled:
      draft.mcpEnabled === ""
        ? null
        : draft.mcpEnabled === "true"
          ? true
          : false
  };
}

function providerReachabilityTone(provider: UiSettingsProviderState): "neutral" | "warning" | "danger" | "success" {
  if (provider.verify.status === "passed") {
    return "success";
  }
  if (provider.verify.status === "failed") {
    return "danger";
  }
  if (provider.discovery.reachable || provider.discovery.running) {
    return "success";
  }
  if (provider.discovery.installed) {
    return "warning";
  }
  return "neutral";
}

function providerSortRank(providerId: string): number {
  const primaryIndex = PRIMARY_PROVIDER_ORDER.indexOf(
    providerId as (typeof PRIMARY_PROVIDER_ORDER)[number]
  );
  return primaryIndex >= 0 ? primaryIndex : PRIMARY_PROVIDER_ORDER.length + 1;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function formatProviderOperationLabel(
  operation: NonNullable<UiSettingsState["providerOperation"]>
): string {
  switch (operation.kind) {
    case "refresh":
      return "Refreshing provider availability and model catalogs.";
    case "connect_oauth":
      return `Connecting ${operation.provider}.`;
    case "save_api_key":
      return `Saving ${operation.provider} authentication.`;
    case "save_custom_provider":
      return "Saving the custom provider.";
    case "verify_target":
      return `Verifying ${operation.provider}.`;
  }
}
