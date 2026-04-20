import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import {
  AuthStorage,
  getAgentDir
} from "@mariozechner/pi-coding-agent";
import type { OAuthLoginCallbacks, OAuthPrompt } from "@mariozechner/pi-ai";

import type { AuthCliOptions, SetupCliOptions } from "./cli.js";
import {
  getCoordinatorConfigPath,
  loadCoordinatorConfig,
  writeCoordinatorConfig,
  type CoordinatorConfigV1
} from "./coordinator-config.js";

type AgentAAuthFlow = "openai-chatgpt-subscription" | "openai-api-key";
type ApiKeyStorageMethod = "paste-now" | "openai-api-key-env" | "custom-env";

interface WizardDependencies {
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
  browserOpener?: typeof openBrowser;
  createAuthStorage?: (authPath: string) => AuthStorage;
  loadConfig?: typeof loadCoordinatorConfig;
  writeConfig?: typeof writeCoordinatorConfig;
  createPrompts?: (output: Pick<NodeJS.WriteStream, "write">) => PromptRuntime;
}

interface PromptRuntime {
  promptChoice(
    message: string,
    choices: Array<{ value: string; label: string; detail?: string }>
  ): Promise<string>;
  promptText(message: string, options?: { allowEmpty?: boolean }): Promise<string>;
  promptSecret(message: string): Promise<string>;
  promptCancellableText(message: string): { promise: Promise<string>; cancel(): void };
  close(): void;
}

export async function runSetupWizard(
  options: SetupCliOptions,
  dependencies: WizardDependencies = {}
): Promise<number> {
  return runWizard(options, true, dependencies);
}

export async function runAuthWizard(
  options: AuthCliOptions,
  dependencies: WizardDependencies = {}
): Promise<number> {
  return runWizard(options, false, dependencies);
}

export async function openBrowser(
  url: string,
  options: {
    platform?: NodeJS.Platform;
    spawnImpl?: typeof spawn;
  } = {}
): Promise<boolean> {
  const platform = options.platform ?? process.platform;
  const spawnImpl = options.spawnImpl ?? spawn;
  const command = getBrowserCommand(platform, url);
  if (!command) {
    return false;
  }

  try {
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const child = spawnImpl(command.command, command.args, {
        detached: platform !== "win32",
        stdio: "ignore",
        windowsHide: true
      });

      const settle = (value: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(value);
      };

      child.once("spawn", () => settle(true));
      child.once("error", () => settle(false));
      child.unref();
    });
  } catch {
    return false;
  }
}

export function renderNextSteps(): string {
  return "Next: run `pi-dual doctor .`, then `pi-dual repl .`.";
}

async function runWizard(
  options: SetupCliOptions | AuthCliOptions,
  includeIntro: boolean,
  dependencies: WizardDependencies
): Promise<number> {
  const output = dependencies.stdout ?? process.stdout;
  const errorOutput = dependencies.stderr ?? process.stderr;
  const prompts = dependencies.createPrompts?.(output) ?? createPromptRuntime(output);
  const agentDir = options.agentDir ?? getAgentDir();
  const authPath = `${agentDir}/auth.json`;
  const configPath = getCoordinatorConfigPath();
  const authStorage = (dependencies.createAuthStorage ?? AuthStorage.create)(authPath);
  const loadConfig = dependencies.loadConfig ?? loadCoordinatorConfig;
  const persistConfig = dependencies.writeConfig ?? writeCoordinatorConfig;

  try {
    const loadedConfig = await loadConfig(configPath);
    if (loadedConfig.warnings.length > 0) {
      for (const warning of loadedConfig.warnings) {
        output.write(`Warning: ${warning}\n`);
      }
      output.write("\n");
    }

    if (includeIntro) {
      output.write("This setup can configure Agent A with either ChatGPT subscription login or an OpenAI API key.\n");
      output.write(`Credentials are stored in Pi's standard agent directory: ${agentDir}\n`);
      output.write(
        `The wizard will also save a coordinator default in ${configPath} so future \`pi-dual repl\` runs pick the right Agent A model automatically.\n\n`
      );
    }

    const flow = await prompts.promptChoice("How should Agent A connect?", [
      {
        value: "openai-chatgpt-subscription",
        label: "ChatGPT Plus/Pro subscription",
        detail: "Uses browser sign-in and saves Pi OAuth credentials for openai-codex."
      },
      {
        value: "openai-api-key",
        label: "OpenAI API key",
        detail: "Stores or references an API key under the openai provider in Pi auth.json."
      }
    ]) as AgentAAuthFlow;

    if (flow === "openai-chatgpt-subscription") {
      await runSubscriptionFlow({
        output,
        errorOutput,
        prompts,
        authStorage,
        browserOpener: dependencies.browserOpener ?? openBrowser,
        persistConfig,
        existingConfig: loadedConfig.config
      });
      return 0;
    }

    await runApiKeyFlow({
      output,
      prompts,
      authStorage,
      persistConfig,
      existingConfig: loadedConfig.config
    });
    return 0;
  } finally {
    prompts.close();
  }
}

