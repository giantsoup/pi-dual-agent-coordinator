import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SettingsProviderService,
  augmentSettingsWithProviderCatalog,
  intersectOpenAiCatalog
} from "../../src/app/settings-provider-service.js";
import type { UiSettingsState } from "../../src/types/ui.js";

const ORIGINAL_OPENAI_API_KEY = process.env.OPENAI_API_KEY;

afterEach(() => {
  vi.restoreAllMocks();
  if (ORIGINAL_OPENAI_API_KEY === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = ORIGINAL_OPENAI_API_KEY;
  }
});

describe("settings provider service", () => {
  it("intersects the live OpenAI model list with Pi's built-in OpenAI catalog", async () => {
    delete process.env.OPENAI_API_KEY;
    const root = mkdtempSync(join(tmpdir(), "pi-dual-provider-service-"));
    const service = new SettingsProviderService({
      agentDir: root,
      fetch: vi.fn(async (url) => {
        if (url === "https://api.openai.com/v1/models") {
          return jsonResponse({
            data: [
              { id: "gpt-5.4" },
              { id: "gpt-4o" },
              { id: "not-in-pi" }
            ]
          });
        }
        throw new Error(`Unexpected URL ${String(url)}`);
      }),
      pathHasExecutable: async () => false
    });

    await service.saveOpenAiApiKey({
      mode: "paste-now",
      value: "sk-test-123"
    });
    const catalog = await service.getCatalog({
      force: true
    });

    expect(intersectOpenAiCatalog([{ id: "gpt-5.4" }, { id: "gpt-4o" }], [
      "gpt-5.4",
      "not-in-pi"
    ])).toEqual(["gpt-5.4"]);
    expect((catalog.catalogByProvider.openai ?? []).map((model) => model.id)).toEqual([
      "gpt-4o",
      "gpt-5.4"
    ]);
    expect(catalog.providers.find((provider) => provider.id === "openai")?.auth.source).toBe(
      "stored-key"
    );
  });

  it("materializes the managed LM Studio provider into models.json on save", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-provider-service-"));
    const service = new SettingsProviderService({
      agentDir: root,
      fetch: vi.fn(async (url) => {
        if (url === "http://127.0.0.1:1234/api/v1/models") {
          return jsonResponse({
            models: [
              {
                key: "qwen3-coder-next",
                display_name: "Qwen3 Coder Next",
                max_context_length: 262144
              }
            ]
          });
        }
        throw new Error(`Unexpected URL ${String(url)}`);
      }),
      pathHasExecutable: async (name) => name === "lms"
    });

    await service.ensureManagedProviderForModelRef("managed-lm-studio/qwen3-coder-next");

    const modelsFile = JSON.parse(readFileSync(join(root, "models.json"), "utf8")) as {
      providers?: Record<string, any>;
    };
    expect(modelsFile.providers?.["managed-lm-studio"]).toMatchObject({
      baseUrl: "http://127.0.0.1:1234/v1",
      api: "openai-completions",
      apiKey: "lm-studio"
    });
    expect(
      modelsFile.providers?.["managed-lm-studio"]?.models?.[0]
    ).toMatchObject({
      id: "qwen3-coder-next",
      name: "Qwen3 Coder Next",
      contextWindow: 262144,
      maxTokens: 16384
    });
  });

  it("materializes the managed Ollama provider and enriches the selected model", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-provider-service-"));
    const service = new SettingsProviderService({
      agentDir: root,
      fetch: vi.fn(async (url, init) => {
        if (url === "http://127.0.0.1:11434/api/tags") {
          return jsonResponse({
            models: [
              {
                model: "qwen2.5-coder:7b",
                name: "Qwen 2.5 Coder 7B"
              }
            ]
          });
        }
        if (url === "http://127.0.0.1:11434/api/show") {
          expect(init?.method).toBe("POST");
          return jsonResponse({
            details: {
              context_length: 65536
            }
          });
        }
        throw new Error(`Unexpected URL ${String(url)}`);
      }),
      pathHasExecutable: async (name) => name === "ollama"
    });

    await service.ensureManagedProviderForModelRef("managed-ollama/qwen2.5-coder:7b");

    const modelsFile = JSON.parse(readFileSync(join(root, "models.json"), "utf8")) as {
      providers?: Record<string, any>;
    };
    expect(modelsFile.providers?.["managed-ollama"]).toMatchObject({
      baseUrl: "http://127.0.0.1:11434/v1",
      api: "openai-completions",
      apiKey: "ollama"
    });
    expect(modelsFile.providers?.["managed-ollama"]?.models?.[0]).toMatchObject({
      id: "qwen2.5-coder:7b",
      contextWindow: 65536,
      maxTokens: 4096
    });
  });

  it("maps verification success and failure with timestamps", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-provider-service-"));
    const service = new SettingsProviderService({
      agentDir: root,
      fetch: vi.fn(async (url) => {
        if (url === "http://127.0.0.1:1234/api/v1/models") {
          return jsonResponse({
            models: [
              {
                key: "qwen3-coder-next",
                display_name: "Qwen3 Coder Next",
                max_context_length: 262144
              }
            ]
          });
        }
        throw new Error(`Unexpected URL ${String(url)}`);
      }),
      now: () => new Date("2026-04-23T12:34:56.000Z"),
      pathHasExecutable: async (name) => name === "lms"
    });

    const passed = await service.verifyTarget({
      provider: "managed-lm-studio",
      modelId: "qwen3-coder-next"
    });
    const failed = await service.verifyTarget({
      provider: "managed-lm-studio",
      modelId: "missing-model"
    });

    expect(
      passed.providers.find((provider) => provider.id === "managed-lm-studio")?.verify
    ).toMatchObject({
      status: "passed",
      target: "managed-lm-studio/qwen3-coder-next",
      checkedAt: "2026-04-23T12:34:56.000Z"
    });
    expect(
      failed.providers.find((provider) => provider.id === "managed-lm-studio")?.verify
    ).toMatchObject({
      status: "failed",
      target: "managed-lm-studio/missing-model",
      checkedAt: "2026-04-23T12:34:56.000Z"
    });
  });

  it("keeps unavailable saved model refs visible instead of clearing them", () => {
    const settings = createSettingsState();
    const augmented = augmentSettingsWithProviderCatalog(settings, {
      providers: [],
      catalogByProvider: {},
      lastDiscoveryAt: "2026-04-23T12:00:00.000Z"
    });

    expect(augmented.providers[0]).toMatchObject({
      id: "managed-ollama",
      label: "managed-ollama (Unavailable)"
    });
    expect(augmented.catalogByProvider["managed-ollama"]?.[0]).toMatchObject({
      id: "qwen-local",
      available: false,
      canonicalRef: "managed-ollama/qwen-local"
    });
  });

  it("preserves verification failures for unavailable saved providers", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-provider-service-"));
    const service = new SettingsProviderService({
      agentDir: root,
      fetch: vi.fn(async () => {
        throw new Error("Unexpected network call");
      }),
      now: () => new Date("2026-04-23T13:00:00.000Z"),
      pathHasExecutable: async () => false
    });

    const catalog = await service.verifyTarget({
      provider: "managed-custom-deadbeef",
      modelId: "missing-model"
    });

    expect(
      catalog.providers.find((provider) => provider.id === "managed-custom-deadbeef")
    ).toMatchObject({
      label: "managed-custom-deadbeef (Unavailable)",
      verify: {
        status: "failed",
        target: "managed-custom-deadbeef/missing-model",
        checkedAt: "2026-04-23T13:00:00.000Z"
      }
    });
    expect(catalog.catalogByProvider["managed-custom-deadbeef"]?.[0]).toMatchObject({
      id: "missing-model",
      available: false
    });
  });
});

function createSettingsState(): UiSettingsState {
  return {
    activeScope: "project",
    effective: {
      values: {
        modelA: "managed-ollama/qwen-local"
      },
      sources: {
        modelA: "project",
        modelB: "legacy",
        thinkingA: "legacy",
        thinkingB: "legacy",
        mcpEnabled: "legacy"
      }
    },
    scopes: {
      global: {
        scope: "global",
        label: "Global defaults",
        available: true,
        hasOverrides: false,
        values: {}
      },
      project: {
        scope: "project",
        label: "Project overrides",
        available: true,
        hasOverrides: true,
        values: {
          modelA: "managed-ollama/qwen-local"
        }
      },
      thread: {
        scope: "thread",
        label: "Thread overrides",
        available: false,
        hasOverrides: false,
        values: {}
      }
    },
    providers: [],
    catalogByProvider: {}
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}
