import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { z } from "zod";

const usageSchema = z.object({
  input: z.number(), output: z.number(), cacheRead: z.number(), cacheWrite: z.number(), totalTokens: z.number(),
  cacheWrite1h: z.number().optional(), reasoning: z.number().optional(),
  cost: z.object({ input: z.number(), output: z.number(), cacheRead: z.number(), cacheWrite: z.number(), total: z.number() })
});
const resultSchema = z.object({
  content: z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("text"), text: z.string(), textSignature: z.string().optional() }),
    z.object({ type: z.literal("image"), data: z.string(), mimeType: z.string() })
  ])),
  details: z.unknown().optional(), structuredContent: z.json().optional(), usage: usageSchema.optional(),
  isError: z.boolean().optional(), terminate: z.boolean().optional()
});

/** Worker JSON is untrusted even when the tool definition came from Pi. */
export function parseToolResult(value: unknown): AgentToolResult<unknown> {
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid isolated tool result.");
  const data = parsed.data;
  const result: AgentToolResult<unknown> = {
    content: data.content.map(item => item.type === "image" ? item : {
      type: "text", text: item.text, ...(item.textSignature === undefined ? {} : { textSignature: item.textSignature })
    }),
    details: data.details
  };
  if (data.structuredContent !== undefined) result.structuredContent = data.structuredContent;
  if (data.isError !== undefined) result.isError = data.isError;
  if (data.terminate !== undefined) result.terminate = data.terminate;
  if (data.usage) {
    const { cacheWrite1h, reasoning, ...usage } = data.usage;
    result.usage = { ...usage, ...(cacheWrite1h === undefined ? {} : { cacheWrite1h }), ...(reasoning === undefined ? {} : { reasoning }) };
  }
  return result;
}
