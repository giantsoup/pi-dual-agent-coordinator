import { LMStudioClient, type ChatMessageData, type LLMTool } from "@lmstudio/sdk";
import { z } from "zod";
import type { PayloadCounter } from "../runtime/context-budget.js";
import { ContextManagementError } from "../runtime/context-budget.js";

const toolSchema = z.object({ type: z.literal("function"), function: z.object({ name: z.string(), description: z.string().optional(),
  parameters: z.object({ type: z.literal("object"), properties: z.record(z.string(), z.json()), required: z.array(z.string()).optional(), additionalProperties: z.json().optional(), $defs: z.record(z.string(), z.json()).optional() }).optional() }) });
const messageSchema = z.object({ role: z.enum(["system", "user", "assistant", "tool"]), content: z.union([z.string(), z.array(z.object({ type: z.literal("text"), text: z.string() }))]).nullable().optional(),
  tool_call_id: z.string().optional(), name: z.string().optional(),
  tool_calls: z.array(z.object({ id: z.string(), type: z.literal("function"), function: z.object({ name: z.string(), arguments: z.string() }) })).optional(),
  reasoning_content: z.string().optional() });
const requestSchema = z.object({ messages: z.array(messageSchema), tools: z.array(toolSchema).optional() });

export function localTokenCounter(resolveInstance: () => Promise<string>): PayloadCounter {
  return async (payload, signal) => {
    const parsed = requestSchema.safeParse(payload);
    if (!parsed.success) throw new ContextManagementError("LM Studio context accounting does not support this message or image format. Execution stopped before inference.");
    const messages: ChatMessageData[] = parsed.data.messages.map((message) => {
      if (message.reasoning_content) throw new ContextManagementError("Replay reasoning requires unsupported context accounting.");
      if (message.role === "tool" && Array.isArray(message.content)) throw new ContextManagementError("Tool result arrays require unsupported context accounting.");
      if (message.role === "tool") return { role: "tool", content: [{ type: "toolCallResult", content: typeof message.content === "string" ? message.content : "", ...(message.tool_call_id ? { toolCallId: message.tool_call_id } : {}), ...(message.name ? { name: message.name } : {}) }] };
      const content = typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content ?? [];
      if (message.role === "assistant") return { role: "assistant", content: [...content, ...(message.tool_calls ?? []).map((call) => ({ type: "toolCallRequest" as const,
        toolCallRequest: { type: "function" as const, id: call.id, name: call.function.name, arguments: z.record(z.string(), z.json()).parse(JSON.parse(call.function.arguments)) } }))] };
      return { role: message.role, content };
    });
    const tools: LLMTool[] = (parsed.data.tools ?? []).map((tool) => ({ type: tool.type, function: { name: tool.function.name,
      ...(tool.function.description === undefined ? {} : { description: tool.function.description }),
      ...(tool.function.parameters === undefined ? {} : { parameters: { type: "object", properties: tool.function.parameters.properties,
        ...(tool.function.parameters.required === undefined ? {} : { required: tool.function.parameters.required }),
        ...(tool.function.parameters.additionalProperties === undefined ? {} : { additionalProperties: tool.function.parameters.additionalProperties }),
        ...(tool.function.parameters.$defs === undefined ? {} : { $defs: tool.function.parameters.$defs }) } }) } }));
    const instanceId = await resolveInstance();
    const client = new LMStudioClient({ baseUrl: "ws://127.0.0.1:1234", logger: { debug() {}, info() {}, warn() {}, error() {} } });
    const abort = () => { void client[Symbol.asyncDispose]().catch(() => undefined); };
    const timeout = AbortSignal.timeout(15_000);
    const cancellation = signal ? AbortSignal.any([signal, timeout]) : timeout;
    cancellation.addEventListener("abort", abort, { once: true });
    try {
      cancellation.throwIfAborted();
      const model = client.llm.createDynamicHandle({ identifier: instanceId });
      const formatted = await model.applyPromptTemplate({ messages }, { toolDefinitions: tools });
      const tokens = await model.countTokens(formatted);
      const contextWindow = await model.getContextLength();
      cancellation.throwIfAborted();
      if (await resolveInstance() !== instanceId) throw new ContextManagementError("LM Studio instance changed during context accounting; retry explicitly.");
      return { tokens, contextWindow, method: "lm-studio-template-tokenizer", instanceId };
    } catch {
      cancellation.throwIfAborted();
      throw new ContextManagementError("LM Studio tokenizer unavailable or unsupported. Execution stopped before inference.");
    } finally { cancellation.removeEventListener("abort", abort); await client[Symbol.asyncDispose](); }
  };
}

/** Keep private reasoning in the archive, outside the local model's replay context. */
export function localReplayPayload(payload: unknown) {
  const parsed = z.looseObject({ messages: z.array(z.record(z.string(), z.json())) }).parse(JSON.parse(JSON.stringify(payload)));
  return { ...parsed, messages: parsed.messages.map((message) => {
    const retained = { ...message };
    for (const field of ["reasoning_content", "reasoning", "reasoning_text", "reasoning_details"]) delete retained[field];
    return retained;
  }) };
}
