import { randomUUID } from "node:crypto";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

import { extractAssistantText } from "../handoff/handoff-envelope.js";
import { normalizeEvent, normalizeLifecycleEvent } from "../telemetry/event-normalizer.js";
import { CorrelationState } from "../telemetry/correlation.js";
import { TelemetryLogger } from "../telemetry/logger.js";
import { Metrics } from "../telemetry/metrics.js";
import { getModelDisplayInfo } from "../runtime/model-display.js";
import type { RoleRuntimeBinding, SessionPromptOptions } from "../runtime/create-role-runtime.js";
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
      timestamp: string;
      messageId?: string | undefined;
      delta: string;
    }
  | {
      type: "assistant_turn_committed";
      role: Role;
      sessionId: string;
      sessionFile?: string | undefined;
      timestamp: string;
      messageId?: string | undefined;
      text: string;
    };

const MACHINE_BLOCK_PSEUDO_TOOLS = new Set([
  "pi-plan",
  "pi-execute",
  "pi-handoff",
  "pi-completion",
  "pi-final",
  "pi-check-in"
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
  private operatorTurnId: string | undefined;
  private readonly runIds = new Map<Role, string>();
  public setOperatorTurn(id: string): void { this.operatorTurnId = id; }

  private operationSignal: AbortSignal | undefined;
  private turnSequence = 0;
  private readonly turnIds = new Map<Role, string>();

  public constructor(
    private readonly logger: TelemetryLogger,
    private readonly metrics: Metrics
  ) {}

  public async bind(binding: RoleRuntimeBinding): Promise<void> {
    await binding.rebind();
    this.subscriptions.get(binding.role)?.();

    this.logger.log(
      normalizeLifecycleEvent({
        role: binding.role,
        sessionId: binding.sessionId,
        sessionFile: binding.sessionFile,
        eventType: "coordinator.runtime_bound"
      })
    );

    const session = binding.session;
    const unsubscribe = session.subscribe((event) => {
      if (binding.session !== session) return;
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

  public beginOperation(signal: AbortSignal): void {
    this.operationSignal = signal;
    signal.addEventListener("abort", () => {
      for (const waiters of this.turnWaiters.values()) {
        for (const waiter of waiters) waiter.reject(new OperationStoppedError());
      }
      this.turnWaiters.clear();
      this.bufferedTurnEnds.clear();
    }, { once: true });
  }

  public assertActive(): void {
    if (this.operationSignal?.aborted) throw new OperationStoppedError();
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
    options?: SessionPromptOptions
  ): Promise<AgentMessage> {
    this.assertActive();
    const sessionKey = this.sessionKey(binding);
    const runId = randomUUID();
    this.runIds.set(binding.role, runId);
    const tag = text.split("\n", 1)[0] ?? "";
    const attribute = (name: string) => tag.match(new RegExp(`${name}="([^"<>]+)"`))?.[1];
    const metadata = { runId, operatorTurnId: this.operatorTurnId, requestId: this.requestIds.get(binding.role),
      workflowId: attribute("workflowId"), handoffId: attribute("handoffId"), provenance: attribute("provenance") ?? "planning_user" };
    const branchId = binding.session.sessionManager?.appendCustomEntry?.("pi-dual-run", metadata) ?? binding.session.sessionManager?.getLeafId();
    const logRun = (eventType: string, details: Record<string, unknown>) => this.logger.log({
      ...normalizeLifecycleEvent({ role: binding.role, sessionId: binding.sessionId, sessionFile: binding.sessionFile,
        requestId: metadata.requestId, eventType, details: { ...metadata, branchId, ...details } }),
      runId, operatorTurnId: this.operatorTurnId
    });
    logRun("runtime.run_started", {});
    this.turnIds.set(binding.role, `${this.requestIds.get(binding.role) ?? "turn"}:${++this.turnSequence}`);
    this.bufferedTurnEnds.set(sessionKey, []);
    this.pseudoToolAttempts.delete(sessionKey);
    const turnEndPromise = this.awaitNextTurnEnd(sessionKey);
    void turnEndPromise.catch(() => undefined);
    const prompt = binding.session.prompt(text, options);
    const pending = (async () => {
      try {
        const [, message] = await Promise.all([prompt, turnEndPromise]);
        this.assertActive();
        logRun("runtime.run_finished", { outcome: "completed", leafId: binding.session.sessionManager?.getLeafId() });
        return message;
      } catch (error) {
        if (!this.operationSignal?.aborted) await binding.session.abort();
        logRun("runtime.run_finished", { outcome: this.operationSignal?.aborted ? "interrupted" : "failed", leafId: binding.session.sessionManager?.getLeafId() });
        throw error;
      } finally {
        this.runIds.delete(binding.role);
        await prompt.catch(() => undefined);
        const waiters = this.turnWaiters.get(sessionKey) ?? [];
        this.turnWaiters.delete(sessionKey);
        for (const waiter of waiters) waiter.reject(new Error("Prompt ended before turn_end."));
      }
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
    if (this.operationSignal?.aborted) return;
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
    telemetry.runId = this.runIds.get(binding.role);
    telemetry.operatorTurnId = this.operatorTurnId;
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
    this.turnIds.set(binding.role, `${requestId ?? "turn"}:${++this.turnSequence}`);

    if (event.message.role === "assistant" && event.message.content.some((part) => part.type === "toolCall")) return;

    const queue = this.turnWaiters.get(sessionKey);
    if (queue && queue.length > 0) {
      const waiter = queue.shift();
      if (event.message.role === "assistant" && (event.message.stopReason === "error" || event.message.stopReason === "aborted")) {
        waiter?.reject(new Error(event.message.errorMessage ?? `Provider stopped: ${event.message.stopReason}`));
      } else waiter?.resolve(event.message);
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
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      this.emitUiEvent({
        type: "assistant_text_delta",
        role: binding.role,
        sessionId: binding.sessionId,
        sessionFile: binding.sessionFile,
        timestamp: new Date().toISOString(),
        messageId: this.turnIds.get(binding.role),
        delta: event.assistantMessageEvent.delta
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
      timestamp: new Date().toISOString(),
      messageId: this.turnIds.get(binding.role),
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

export class OperationStoppedError extends Error {
  public constructor() { super("Work cancelled. Completed file changes are preserved."); }
}
