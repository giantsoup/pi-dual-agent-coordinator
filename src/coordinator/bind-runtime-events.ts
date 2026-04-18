import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

import type { HandoffOrchestrator } from "./handoff-orchestrator.js";
import { normalizeEvent, normalizeLifecycleEvent } from "../telemetry/event-normalizer.js";
import type { Role } from "../types/role.js";
import { CorrelationState } from "../telemetry/correlation.js";
import { TelemetryLogger } from "../telemetry/logger.js";
import { Metrics } from "../telemetry/metrics.js";
import type { RoleRuntimeBinding } from "../runtime/create-role-runtime.js";
import type { HandoffState } from "../types/handoff.js";

export interface RuntimeEventBridgeCallbacks {
  getRequestId(role: Role): string | undefined;
  getHandoffState(): HandoffState;
  setHandoffState(state: HandoffState): void;
  onPrepared?(summary: string): void;
  onCompleted?(summary: string): void;
}

export class RuntimeEventBridge {
  private readonly subscriptions = new Map<Role, () => void>();
  private readonly correlation = new CorrelationState();
  private readonly pending = new Set<Promise<void>>();
  private lastError: Error | undefined;

  public constructor(
    private readonly logger: TelemetryLogger,
    private readonly metrics: Metrics,
    private readonly orchestrator: HandoffOrchestrator,
    private readonly callbacks: RuntimeEventBridgeCallbacks
  ) {}

  public async bind(
    binding: RoleRuntimeBinding,
    otherBindingProvider: (role: Role) => RoleRuntimeBinding | undefined
  ): Promise<void> {
    this.subscriptions.get(binding.role)?.();
    await binding.rebind();

    this.logger.log(
      normalizeLifecycleEvent({
        role: binding.role,
        sessionId: binding.sessionId,
        sessionFile: binding.sessionFile,
        eventType: "coordinator.runtime_bound"
      })
    );

    const unsubscribe = binding.session.subscribe((event) => {
      const pending = this.handleEvent(binding, event, otherBindingProvider)
        .catch((error: unknown) => {
          this.lastError =
            error instanceof Error ? error : new Error(String(error));
        })
        .finally(() => {
          this.pending.delete(pending);
        });
      this.pending.add(pending);
    });
    this.subscriptions.set(binding.role, unsubscribe);
  }

  public async waitForIdle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
    if (this.lastError) {
      const error = this.lastError;
      this.lastError = undefined;
      throw error;
    }
  }

  public dispose(): void {
    for (const unsubscribe of this.subscriptions.values()) {
      unsubscribe();
    }
    this.subscriptions.clear();
  }

  private async handleEvent(
    binding: RoleRuntimeBinding,
    event: AgentSessionEvent,
    otherBindingProvider: (role: Role) => RoleRuntimeBinding | undefined
  ): Promise<void> {
    const requestId = this.callbacks.getRequestId(binding.role);
    const sessionKey = `${binding.role}:${binding.sessionId}`;
    this.correlation.setRequestId(sessionKey, requestId);

    const telemetry = normalizeEvent({
      role: binding.role,
      sessionId: binding.sessionId,
      sessionFile: binding.sessionFile,
      event,
      requestId,
      leafId: binding.session.sessionManager?.getLeafId?.() ?? undefined,
      correlation: this.correlation
    });
    this.logger.log(telemetry);
    this.metrics.observe(telemetry);

    if (event.type !== "turn_end") {
      return;
    }

    if (binding.role === "A") {
      const bindingB = otherBindingProvider("B");
      if (!bindingB) {
        return;
      }

      const result = await this.orchestrator.handleAgentATurnEnd({
        bindingA: binding,
        bindingB,
        message: event.message,
        requestId,
        state: this.callbacks.getHandoffState(),
        onStateChange: (state) => {
          this.callbacks.setHandoffState(
            selectNewerState(this.callbacks.getHandoffState(), state)
          );
        }
      });
      this.callbacks.setHandoffState(
        selectNewerState(this.callbacks.getHandoffState(), result.state)
      );
      if (
        result.prepared &&
        this.callbacks.getHandoffState().lastCompleted?.handoffId !== result.prepared.handoffId
      ) {
        this.callbacks.onPrepared?.(`Prepared handoff ${result.prepared.handoffId}`);
      }
      return;
    }

    const result = await this.orchestrator.handleAgentBTurnEnd({
      binding,
      message: event.message,
      requestId,
      state: this.callbacks.getHandoffState()
    });
    this.callbacks.setHandoffState(
      selectNewerState(this.callbacks.getHandoffState(), result.state)
    );
    if (result.completed?.completion) {
      this.callbacks.onCompleted?.(
        `Completed ${result.completed.handoffId}: ${result.completed.completion.summary}`
      );
    }
  }
}

function selectNewerState(current: HandoffState, candidate: HandoffState): HandoffState {
  return candidate.records.length >= current.records.length ? candidate : current;
}
