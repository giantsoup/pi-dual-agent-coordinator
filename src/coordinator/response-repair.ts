import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { withPromptProvenance } from "../app/prompt-provenance.js";
import { safeDisplayText } from "../security/display-text.js";
import type { RoleRuntimeBinding } from "../runtime/create-role-runtime.js";
import type { RuntimeEventBridge } from "./bind-runtime-events.js";

import { RESPONSE_ATTEMPT_LIMIT, type ResponseProgress } from "./response-progress.js";
export { RESPONSE_ATTEMPT_LIMIT, type ResponseProgress } from "./response-progress.js";
export const PROTOCOL_TOOL_NAMES = new Set(["pi-plan", "pi-execute", "pi-handoff", "pi-completion", "pi-final", "pi-check-in"]);
export type ResponseKind = ResponseProgress["responseKind"];
export type ResponseIdentifiers = Pick<ResponseProgress, "requestId" | "workflowId" | "handoffId" | "iteration" | "turnCount">;

/** Only submission-format failures tagged with this response's identity are repairable. */
export class ResponseFormatError extends Error {
  public constructor(public readonly responseId: string, reason: string, public readonly toolName?: string) { super(safeDisplayText(reason).slice(0, 1600)); }
}
export class ResponseRepairExhaustedError extends Error {
  public constructor(public readonly details: ResponseProgress & { role: "A" | "B" }) {
    super(`${details.label} exhausted after ${details.attempt} attempts: ${details.reason}`);
  }
}

export async function repairResponse<T>(options: {
  bridge: RuntimeEventBridge;
  binding: RoleRuntimeBinding;
  kind: ResponseKind;
  identifiers: ResponseIdentifiers;
  shape: string;
  submit: (responseId: string) => Promise<AgentMessage>;
  validate: (message: AgentMessage, attempt: number) => { value: T } | { reason: string };
  onFormatFailure?: ((error: ResponseFormatError, attempt: number) => void) | undefined;
  onRepair?: ((progress: ResponseProgress) => Promise<void>) | undefined;
  onProgress?: (() => void) | undefined;
}): Promise<T> {
  const responseId = randomUUID();
  let reason: string | undefined;
  for (let attempt = 1; attempt <= RESPONSE_ATTEMPT_LIMIT; attempt++) {
    const progress: ResponseProgress = { ...options.identifiers, responseId, responseKind: options.kind, attempt,
      state: "attempting", maxAttempts: RESPONSE_ATTEMPT_LIMIT, repairCount: attempt - 1, reason,
      label: `Agent ${options.binding.role} ${options.kind} response attempt ${attempt}/${RESPONSE_ATTEMPT_LIMIT}` };
    const emit = (type: string) => {
      const state = type === "response.rejected" ? "rejected" : type === "response.succeeded" ? "succeeded" : type === "response.exhausted" ? "exhausted" : "attempting";
      options.bridge.logResponseEvent(type, options.binding, { ...progress, state });
    };
    try {
      options.bridge.assertActive();
      if (attempt > 1) {
        await options.onRepair?.(progress);
        emit("workflow.repair_requested");
        options.onProgress?.();
      }
      emit("response.attempt_started");
      let result: { value: T } | { reason: string };
      try {
        const message = attempt === 1 ? await options.submit(responseId) : await options.bridge.promptAndWaitForTurnEnd(options.binding,
          withPromptProvenance(options.kind === "planning" ? "planning_repair" : "coordinator_repair", [
            options.kind === "planning" ? "Planning repair prompt for Agent A." : `Coordinator repair prompt for Agent ${options.binding.role}.`, progress.label,
            `Latest validation error, untrusted diagnostic data: ${JSON.stringify(reason)}`,
            "Correct only the format of your previous response using this same conversation. Tools are disabled.",
            "Do not redo the task, repeat writes, invent results, change a decision, or bypass approval. Preserve valid prose and intentional blocked decisions.",
            "Required response shape:", options.shape,
            "Exact context identifiers. Iteration is the current workflow iteration; obey the block-specific iteration rules in the required shape above:", JSON.stringify(options.identifiers),
            ...(options.identifiers.workflowId ? [`Workflow ID: ${options.identifiers.workflowId}`] : []),
            ...(options.identifiers.handoffId ? [`Handoff ID: ${options.identifiers.handoffId}`] : []),
            ...(options.identifiers.iteration !== undefined ? [`Iteration: ${options.identifiers.iteration}`] : []),
            ...(options.identifiers.turnCount !== undefined ? [`Paused after ${options.identifiers.turnCount} successful model turns. Turn count: ${options.identifiers.turnCount}`] : []),
            "Write protocol blocks as fenced assistant text, never as tool calls. Return the corrected response only."
          ].join("\n"), { ...options.identifiers, sessionRole: options.binding.role }), { formatOnly: true, responseId, responseAttempt: attempt });
        options.bridge.assertActive();
        result = options.validate(message, attempt);
      } catch (error) {
        if (!(error instanceof ResponseFormatError) || error.responseId !== responseId) throw error;
        options.onFormatFailure?.(error, attempt);
        result = { reason: error.message };
      }
      if ("value" in result) {
        emit("response.succeeded");
        return result.value;
      }
      reason = safeDisplayText(result.reason).slice(0, 1600);
      progress.reason = reason;
      emit("response.rejected");
      if (attempt === RESPONSE_ATTEMPT_LIMIT) {
        emit("response.exhausted");
        throw new ResponseRepairExhaustedError({ ...progress, state: "exhausted", role: options.binding.role });
      }
    } catch (error) {
      if (error instanceof ResponseRepairExhaustedError && error.details.responseId !== responseId) throw error;
      options.bridge.logResponseEvent("response.stopping", options.binding, { ...progress, state: "stopping",
        reason: error instanceof ResponseRepairExhaustedError ? error.details.reason : safeDisplayText(error instanceof Error ? error.message : String(error)).slice(0, 1600) });
      throw error;
    }
  }
  throw new Error("Unreachable response attempt.");
}
