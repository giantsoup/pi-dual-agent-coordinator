import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

import { extractAssistantText } from "../handoff/handoff-envelope.js";
import { normalizeEvent, normalizeLifecycleEvent } from "../telemetry/event-normalizer.js";
import { CorrelationState } from "../telemetry/correlation.js";
import { TelemetryLogger } from "../telemetry/logger.js";
import { Metrics } from "../telemetry/metrics.js";
import { getModelDisplayInfo } from "../runtime/model-display.js";
import type { RoleRuntimeBinding } from "../runtime/create-role-runtime.js";
import type { Role } from "../types/role.js";

interface TurnWaiter {
  resolve(message: AgentMessage): void;
  reject(error: Error): void;
}

export type RuntimeUiBridgeEvent =
  | {
      type: "assistant_text_delta";
      role: Role;
      sessionId: string;
      sessionFile?: string | undefined;
      requestId?: string | undefined;
      turnIndex?: number | undefined;
      timestamp: string;
      delta: string;
    }
  | {
      type: "assistant_thinking_delta";
      role: Role;
      sessionId: string;
      sessionFile?: string | undefined;
      requestId?: string | undefined;
      turnIndex?: number | undefined;
      timestamp: string;
      delta: string;
      summary?: string | undefined;
    }
  | {
      type: "tool_call_started";
      role: Role;
      sessionId: string;
      sessionFile?: string | undefined;
      requestId?: string | undefined;
      turnIndex?: number | undefined;
      timestamp: string;
      toolName: string;
      argsPreview?: string | undefined;
    }
  | {
      type: "tool_call_delta";
      role: Role;
      sessionId: string;
      sessionFile?: string | undefined;
      requestId?: string | undefined;
      turnIndex?: number | undefined;
      timestamp: string;
      toolName?: string | undefined;
      deltaPreview?: string | undefined;
    }
  | {
      type: "tool_call_completed";
      role: Role;
      sessionId: string;
      sessionFile?: string | undefined;
      requestId?: string | undefined;
      turnIndex?: number | undefined;
      timestamp: string;
      toolName?: string | undefined;
      argsPreview?: string | undefined;
    }
  | {
      type: "assistant_turn_committed";
      role: Role;
      sessionId: string;
      sessionFile?: string | undefined;
      requestId?: string | undefined;
      turnIndex?: number | undefined;
      timestamp: string;
      text: string;
    };

const MACHINE_BLOCK_PSEUDO_TOOLS = new Set([
  "pi-plan",
  "pi-execute",
  "pi-handoff",
  "pi-completion",
  "pi-final"
]);

export class RuntimeEventBridge {
  private readonly subscriptions = new Map<Role, () => void>();
  private readonly uiListeners = new Set<(event: RuntimeUiBridgeEvent) => void>();
  private readonly correlation = new CorrelationState();
  private readonly requestIds = new Map<Role, string>();
  private readonly pending = new Set<Promise<void>>();
  private readonly bufferedTurnEnds = new Map<string, AgentMessage[]>();
  private readonly turnWaiters = new Map<string, TurnWaiter[]>();
  private readonly pseudoToolAttempts = new Map<string, { toolName: string; count: number }>();
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

  public subscribeUiEvents(listener: (event: RuntimeUiBridgeEvent) => void): () => void {
    this.uiListeners.add(listener);
    return () => {
      this.uiListeners.delete(listener);
    };
  }

