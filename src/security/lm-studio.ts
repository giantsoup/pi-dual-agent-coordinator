import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { Model } from "@mariozechner/pi-ai";
import type { ModelSwitchProgress } from "../types/model-selection.js";
import { safeDisplayText } from "./display-text.js";
import { createLocalModel, LM_STUDIO_BASE_URL } from "./models.js";

const origin = new URL(LM_STUDIO_BASE_URL).origin;
const instanceSchema = z.object({ id: z.string().min(1).max(512), config: z.object({ context_length: z.number().int().positive() }) });
const inventorySchema = z.object({ models: z.array(z.unknown()).max(500) });
const localSchema = z.object({
  type: z.literal("llm"), key: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._/@:+-]{0,255}$/), display_name: z.string().min(1).max(256),
  max_context_length: z.number().int().positive(), loaded_instances: z.array(instanceSchema).max(50),
  size_bytes: z.number().nonnegative().optional(), quantization: z.object({ name: z.string().nullable() }).nullish(),
  capabilities: z.object({ vision: z.boolean().optional(), trained_for_tool_use: z.boolean().optional() }).optional()
});

export interface LocalModelInfo {
  model: Model<"openai-completions">;
  loaded: boolean;
  description: string;
  disabledReason?: string | undefined;
}
type InventoryEntry = LocalModelInfo & { instances: z.infer<typeof instanceSchema>[] };
export interface PreparedLocalModel {
  model: Model<"openai-completions">;
  commit(): void;
  rollback(): Promise<void>;
}
export interface LocalModelHost {
  listModels(signal?: AbortSignal): Promise<LocalModelInfo[]>;
  prepare(target: string, previous: string | undefined, signal: AbortSignal, report: (progress: ModelSwitchProgress) => void): Promise<PreparedLocalModel>;
}
export class LocalModelSwitchError extends Error {
  public constructor(message: string, public readonly cancelled: boolean, public readonly recovery: "unchanged" | "restored" | "unavailable") { super(message); }
}
class UncertainMutationError extends Error {}

/** Trusted application client. Management is never added to agent tools or the inference broker. */
export class LmStudioModels implements LocalModelHost {
  private readonly request: typeof fetch;
  private readonly timeoutMs: number;
  private readonly pollMs: number;
  public constructor(options: { request?: typeof fetch; timeoutMs?: number; pollMs?: number } = {}) {
    this.request = options.request ?? fetch; this.timeoutMs = options.timeoutMs ?? 180_000; this.pollMs = options.pollMs ?? 250;
  }

