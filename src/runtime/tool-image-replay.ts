import type { AgentMessage } from "@earendil-works/pi-agent-core";

export const TOOL_IMAGE_NOTICE = "Image evidence retained in the session archive; omitted from this model request because image token accounting is unavailable. Do not claim visual verification. Use browser snapshot and console for text evidence.";

/** Project tool evidence for text accounting without changing archived results. */
export function textToolImageReplay(messages: AgentMessage[]): AgentMessage[] {
  return messages.map(message => message.role === "toolResult" ? {
    ...message,
    content: message.content.map(part => part.type === "image" ? { type: "text", text: TOOL_IMAGE_NOTICE } : part)
  } : message);
}