  public promptAndWaitForTurnEnd(
    binding: RoleRuntimeBinding,
    text: string,
    options?: {
      streamingBehavior?: "steer" | "followUp";
      preflightResult?: (success: boolean) => void;
    }
  ): Promise<AgentMessage> {
    const sessionKey = this.sessionKey(binding);
    this.bufferedTurnEnds.set(sessionKey, []);
    this.pseudoToolAttempts.delete(sessionKey);
    const turnEndPromise = this.awaitNextTurnEnd(sessionKey);
    void turnEndPromise.catch(() => undefined);
    const pending = (async () => {
      await binding.session.prompt(text, options);
      return await turnEndPromise;
    })();
    void pending.catch(() => undefined);
    return pending;
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
    this.uiListeners.clear();

    for (const waiters of this.turnWaiters.values()) {
      for (const waiter of waiters) {
        waiter.reject(new Error("Runtime event bridge disposed"));
      }
    }
    this.turnWaiters.clear();
    this.bufferedTurnEnds.clear();
    this.pseudoToolAttempts.clear();
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
    const model = getModelDisplayInfo(binding.session.model);
    telemetry.details = {
      ...telemetry.details,
      modelName: model.name,
      modelProvider: model.provider,
      modelId: model.id,
      modelCanonical: model.canonical,
      modelDisplay: model.display,
      thinking: binding.session.thinkingLevel ?? "(default)"
    };
    this.logger.log(telemetry);
    this.metrics.observe(telemetry);

    this.maybeEmitUiEvent(binding, event);

    if (
      event.type === "tool_execution_start" &&
      MACHINE_BLOCK_PSEUDO_TOOLS.has(event.toolName)
    ) {
      this.observePseudoToolLoop(binding, sessionKey, event.toolName);
    }

    if (event.type !== "turn_end") {
      return;
    }

    this.pseudoToolAttempts.delete(sessionKey);

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

  private maybeEmitUiEvent(
    binding: RoleRuntimeBinding,
    event: AgentSessionEvent
  ): void {
    const requestId = this.requestIds.get(binding.role);
    const turnIndex = this.correlation.getTurnIndex(this.sessionKey(binding));

    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      this.emitUiEvent({
        type: "assistant_text_delta",
        role: binding.role,
        sessionId: binding.sessionId,
        sessionFile: binding.sessionFile,
        requestId,
        turnIndex,
        timestamp: new Date().toISOString(),
        delta: event.assistantMessageEvent.delta
      });
      return;
    }

    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "thinking_delta"
    ) {
      this.emitUiEvent({
        type: "assistant_thinking_delta",
        role: binding.role,
        sessionId: binding.sessionId,
        sessionFile: binding.sessionFile,
        requestId,
        turnIndex,
        timestamp: new Date().toISOString(),
        delta: event.assistantMessageEvent.delta,
        summary: "Streaming internal reasoning"
      });
      return;
    }

    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "toolcall_delta"
    ) {
      this.emitUiEvent({
        type: "tool_call_delta",
        role: binding.role,
        sessionId: binding.sessionId,
        sessionFile: binding.sessionFile,
        requestId,
        turnIndex,
        timestamp: new Date().toISOString(),
        deltaPreview: event.assistantMessageEvent.delta
      });
      return;
    }

    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "toolcall_end"
    ) {
      this.emitUiEvent({
        type: "tool_call_completed",
        role: binding.role,
        sessionId: binding.sessionId,
        sessionFile: binding.sessionFile,
        requestId,
        turnIndex,
        timestamp: new Date().toISOString(),
        toolName: event.assistantMessageEvent.toolCall.name,
        argsPreview: JSON.stringify(event.assistantMessageEvent.toolCall.arguments)
      });
      return;
    }

    if (event.type === "tool_execution_start") {
      this.emitUiEvent({
        type: "tool_call_started",
        role: binding.role,
        sessionId: binding.sessionId,
        sessionFile: binding.sessionFile,
        requestId,
        turnIndex,
        timestamp: new Date().toISOString(),
        toolName: event.toolName,
        argsPreview: JSON.stringify(event.args)
      });
      return;
    }

    if (event.type !== "turn_end") {
      return;
    }

    this.emitUiEvent({
      type: "assistant_turn_committed",
      role: binding.role,
      sessionId: binding.sessionId,
      sessionFile: binding.sessionFile,
      requestId,
      turnIndex,
      timestamp: new Date().toISOString(),
      text: event.message.role === "assistant" ? extractAssistantText(event.message) : ""
    });
  }

  private emitUiEvent(event: RuntimeUiBridgeEvent): void {
    for (const listener of this.uiListeners) {
      listener(event);
    }
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

  private observePseudoToolLoop(
    binding: RoleRuntimeBinding,
    sessionKey: string,
    toolName: string
  ): void {
    const previous = this.pseudoToolAttempts.get(sessionKey);
    const count =
      previous && previous.toolName === toolName ? previous.count + 1 : 1;
    this.pseudoToolAttempts.set(sessionKey, { toolName, count });

    if (count < 3 || !this.turnWaiters.has(sessionKey)) {
      return;
    }

    this.subscriptions.get(binding.role)?.();
    this.subscriptions.delete(binding.role);
    this.bufferedTurnEnds.delete(sessionKey);
    this.pseudoToolAttempts.delete(sessionKey);

    const error = new Error(
      `Agent ${binding.role} repeatedly attempted to call \`${toolName}\` as a tool. Machine blocks must be written as fenced assistant text. Run \`/new ${binding.role}\` to recover this runtime, then retry.`
    );
    const waiters = this.turnWaiters.get(sessionKey) ?? [];
    this.turnWaiters.delete(sessionKey);
    for (const waiter of waiters) {
      waiter.reject(error);
    }
  }
}