  private async call(path: "models" | "models/load" | "models/unload", body?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(body ? this.timeoutMs : 5000);
    let response: Response;
    try { response = await this.request(`${origin}/api/v1/${path}`, {
      method: body ? "POST" : "GET", redirect: "error", signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})
    }); } catch (error) {
      if (body) throw new UncertainMutationError("LM Studio stopped responding before the model operation finished.");
      throw error;
    }
    if (!response.ok || response.redirected) {
      await response.body?.cancel();
      throw new Error(`LM Studio ${path === "models" ? "inventory" : path === "models/load" ? "load" : "unload"} failed (${response.status}).`);
    }
    const text = await response.text();
    if (text.length > 2 * 1024 * 1024) throw new Error("LM Studio response exceeded the metadata limit.");
    return text.trim() ? JSON.parse(text) : {};
  }

  private async inventory(signal?: AbortSignal): Promise<InventoryEntry[]> {
    const { models } = inventorySchema.parse(await this.call("models", undefined, signal));
    return models.flatMap((value) => {
      if (!value || typeof value !== "object" || !("type" in value) || value.type !== "llm") return [];
      const item = localSchema.parse(value);
      const disabledReason = item.capabilities?.trained_for_tool_use !== true ? "Tool calling is unavailable for this model."
        : item.max_context_length < 65_536 ? "Requires support for at least 65,536 context tokens." : undefined;
      const model = createLocalModel({ id: item.key, name: safeDisplayText(item.display_name), vision: item.capabilities?.vision ?? false });
      return [{ model, loaded: item.loaded_instances.some((instance) => instance.config.context_length >= model.contextWindow),
        instances: item.loaded_instances, disabledReason,
        description: [item.quantization?.name, item.size_bytes ? `${(item.size_bytes / 1024 ** 3).toFixed(1)} GB` : undefined].filter(Boolean).join(" / ") }];
    });
  }

  public async listModels(signal?: AbortSignal): Promise<LocalModelInfo[]> {
    return (await this.inventory(signal)).map(({ instances: _instances, ...model }) => model);
  }

  private async waitReady(key: string, signal: AbortSignal): Promise<void> {
    return this.waitFor((models) => models.find((item) => item.model.id === key)?.loaded === true, signal);
  }
  private async waitFor(test: (models: InventoryEntry[]) => boolean, signal: AbortSignal): Promise<void> {
    while (true) {
      signal.throwIfAborted();
      if (test(await this.inventory(signal))) return;
      await delay(this.pollMs, undefined, { signal });
    }
  }

  public async prepare(target: string, previous: string | undefined, signal: AbortSignal, report: (progress: ModelSwitchProgress) => void): Promise<PreparedLocalModel> {
    report({ phase: "checking", message: "Checking downloaded models in LM Studio…" });
    const before = await this.inventory(signal);
    const wanted = before.find((item) => item.model.id === target);
    if (!wanted) throw new Error("This model is no longer downloaded in LM Studio. Refresh the model list.");
    if (wanted.disabledReason) throw new Error(wanted.disabledReason);
    const prior = before.find((item) => item.model.id === previous);
    const originalTargetIds = new Set(wanted.instances.map((instance) => instance.id));
    let changed = false;
    let committed = false;
    let pendingMutation: { kind: "load"; key: string } | { kind: "unload"; id: string } | undefined;
    const unload = async (id: string) => {
      pendingMutation = { kind: "unload", id };
      await this.call("models/unload", { instance_id: id });
      pendingMutation = undefined;
    };
    let rollbackPromise: Promise<void> | undefined;
    const rollback = (): Promise<void> => {
      if (!changed || committed) return Promise.resolve();
      return rollbackPromise ??= (async () => {
        report({ phase: "restoring", message: prior ? `Restoring ${prior.model.name}…` : "Cleaning up the cancelled model load…" });
        const recovery = AbortSignal.timeout(this.timeoutMs);
        const current = await this.inventory(recovery);
        for (const instance of current.find((item) => item.model.id === target)?.instances ?? []) {
          if (!originalTargetIds.has(instance.id) || target === previous) await this.call("models/unload", { instance_id: instance.id }, recovery);
        }
        if (previous) {
          if (!prior) throw new Error("The previous model is no longer downloaded.");
          if (!(await this.inventory(recovery)).find((item) => item.model.id === previous)?.loaded) {
            await this.call("models/load", { model: previous, context_length: prior.model.contextWindow, echo_load_config: true }, recovery);
          }
          await this.waitReady(previous, recovery);
        }
      })();
    };
    try {
      signal.throwIfAborted();
      if (previous && previous !== target) {
        const old = prior?.instances.find((instance) => instance.config.context_length >= 65_536) ?? prior?.instances[0];
        if (old) {
          report({ phase: "unloading", message: `Unloading ${prior?.model.name ?? previous}…` });
          changed = true;
          await unload(old.id);
        }
      }
      signal.throwIfAborted();
      if (!wanted.loaded) {
        for (const instance of wanted.instances) {
          changed = true;
          await unload(instance.id);
        }
        signal.throwIfAborted();
        report({ phase: "loading", message: `Loading ${wanted.model.name}…` });
        changed = true;
        // HTTP cancellation does not cancel a server-side load. Settle, then compensate.
        pendingMutation = { kind: "load", key: target };
        await this.call("models/load", { model: target, context_length: wanted.model.contextWindow, echo_load_config: true });
        pendingMutation = undefined;
      }
      signal.throwIfAborted();
      report({ phase: "verifying", message: "Waiting for the model's 65,536-token context to be ready…" });
      await this.waitReady(target, AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]));
      return { model: wanted.model, commit: () => { committed = true; }, rollback };
    } catch (error) {
      let recovery: LocalModelSwitchError["recovery"] = changed ? "restored" : "unchanged";
      try {
        if (error instanceof UncertainMutationError && pendingMutation) {
          report({ phase: "restoring", message: "LM Studio stopped responding. Waiting for the pending model operation before restoring…" });
          const pending = pendingMutation;
          await this.waitFor((models) => pending.kind === "load" ? models.find((item) => item.model.id === pending.key)?.loaded === true
            : !models.some((model) => model.instances.some((instance) => instance.id === pending.id)), AbortSignal.timeout(this.timeoutMs));
        }
        await rollback();
      } catch { recovery = "unavailable"; }
      const reason = signal.aborted ? "Model switch cancelled." : safeDisplayText(error instanceof Error ? error.message : "Model switch failed.");
      throw new LocalModelSwitchError(`${reason} ${recovery === "unavailable" ? "The previous model could not be restored. Choose a model again before continuing." : changed ? "Previous model state restored." : "Current model unchanged."}`, signal.aborted, recovery);
    }
  }
}

export async function assertLmStudioModelReady(model: { id: string; contextWindow: number }): Promise<string> {
  try {
    const response = await fetch(`${origin}/api/v1/models`, { redirect: "error", signal: AbortSignal.timeout(5000) });
    if (!response.ok || response.redirected) throw new Error("Model list unavailable.");
    const body = z.object({ models: z.array(z.object({ key: z.string().optional(), loaded_instances: z.array(instanceSchema).default([]) })) }).parse(await response.json());
    const instance = body.models.flatMap((item) => item.loaded_instances.filter((instance) =>
      (item.key === model.id || item.key === undefined && instance.id === model.id) && instance.config.context_length >= model.contextWindow))[0];
    if (!instance) throw new Error("Selected model or context unavailable.");
    return instance.id;
  } catch {
    throw new Error(`LM Studio unavailable or model ${model.id} not loaded with enough context. Start its server on 127.0.0.1:1234 and load this model with identifier ${model.id} and context length ${model.contextWindow}. No cloud fallback.`);
  }
}
