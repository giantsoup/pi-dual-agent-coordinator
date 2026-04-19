import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

import { normalizeEvent, normalizeLifecycleEvent } from "../telemetry/event-normalizer.js";
import { CorrelationState } from "../telemetry/correlation.js";
import { TelemetryLogger } from "../telemetry/logger.js";
import { Metrics } from "../telemetry/metrics.js";
import type { RoleRuntimeBinding } from "../runtime/create-role-runtime.js";
import type { Role } from "../types/role.js";

interface TurnWaiter {
  resolve(message: AgentMessage): void;
  reject(error: Error): void;
}

export class RuntimeEventBridge {
  private readonly subscriptions = new Map<Role, () => void>();
  private readonly correlation = new CorrelationState();
  private readonly requestIds = new Map<Role, string>();
  private readonly pending = new Set<Promise<void>>();
  private readonly bufferedTurnEnds = new Map<string, AgentMessage[]>();
  private readonly turnWaiters = new Map<string, TurnWaiter[]>();
  private lastError: Error | undefined;

  public constructor(
    private readonly logger: TelemetryLogger,
    private readonly metrics: Metrics
  ) {}

  public async bind(binding: RoleRuntimeBinding): Promise<void> {
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
      const pending = this.handleEvent(binding, event)
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

  public setRequestId(role: Role, requestId: string | undefined): void {
    if (requestId) {
      this.requestIds.set(role, requestId);
      return;
    }
    this.requestIds.delete(role);
  }

  public async promptAndWaitForTurnEnd(
    binding: RoleRuntimeBinding,
    text: string,
    options?: {
      streamingBehavior?: "steer" | "followUp";
      preflightResult?: (success: boolean) => void;
    }
  ): Promise<AgentMessage> {
    const sessionKey = this.sessionKey(binding);
    this.bufferedTurnEnds.set(sessionKey, []);
    const turnEndPromise = this.awaitNextTurnEnd(sessionKey);
    await binding.session.prompt(text, options);
    return turnEndPromise;
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

    for (const waiters of this.turnWaiters.values()) {
      for (const waiter of waiters) {
        waiter.reject(new Error("Runtime event bridge disposed"));
      }
    }
    this.turnWaiters.clear();
    this.bufferedTurnEnds.clear();
  }

  private async handleEvent(
    binding: RoleRuntimeBinding,
    event: AgentSessionEvent
  ): Promise<void> {
    const requestId = this.requestIds.get(binding.role);
    const sessionKey = this.sessionKey(binding);
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

    const queue = this.turnWaiters.get(sessionKey);
    if (queue && queue.length > 0) {
      queue.shift()?.resolve(event.message);
      if (queue.length === 0) {
        this.turnWaiters.delete(sessionKey);
      }
      return;
    }

    const buffered = this.bufferedTurnEnds.get(sessionKey) ?? [];
    buffered.push(event.message);
    this.bufferedTurnEnds.set(sessionKey, buffered);
  }

  private awaitNextTurnEnd(sessionKey: string): Promise<AgentMessage> {
    const buffered = this.bufferedTurnEnds.get(sessionKey);
    if (buffered && buffered.length > 0) {
      const message = buffered.shift();
      this.bufferedTurnEnds.set(sessionKey, buffered);
      if (message) {
        return Promise.resolve(message);
      }
    }

    return new Promise<AgentMessage>((resolve, reject) => {
      const waiters = this.turnWaiters.get(sessionKey) ?? [];
      waiters.push({ resolve, reject });
      this.turnWaiters.set(sessionKey, waiters);
    });
  }

  private sessionKey(binding: RoleRuntimeBinding): string {
    return `${binding.role}:${binding.sessionId}`;
  }
}
