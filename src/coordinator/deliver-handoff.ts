import { withPromptProvenance } from "../app/prompt-provenance.js";
import { renderHandoffMessage } from "../handoff/render-handoff-message.js";
import type { HandoffRecord } from "../types/handoff.js";
import type { RoleRuntimeBinding } from "../runtime/create-role-runtime.js";
import type { RuntimeEventBridge } from "./bind-runtime-events.js";

export async function deliverHandoff(options: {
  prepared: HandoffRecord;
  binding: RoleRuntimeBinding;
  bridge: RuntimeEventBridge;
}): Promise<{
  delivered: HandoffRecord;
  message: Awaited<ReturnType<RuntimeEventBridge["promptAndWaitForTurnEnd"]>>;
}> {
  if (!options.prepared.envelope || !options.prepared.handoffId) {
    throw new Error("Cannot deliver a handoff without an envelope");
  }

  let settlePreflight: ((success: boolean) => void) | undefined;
  let rejectPreflight: ((error: Error) => void) | undefined;
  const preflightPromise = new Promise<boolean>((resolve, reject) => {
    settlePreflight = resolve;
    rejectPreflight = reject;
  });
  const timeoutId = setTimeout(() => {
    rejectPreflight?.(
      new Error(`Delivery preflight timed out for ${options.prepared.handoffId}`)
    );
  }, 5_000);

  const messagePromise = options.bridge
    .promptAndWaitForTurnEnd(
      options.binding,
      withPromptProvenance(
        "coordinator_handoff",
        renderHandoffMessage(options.prepared.envelope),
        {
          requestId: options.prepared.requestId,
          workflowId: options.prepared.workflowId,
          handoffId: options.prepared.handoffId,
          iteration: options.prepared.iteration,
          sessionRole: options.binding.role
        }
      ),
      {
        preflightResult: (success) => {
          clearTimeout(timeoutId);
          settlePreflight?.(success);
        }
      }
    )
    .catch((error: unknown) => {
      clearTimeout(timeoutId);
      rejectPreflight?.(
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    });

  const accepted = await preflightPromise;
  if (!accepted) {
    throw new Error(`Delivery preflight rejected for ${options.prepared.handoffId}`);
  }

  return {
    delivered: {
      ...options.prepared,
      status: "delivered",
      role: "B",
      sessionId: options.binding.sessionId,
      sessionFile: options.binding.sessionFile,
      timestamp: new Date().toISOString()
    },
    message: await messagePromise
  };
}