async function runSubscriptionFlow(options: {
  output: Pick<NodeJS.WriteStream, "write">;
  errorOutput: Pick<NodeJS.WriteStream, "write">;
  prompts: PromptRuntime;
  authStorage: AuthStorage;
  browserOpener: typeof openBrowser;
  persistConfig: typeof writeCoordinatorConfig;
  existingConfig: CoordinatorConfigV1 | undefined;
}): Promise<void> {
  options.output.write("A browser window should open next.\n");
  options.output.write("Sign into ChatGPT in that browser session.\n");
  options.output.write("This terminal will wait for the login to complete.\n");
  options.output.write("If the browser callback fails, you can paste the redirect URL or authorization code back here.\n\n");

  const manualPrompt = options.prompts.promptCancellableText(
    "Manual fallback: paste the redirect URL or authorization code if the browser callback does not complete:"
  );

  const callbacks: OAuthLoginCallbacks = {
    onAuth: (info) => {
      options.output.write(`Open this URL in your browser: ${info.url}\n`);
      options.output.write("If the browser did not open automatically, open the printed URL manually.\n");
      void options.browserOpener(info.url).then((opened) => {
        if (!opened) {
          options.errorOutput.write("Browser launch did not succeed automatically. Continue with the printed URL.\n");
        }
      });
    },
    onProgress: (message) => {
      options.output.write(`Progress: ${message}\n`);
    },
    onPrompt: (prompt) => promptForOAuthFallback(options.prompts, prompt),
    onManualCodeInput: () => manualPrompt.promise
  };

  try {
    await options.authStorage.login("openai-codex", callbacks);
    manualPrompt.cancel();
  } catch (error) {
    manualPrompt.cancel();
    throw buildSubscriptionFailure(error, options.authStorage.drainErrors());
  }

  const authErrors = options.authStorage.drainErrors();
  if (authErrors.length > 0) {
    throw buildSubscriptionFailure(authErrors[0], authErrors.slice(1));
  }

  await persistCoordinatorDefaults(
    options.persistConfig,
    options.existingConfig,
    {
      modelA: "openai-codex/gpt-5.4",
      onboarding: {
        lastSelectedAgentAAuthFlow: "openai-chatgpt-subscription",
        lastCompletedAt: new Date().toISOString()
      }
    }
  );

  options.output.write("\nYou are signed in with ChatGPT subscription.\n");
  options.output.write(
    "Future `pi-dual repl` runs will default Agent A to `openai-codex/gpt-5.4` unless you override `--model-a`.\n"
  );
  options.output.write(`${renderNextSteps()}\n`);
}

