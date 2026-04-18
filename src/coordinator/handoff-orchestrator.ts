import { completeHandoffRecord } from "./complete-handoff.js";
import { isDuplicateRecord } from "./duplicate-suppression.js";
import { maybeParseCompletionRecord, maybeParseHandoffEnvelope } from "../handoff/handoff-envelope.js";
import { applyTransition } from "./handoff-state-machine.js";
import { deliverHandoff } from "./deliver-handoff.js";
import { prepareHandoffRecord } from "./prepare-handoff.js";
import { SessionLedger } from "../persistence/session-ledger.js";
import type { HandoffEnvelope, HandoffRecord, HandoffState } from "../types/handoff.js";
import type { RoleRuntimeBinding } from "../runtime/create-role-runtime.js";

export class HandoffOrchestrator {
  public constructor(private readonly ledger: SessionLedger) {}

  public async handleAgentATurnEnd(options: {
    bindingA: RoleRuntimeBinding;
    bindingB: RoleRuntimeBinding;
    message: Parameters<typeof maybeParseHandoffEnvelope>[0];
    requestId?: string | undefined;
    state: HandoffState;
    onStateChange?: ((state: HandoffState, record: HandoffRecord) => Promise<void> | void) | undefined;
  }): Promise<{ state: HandoffState; prepared?: HandoffRecord; delivered?: HandoffRecord }> {
    const envelope = maybeParseHandoffEnvelope(options.message);
    if (!envelope || !validateEnvelope(envelope)) {
      return { state: options.state };
    }

    const prepared = prepareHandoffRecord({
      envelope,
      requestId: options.requestId,
      binding: options.bindingA
    });

    if (isDuplicateRecord(options.state, prepared)) {
      return { state: options.state };
    }

    await this.ledger.append(prepared);
    let state = applyTransition(options.state, prepared);
    await options.onStateChange?.(state, prepared);
    const { delivered, promptPromise } = await deliverHandoff({
      prepared,
      binding: options.bindingB
    });
    await this.ledger.append(delivered);
    state = applyTransition(state, delivered);
    await options.onStateChange?.(state, delivered);
    await promptPromise;

    return { state, prepared, delivered };
  }

  public async handleAgentBTurnEnd(options: {
    binding: RoleRuntimeBinding;
    message: Parameters<typeof maybeParseCompletionRecord>[0];
    requestId?: string | undefined;
    state: HandoffState;
  }): Promise<{ state: HandoffState; completed?: HandoffRecord }> {
    const completion = maybeParseCompletionRecord(options.message);
    if (!completion) {
      return { state: options.state };
    }

    const completed = completeHandoffRecord({
      completion,
      requestId: options.requestId,
      binding: options.binding
    });
    if (isDuplicateRecord(options.state, completed)) {
      return { state: options.state };
    }

    await this.ledger.append(completed);
    return {
      state: applyTransition(options.state, completed),
      completed
    };
  }

  public async latestLedgerRecords(): Promise<HandoffRecord[]> {
    return this.ledger.loadAll();
  }
}

function validateEnvelope(envelope: HandoffEnvelope): boolean {
  return (
    envelope.objective.trim().length > 0 &&
    envelope.acceptanceCriteria.length > 0 &&
    envelope.relevantPaths.length > 0
  );
}
