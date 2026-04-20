import { describe, expect, it } from "vitest";

import { openBrowser, runAuthWizard, runSetupWizard } from "../../src/app/setup.js";
import type { CoordinatorConfigV1 } from "../../src/app/coordinator-config.js";

class FakeAuthStorage {
  public readonly entries: Record<string, unknown>;
  private readonly errors: Error[] = [];

  public constructor(entries: Record<string, unknown> = {}) {
    this.entries = { ...entries };
  }

  public set(provider: string, credential: unknown): void {
    this.entries[provider] = credential;
  }

  public async login(
    provider: string,
    callbacks: {
      onAuth(info: { url: string }): void;
      onProgress?(message: string): void;
    }
  ): Promise<void> {
    callbacks.onAuth({ url: "https://example.com/auth" });
    callbacks.onProgress?.("Waiting for browser login");
    this.entries[provider] = {
      type: "oauth",
      access: "token",
      refresh: "refresh",
      expires: Date.now() + 60_000,
      accountId: "acct_123"
    };
  }

  public drainErrors(): Error[] {
    return this.errors.splice(0);
  }
}

function createPromptRuntime(responses: string[]) {
  let index = 0;
  return {
    promptChoice: async () => responses[index++] ?? "",
    promptText: async () => responses[index++] ?? "",
    promptSecret: async () => responses[index++] ?? "",
    promptCancellableText: () => ({
      promise: Promise.resolve(""),
      cancel() {}
    }),
    close() {}
  };
}

describe("setup wizard", () => {
  it("writes the API-key preset and preserves unrelated auth entries", async () => {
    const authStorage = new FakeAuthStorage({
      anthropic: {
        type: "api_key",
        key: "ANTHROPIC_API_KEY"
      }
    });
    let writtenConfig: CoordinatorConfigV1 | undefined;

    await expect(
      runSetupWizard(
        {
          command: "setup",
          cwd: "/tmp/project"
        },
        {
          createAuthStorage: () => authStorage as never,
          createPrompts: () => createPromptRuntime([
            "openai-api-key",
            "paste-now",
            "sk-test-123"
          ]),
          loadConfig: async () => ({
            path: "/tmp/config.json",
            exists: false,
            warnings: []
          }),
          writeConfig: async (config) => {
            writtenConfig = config;
          },
          stdout: { write: (_chunk: string) => true }
        }
      )
    ).resolves.toBe(0);

    expect(authStorage.entries.anthropic).toEqual({
      type: "api_key",
      key: "ANTHROPIC_API_KEY"
    });
    expect(authStorage.entries.openai).toEqual({
      type: "api_key",
      key: "sk-test-123"
    });
    expect(writtenConfig?.defaults.modelA).toBe("openai/gpt-5.4");
    expect(writtenConfig?.onboarding?.lastSelectedAgentAAuthFlow).toBe("openai-api-key");
  });

  it("writes the subscription preset after a mocked OAuth login", async () => {
    const authStorage = new FakeAuthStorage();
    let writtenConfig: CoordinatorConfigV1 | undefined;

    await expect(
      runSetupWizard(
        {
          command: "setup",
          cwd: "/tmp/project"
        },
        {
          createAuthStorage: () => authStorage as never,
          createPrompts: () => createPromptRuntime(["openai-chatgpt-subscription"]),
          loadConfig: async () => ({
            path: "/tmp/config.json",
            exists: false,
            warnings: []
          }),
          writeConfig: async (config) => {
            writtenConfig = config;
          },
          browserOpener: async () => true,
          stdout: { write: (_chunk: string) => true },
          stderr: { write: (_chunk: string) => true }
        }
      )
    ).resolves.toBe(0);

    expect(authStorage.entries["openai-codex"]).toBeTruthy();
    expect(writtenConfig?.defaults.modelA).toBe("openai-codex/gpt-5.4");
  });

  it("lets auth switch the saved default after a previous setup", async () => {
    const authStorage = new FakeAuthStorage();
    let writtenConfig: CoordinatorConfigV1 | undefined;

    await expect(
      runAuthWizard(
        {
          command: "auth",
          cwd: "/tmp/project"
        },
        {
          createAuthStorage: () => authStorage as never,
          createPrompts: () => createPromptRuntime([
            "openai-chatgpt-subscription"
          ]),
          loadConfig: async () => ({
            path: "/tmp/config.json",
            exists: true,
            warnings: [],
            config: {
              version: 1,
              defaults: {
                modelA: "openai/gpt-5.4"
              },
              onboarding: {
                lastSelectedAgentAAuthFlow: "openai-api-key"
              }
            }
          }),
          writeConfig: async (config) => {
            writtenConfig = config;
          },
          browserOpener: async () => true,
          stdout: { write: (_chunk: string) => true },
          stderr: { write: (_chunk: string) => true }
        }
      )
    ).resolves.toBe(0);

    expect(writtenConfig?.defaults.modelA).toBe("openai-codex/gpt-5.4");
    expect(writtenConfig?.onboarding?.lastSelectedAgentAAuthFlow).toBe(
      "openai-chatgpt-subscription"
    );
  });

  it("falls back cleanly when opening the browser fails", async () => {
    const opened = await openBrowser("https://example.com", {
      spawnImpl: (() => {
        throw new Error("spawn failed");
      }) as never
    });

    expect(opened).toBe(false);
  });
});