async function runApiKeyFlow(options: {
  output: Pick<NodeJS.WriteStream, "write">;
  prompts: PromptRuntime;
  authStorage: AuthStorage;
  persistConfig: typeof writeCoordinatorConfig;
  existingConfig: CoordinatorConfigV1 | undefined;
}): Promise<void> {
  options.output.write("Recommended: paste the key now and store it in Pi's auth.json.\n");
  options.output.write("Advanced: store `OPENAI_API_KEY` in your shell and reference that env var.\n");
  options.output.write("Advanced: use a custom environment variable name.\n\n");

  const method = await options.prompts.promptChoice("How should the OpenAI API key be stored?", [
    {
      value: "paste-now",
      label: "Paste key now",
      detail: "Stores the literal key in Pi auth.json."
    },
    {
      value: "openai-api-key-env",
      label: "Use OPENAI_API_KEY",
      detail: "Stores an env var reference in Pi auth.json."
    },
    {
      value: "custom-env",
      label: "Use custom env var",
      detail: "Stores your chosen env var name in Pi auth.json."
    }
  ]) as ApiKeyStorageMethod;

  let keyValue: string;
  if (method === "paste-now") {
    keyValue = (await options.prompts.promptSecret("Paste your OpenAI API key:")).trim();
    if (!keyValue) {
      throw new Error("OpenAI API key input was empty. No credentials were saved.");
    }

    if (!looksLikeOpenAiKey(keyValue)) {
      options.output.write(
        "Warning: that input does not resemble a typical OpenAI key, but you can still keep it if this is intentional.\n"
      );
      const confirm = await options.prompts.promptChoice("Store this value anyway?", [
        {
          value: "yes",
          label: "Yes",
          detail: "Keep the exact value you pasted."
        },
        {
          value: "no",
          label: "No",
          detail: "Abort without writing credentials."
        }
      ]);
      if (confirm !== "yes") {
        throw new Error("OpenAI API key entry was cancelled. No credentials were saved.");
      }
    }
  } else if (method === "openai-api-key-env") {
    keyValue = "OPENAI_API_KEY";
  } else {
    keyValue = (await options.prompts.promptText("Enter the environment variable name to reference:")).trim();
    if (!keyValue) {
      throw new Error("Environment variable name was empty. No credentials were saved.");
    }
  }

  options.authStorage.set("openai", {
    type: "api_key",
    key: keyValue
  });

  const authErrors = options.authStorage.drainErrors();
  const authError = authErrors[0];
  if (authError) {
    throw buildApiKeyFailure(authError, method, keyValue);
  }

  await persistCoordinatorDefaults(
    options.persistConfig,
    options.existingConfig,
    {
      modelA: "openai/gpt-5.4",
      onboarding: {
        lastSelectedAgentAAuthFlow: "openai-api-key",
        lastCompletedAt: new Date().toISOString()
      }
    }
  );

  options.output.write("\nOpenAI API key is configured.\n");
  options.output.write(
    "Future `pi-dual repl` runs will default Agent A to `openai/gpt-5.4` unless you override `--model-a`.\n"
  );
  if (method === "openai-api-key-env" || method === "custom-env") {
    options.output.write(
      `If the environment variable is missing in a future shell, \`pi-dual doctor\` will tell you exactly which variable to set.\n`
    );
  }
  options.output.write(`${renderNextSteps()}\n`);
}

async function persistCoordinatorDefaults(
  persistConfig: typeof writeCoordinatorConfig,
  existingConfig: CoordinatorConfigV1 | undefined,
  update: {
    modelA: string;
    onboarding: NonNullable<CoordinatorConfigV1["onboarding"]>;
  }
): Promise<void> {
  await persistConfig({
    version: 1,
    defaults: {
      ...(existingConfig?.defaults ?? {}),
      modelA: update.modelA
    },
    onboarding: {
      ...(existingConfig?.onboarding ?? {}),
      ...update.onboarding
    }
  });
}

async function promptForOAuthFallback(
  prompts: PromptRuntime,
  prompt: OAuthPrompt
): Promise<string> {
  return prompts.promptText(prompt.message, { allowEmpty: prompt.allowEmpty ?? false });
}

function buildSubscriptionFailure(error: unknown, authErrors: Error[]): Error {
  const cause = error instanceof Error ? error : new Error(String(error));
  const detail = describeSubscriptionFailure(cause);
  const lines = [
    detail.summary,
    detail.recovery,
    `Credentials saved: ${detail.credentialsSaved ? "yes" : "no"}.`
  ];
  const authError = authErrors[0];
  if (authError) {
    lines.push(`Additional auth storage error: ${authError.message}`);
  }
  return new Error(lines.join("\n"));
}

function buildApiKeyFailure(
  error: Error,
  method: ApiKeyStorageMethod,
  keyValue: string
): Error {
  const storageLabel =
    method === "paste-now"
      ? "the pasted key"
      : method === "openai-api-key-env"
        ? "`OPENAI_API_KEY`"
        : `the custom env var reference \`${keyValue}\``;
  return new Error(
    `Failed to save ${storageLabel} into Pi auth.json.\nNo credentials were saved.\nRecovery: rerun \`pi-dual setup\` or \`pi-dual auth\` and try again.\nDetail: ${error.message}`
  );
}

