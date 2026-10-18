import {
  COMPLETION_BLOCK_TYPE,
  FINAL_BLOCK_TYPE,
  HANDOFF_BLOCK_TYPE,
  extractAssistantText,
  maybeParseCompletionRecord,
  maybeParseFinalDecisionRecord,
  maybeParseHandoffEnvelope
} from "../handoff/handoff-envelope.js";
import type { CompletionRecord, FinalDecisionRecord, HandoffEnvelope } from "../types/handoff.js";

export type AgentAResponse =
  | { kind: "handoff"; envelope: HandoffEnvelope }
  | { kind: "final"; finalDecision: FinalDecisionRecord }
  | { kind: "invalid"; reason: string };

export type AgentBResponse =
  | { kind: "completion"; completion: CompletionRecord }
  | { kind: "invalid"; reason: string };

export function resolveAgentAResponse(options: {
  message: Parameters<typeof maybeParseHandoffEnvelope>[0];
  workflowId: string;
  requestId?: string;
  allowedHandoffIterations: number[];
  allowedFinalIterations: number[];
}): AgentAResponse {
  const failure = validateMachineResponse(options.message);
  if (failure) return { kind: "invalid", reason: failure };
  const text = extractAssistantText(options.message);
  const counts = {
    handoff: countBlocks(text, HANDOFF_BLOCK_TYPE),
    final: countBlocks(text, FINAL_BLOCK_TYPE)
  };

  if (counts.handoff + counts.final !== 1) {
    return {
      kind: "invalid",
      reason: "missing or multiple machine blocks; expected exactly one `pi-handoff` or `pi-final` block"
    };
  }

  if (counts.handoff === 1) {
    const envelope = maybeParseHandoffEnvelope(options.message);
    if (!envelope) {
      return {
        kind: "invalid",
        reason: "invalid `pi-handoff` block"
      };
    }
    if (envelope.workflowId !== options.workflowId) {
      return {
        kind: "invalid",
        reason: `unexpected workflowId ${envelope.workflowId}`
      };
    }
    if (!options.allowedHandoffIterations.includes(envelope.iteration)) {
      return {
        kind: "invalid",
        reason: `unexpected handoff iteration ${envelope.iteration}`
      };
    }
    if (envelope.requestId && options.requestId && envelope.requestId !== options.requestId) return { kind: "invalid", reason: "Unexpected handoff requestId." };
    return { kind: "handoff", envelope };
  }

  const finalDecision = maybeParseFinalDecisionRecord(options.message);
  if (!finalDecision) {
    return {
      kind: "invalid",
      reason: "invalid `pi-final` block"
    };
  }
  if (finalDecision.workflowId !== options.workflowId) {
    return {
      kind: "invalid",
      reason: `unexpected workflowId ${finalDecision.workflowId}`
    };
  }
  if (!options.allowedFinalIterations.includes(finalDecision.iteration)) {
    return {
      kind: "invalid",
      reason: `unexpected final iteration ${finalDecision.iteration}`
    };
  }
  if (finalDecision.requestId && options.requestId && finalDecision.requestId !== options.requestId) return { kind: "invalid", reason: "Unexpected final requestId." };
  return { kind: "final", finalDecision };
}

export function resolveAgentBResponse(options: {
  message: Parameters<typeof maybeParseCompletionRecord>[0];
  workflowId: string;
  requestId?: string;
  handoffId: string;
  iteration: number;
}): AgentBResponse {
  const failure = validateMachineResponse(options.message);
  if (failure) return { kind: "invalid", reason: failure };
  const text = extractAssistantText(options.message);
  const count = countBlocks(text, COMPLETION_BLOCK_TYPE);
  if (count !== 1) {
    return {
      kind: "invalid",
      reason: "missing or multiple machine blocks; expected exactly one `pi-completion` block"
    };
  }

  const completion = maybeParseCompletionRecord(options.message);
  if (!completion) {
    return {
      kind: "invalid",
      reason: "invalid `pi-completion` block"
    };
  }
  if (completion.workflowId !== options.workflowId) {
    return {
      kind: "invalid",
      reason: `unexpected workflowId ${completion.workflowId}`
    };
  }
  if (completion.handoffId !== options.handoffId) {
    return {
      kind: "invalid",
      reason: `unexpected handoffId ${completion.handoffId}`
    };
  }
  if (completion.iteration !== options.iteration) {
    return {
      kind: "invalid",
      reason: `unexpected iteration ${completion.iteration}`
    };
  }

  if (completion.requestId && options.requestId && completion.requestId !== options.requestId) return { kind: "invalid", reason: "Unexpected completion requestId." };
  return { kind: "completion", completion };
}

function countBlocks(text: string, type: string): number {
  return [...text.matchAll(new RegExp("```" + type + "\\b", "g"))].length;
}

function validateMachineResponse(message: Parameters<typeof extractAssistantText>[0]): string | undefined {
  if (message.role === "assistant" && message.stopReason === "length") return "Truncated response.";
  const text = extractAssistantText(message);
  if ([...text.matchAll(/```pi-[a-z0-9-]+\b/g)].length !== 1) return "Expected exactly one machine block; missing, incorrect, or duplicate blocks.";
  return undefined;
}
