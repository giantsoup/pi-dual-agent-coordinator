import { z } from "zod";
import { LM_STUDIO_BASE_URL } from "./models.js";

const modelList = z.object({ models: z.array(z.object({
  loaded_instances: z.array(z.object({ id: z.string(), config: z.object({ context_length: z.number().int().positive() }) })).default([])
})) });

export async function assertLmStudioModelReady(model: { id: string; contextWindow: number }): Promise<void> {
  try {
    const response = await fetch(`${new URL(LM_STUDIO_BASE_URL).origin}/api/v1/models`, { redirect: "error", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Model list unavailable.");
    const body = modelList.parse(await response.json());
    if (!body.models.some((item) => item.loaded_instances.some((instance) => instance.id === model.id && instance.config.context_length >= model.contextWindow))) throw new Error("Selected model or context unavailable.");
  } catch {
    throw new Error(`LM Studio unavailable or model ${model.id} not loaded with enough context. Start its server on 127.0.0.1:1234 and load this model with identifier ${model.id} and context length ${model.contextWindow}. No cloud fallback.`);
  }
}
