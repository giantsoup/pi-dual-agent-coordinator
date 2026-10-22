import { createHash } from "node:crypto";
import { z } from "zod";
import { ContextManagementError, textPayloadAllowance } from "../runtime/context-budget.js";

const countPayload = z.object({
  model: z.string(), input: z.array(z.json()), instructions: z.string().optional(), tools: z.array(z.json()).optional(),
  reasoning: z.json().optional(), text: z.json().optional(), tool_choice: z.json().optional(), parallel_tool_calls: z.boolean().optional(),
  personality: z.string().optional(), truncation: z.literal("disabled").optional(),
  conversation: z.never().optional(), previous_response_id: z.never().optional(), url: z.never().optional(), headers: z.never().optional(), base_url: z.never().optional()
});
const countResult = z.object({ object: z.literal("response.input_tokens"), input_tokens: z.number().int().nonnegative().safe() });

/** A-only, tools-free counting with the same serialized input as inference. */
export class OpenAiTokenCounter {
  private readonly cache = new Map<string, number>();
  private readonly controllers = new Set<AbortController>();
  private readonly pending = new Set<Promise<number>>();
  private closed = false;
  public constructor(private readonly modelIds: readonly string[], private readonly request: (body: string, signal: AbortSignal) => Promise<Response>) {}

  public count(payload: unknown, signal?: AbortSignal): Promise<number> {
    if (this.closed) return Promise.reject(new ContextManagementError("OpenAI token counter is closed."));
    const controller = new AbortController();
    this.controllers.add(controller);
    const cancellation = AbortSignal.any([controller.signal, AbortSignal.timeout(15000), ...(signal ? [signal] : [])]);
    const work = this.run(payload, cancellation).finally(() => { this.controllers.delete(controller); this.pending.delete(work); });
    this.pending.add(work);
    return work;
  }

  private async run(payload: unknown, signal: AbortSignal): Promise<number> {
    try {
      signal.throwIfAborted();
      textPayloadAllowance(payload); // Keep direct images outside the supported replay policy.
      const parsed = countPayload.parse(JSON.parse(JSON.stringify(payload)));
      if (!this.modelIds.includes(parsed.model)) throw new Error("Unapproved counting model");
      const body = JSON.stringify(parsed);
      if (Buffer.byteLength(body) > 4 * 1024 * 1024) throw new Error("Counting request too large");
      const hash = createHash("sha256").update(body).digest("hex");
      const cached = this.cache.get(hash);
      if (cached !== undefined) return cached;
      const response = await this.request(body, signal);
      if (!response.ok || response.redirected || !response.body) { await response.body?.cancel(); throw new Error("Counting request rejected"); }
      const reader = response.body.getReader();
      let text = ""; let bytes = 0;
      const decoder = new TextDecoder();
      try {
        while (true) {
          signal.throwIfAborted();
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 8192) throw new Error("Counting response too large");
          text += decoder.decode(part.value, { stream: true });
        }
        text += decoder.decode();
      } finally { await reader.cancel(); reader.releaseLock(); }
      signal.throwIfAborted();
      const { input_tokens: tokens } = countResult.parse(JSON.parse(text));
      this.cache.set(hash, tokens);
      if (this.cache.size > 4) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      return tokens;
    } catch {
      signal.throwIfAborted();
      throw new ContextManagementError("OpenAI input token counting unavailable or rejected. Execution stopped before inference; no compaction or automatic retry was attempted.");
    }
  }

  public async close(): Promise<void> {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
    await Promise.allSettled([...this.pending]);
    this.cache.clear();
  }
}