function describeSubscriptionFailure(error: Error): {
  summary: string;
  credentialsSaved: boolean;
  recovery: string;
} {
  const message = error.message.toLowerCase();
  if (message.includes("aborted") || message.includes("cancel")) {
    return {
      summary: "ChatGPT subscription sign-in was cancelled.",
      credentialsSaved: false,
      recovery: "Recovery: rerun `pi-dual setup` or `pi-dual auth` when you are ready to try the browser login again."
    };
  }
  if (message.includes("token exchange failed")) {
    return {
      summary: "ChatGPT sign-in reached OpenAI but token exchange failed.",
      credentialsSaved: false,
      recovery: "Recovery: rerun `pi-dual auth` and complete the browser flow again. If the callback page fails, paste the redirect URL or code into the terminal."
    };
  }
  if (message.includes("state mismatch") || message.includes("missing authorization code")) {
    return {
      summary: "The OAuth callback completed with invalid data.",
      credentialsSaved: false,
      recovery: "Recovery: rerun `pi-dual auth`. If the browser callback keeps failing, use the manual paste fallback in the terminal."
    };
  }
  if (message.includes("accountid")) {
    return {
      summary: "ChatGPT sign-in finished but the returned token could not be validated.",
      credentialsSaved: false,
      recovery: "Recovery: rerun `pi-dual auth`. If it happens again, sign out in the browser and retry the ChatGPT login flow."
    };
  }
  if (message.includes("eacces") || message.includes("eperm") || message.includes("auth storage")) {
    return {
      summary: "ChatGPT sign-in finished, but Pi could not persist the OAuth credential.",
      credentialsSaved: false,
      recovery: "Recovery: fix local file permissions for Pi's agent directory, then rerun `pi-dual auth`."
    };
  }
  return {
    summary: `ChatGPT subscription sign-in failed: ${error.message}`,
    credentialsSaved: false,
    recovery: "Recovery: rerun `pi-dual setup` or `pi-dual auth`. The browser login can be retried without editing auth.json by hand."
  };
}

function looksLikeOpenAiKey(value: string): boolean {
  return /^sk-(proj-|live-|test-)?[A-Za-z0-9_\-]+$/u.test(value);
}

function createPromptRuntime(
  output: Pick<NodeJS.WriteStream, "write">
): PromptRuntime {
  return new ReadlinePromptRuntime(output);
}

class ReadlinePromptRuntime implements PromptRuntime {
  private readonly rl = createInterface({
    input: stdin,
    output: stdout
  });

  public constructor(private readonly output: Pick<NodeJS.WriteStream, "write">) {}

  public async promptChoice(
    message: string,
    choices: Array<{ value: string; label: string; detail?: string }>
  ): Promise<string> {
    this.output.write(`${message}\n`);
    for (let index = 0; index < choices.length; index += 1) {
      const choice = choices[index];
      if (!choice) {
        continue;
      }
      this.output.write(`  ${index + 1}. ${choice.label}\n`);
      if (choice.detail) {
        this.output.write(`     ${choice.detail}\n`);
      }
    }

    while (true) {
      const answer = (await this.promptText("Select an option by number:")).trim();
      const selectedIndex = Number.parseInt(answer, 10) - 1;
      const selected = choices[selectedIndex];
      if (selected) {
        return selected.value;
      }
      this.output.write(`Invalid selection: ${answer}\n`);
    }
  }

  public async promptText(
    message: string,
    options: { allowEmpty?: boolean } = {}
  ): Promise<string> {
    while (true) {
      const answer = await this.rl.question(`${message} `);
      const trimmed = answer.trim();
      if (trimmed || options.allowEmpty) {
        return trimmed;
      }
      this.output.write("Input cannot be empty.\n");
    }
  }

  public async promptSecret(message: string): Promise<string> {
    if (!stdin.isTTY || !stdout.isTTY || !stdin.setRawMode) {
      return this.promptText(message);
    }

    this.output.write(`${message} `);
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();

    return new Promise<string>((resolve, reject) => {
      let value = "";

      const cleanup = () => {
        stdin.off("data", onData);
        stdin.setRawMode(wasRaw ?? false);
        stdin.pause();
      };

      const onData = (chunk: string | Buffer) => {
        const text = chunk.toString("utf8");
        if (text === "\u0003") {
          cleanup();
          this.output.write("\n");
          reject(new Error("Secret entry cancelled."));
          return;
        }
        if (text === "\r" || text === "\n") {
          cleanup();
          this.output.write("\n");
          if (!value.trim()) {
            reject(new Error("OpenAI API key input was empty. No credentials were saved."));
            return;
          }
          resolve(value.trim());
          return;
        }
        if (text === "\u007f" || text === "\b") {
          value = value.slice(0, -1);
          return;
        }
        if (text.startsWith("\u001b")) {
          return;
        }
        value += text;
      };

      stdin.on("data", onData);
    });
  }

  public promptCancellableText(message: string): {
    promise: Promise<string>;
    cancel(): void;
  } {
    const controller = new AbortController();
    return {
      promise: this.rl
        .question(`${message} `, { signal: controller.signal })
        .then((answer) => answer.trim()),
      cancel: () => controller.abort()
    };
  }

  public close(): void {
    this.rl.close();
  }
}

function getBrowserCommand(
  platform: NodeJS.Platform,
  url: string
): { command: string; args: string[] } | undefined {
  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }
  if (platform === "win32") {
    return {
      command: "cmd",
      args: ["/c", "start", "", url]
    };
  }
  if (platform === "linux") {
    return { command: "xdg-open", args: [url] };
  }
  return undefined;
}
