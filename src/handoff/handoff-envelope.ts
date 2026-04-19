import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

import {
  completionRecordSchema,
  finalDecisionSchema,
  handoffEnvelopeSchema
} from "./handoff-envelope-schema.js";
import type {
  CompletionRecord,
  FinalDecisionRecord,
  HandoffEnvelope
} from "../types/handoff.js";

export const HANDOFF_BLOCK_TYPE = "pi-handoff";
export const COMPLETION_BLOCK_TYPE = "pi-completion";
export const FINAL_BLOCK_TYPE = "pi-final";

export function extractAssistantText(message: AgentMessage): string {
  if (!isAssistantMessage(message)) {
    return "";
  }

  return message.content
    .filter((item): item is TextContent => item.type === "text")
    .map((item) => item.text)
    .join("");
}

export function extractMachineBlock(text: string, type: string): string | undefined {
  const pattern = new RegExp(`\`\`\`${type}\\s*([\\s\\S]*?)\`\`\``, "m");
  return pattern.exec(text)?.[1]?.trim();
}

export function parseHandoffEnvelope(message: AgentMessage): HandoffEnvelope | undefined {
  const block = extractMachineBlock(extractAssistantText(message), HANDOFF_BLOCK_TYPE);
  if (!block) {
    return undefined;
  }
  return handoffEnvelopeSchema.parse(JSON.parse(block));
}

export function parseCompletionRecord(message: AgentMessage): CompletionRecord | undefined {
  const block = extractMachineBlock(extractAssistantText(message), COMPLETION_BLOCK_TYPE);
  if (!block) {
    return undefined;
  }
  return completionRecordSchema.parse(JSON.parse(block));
}

export function parseFinalDecisionRecord(message: AgentMessage): FinalDecisionRecord | undefined {
  const block = extractMachineBlock(extractAssistantText(message), FINAL_BLOCK_TYPE);
  if (!block) {
    return undefined;
  }
  return finalDecisionSchema.parse(JSON.parse(block));
}

export function maybeParseHandoffEnvelope(message: AgentMessage): HandoffEnvelope | undefined {
  try {
    return parseHandoffEnvelope(message);
  } catch {
    return undefined;
  }
}

export function maybeParseCompletionRecord(message: AgentMessage): CompletionRecord | undefined {
  try {
    return parseCompletionRecord(message);
  } catch {
    return undefined;
  }
}

export function maybeParseFinalDecisionRecord(message: AgentMessage): FinalDecisionRecord | undefined {
  try {
    return parseFinalDecisionRecord(message);
  } catch {
    return undefined;
  }
}

export function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "role" in message &&
    message.role === "assistant" &&
    "content" in message
  );
}
