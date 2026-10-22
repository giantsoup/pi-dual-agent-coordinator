import { textPayloadAllowance } from "../runtime/context-budget.js";

// Conservative fixture counts keep boundary tests independent of live credentials.
export const fixtureTokenCountRequest: typeof fetch = async (_url, init) => {
  if (typeof init?.body !== "string") throw new Error("Expected a serialized fixture counting request");
  return Response.json({ object: "response.input_tokens", input_tokens: textPayloadAllowance(JSON.parse(init.body)) });
};

// Deterministic Responses SSE used by isolation verification. Never selected by config.
export function fixtureResponse(text: string): Response {
  const item = { type: "message", id: "msg_fixture", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] };
  const events = [
    { type: "response.created", response: { id: "resp_fixture" } },
    { type: "response.output_item.added", output_index: 0, item: { ...item, content: [] } },
    { type: "response.content_part.added", output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } },
    { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: text },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: { id: "resp_fixture", status: "completed", usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 } } }
  ];
  return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
}

export function fixtureChatResponse(text: string): Response {
  return fixtureChatChunks([{ content: text }, {}], "stop");
}

export function fixtureChatToolResponse(name: string, args: unknown, callId = "call_fixture", text?: string): Response {
  return fixtureChatChunks([{ ...(text ? { content: text } : {}), tool_calls: [{ index: 0, id: callId, type: "function", function: { name, arguments: JSON.stringify(args) } }] }, {}], "tool_calls");
}

function fixtureChatChunks(deltas: unknown[], finishReason: string): Response {
  const chunks = deltas.map((delta, index) => ({
    id: "chat_fixture", object: "chat.completion.chunk", created: 1,
    choices: [{ index: 0, delta, finish_reason: index === deltas.length - 1 ? finishReason : null }],
    ...(index === deltas.length - 1 ? { usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } } : {})
  }));
  return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
}

export function fixtureToolResponse(name: string, args: unknown): Response {
  const item = { type: "function_call", id: "fc_fixture", call_id: "call_fixture", name, arguments: JSON.stringify(args) };
  const events = [
    { type: "response.created", response: { id: "resp_fixture" } },
    { type: "response.output_item.added", output_index: 0, item: { ...item, arguments: "" } },
    { type: "response.function_call_arguments.delta", output_index: 0, delta: item.arguments },
    { type: "response.function_call_arguments.done", output_index: 0, arguments: item.arguments },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: { id: "resp_fixture", status: "completed", usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 } } }
  ];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
}
