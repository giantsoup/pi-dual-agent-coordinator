import { ResponseFormatError, PROTOCOL_TOOL_NAMES, type ResponseProgress } from "./response-repair.js";
import { randomUUID } from "node:crypto";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

import { extractAssistantText } from "../handoff/handoff-envelope.js";
import { normalizeEvent, normalizeLifecycleEvent } from "../telemetry/event-normalizer.js";
import { CorrelationState } from "../telemetry/correlation.js";
import { TelemetryLogger } from "../telemetry/logger.js";
import { Metrics } from "../telemetry/metrics.js";
import { getModelDisplayInfo } from "../runtime/model-display.js";
import { safeDisplayText } from "../security/display-text.js";
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
      runId?: string | undefined;
      sessionFile?: string | undefined;
      timestamp: string;
      messageId?: string | undefined;
      delta: string;
    }
  | {
      type: "assistant_turn_committed";
      role: Role;
      sessionId: string;
      runId?: string | undefined;
      sessionFile?: string | undefined;
      timestamp: string;
      messageId?: string | undefined;
      text: string;
    };

export class RuntimeEventBridge {
  private readonly subscriptions = new Map<Role, () => void>();
  private readonly uiListeners = new Set<(event: RuntimeUiBridgeEvent) => void>();
  private readonly correlation = new CorrelationState();
  private readonly requestIds = new Map<Role, string>();
  private readonly pending = new Set<Promise<void>>();
  private readonly bufferedTurnEnds = new Map<string, AgentMessage[]>();
  private readonly turnWaiters = new Map<string, TurnWaiter[]>();
  private readonly submissions = new Map<string, { responseId: string; formatOnly: boolean; failure?: ResponseFormatError }>();
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

    const unsubscribeCompaction = session.subscribeCompaction?.((event) => {
      if (binding.session !== session) return;
      this.logger.log({ ...normalizeLifecycleEvent({ role: binding.role, sessionId: binding.sessionId, sessionFile: binding.sessionFile,
        requestId: this.requestIds.get(binding.role), eventType: `compaction.${event.type}`, details: { ...event } }),
        runId: this.runIds.get(binding.role), operatorTurnId: this.operatorTurnId });
    });
    const unsubscribeProvider = binding.subscribeProviderDiagnostics?.((event) => {
      if (binding.session !== session) return;
      this.logger.log({ ...normalizeLifecycleEvent({ role: binding.role, sessionId: binding.sessionId, sessionFile: binding.sessionFile,
        requestId: this.requestIds.get(binding.role), eventType: `provider.${event.phase}`, details: { ...event, requestBudget: this.submissions.get(this.sessionKey(binding))?.formatOnly ? undefined : session.requestBudget } }),
        runId: this.runIds.get(binding.role), operatorTurnId: this.operatorTurnId });
    });
    this.subscriptions.set(binding.role, () => { unsubscribe(); unsubscribeCompaction?.(); unsubscribeProvider?.(); });
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
    const metadata = { runId, responseId: options?.responseId, responseAttempt: options?.responseAttempt ?? 1, formatOnly: Boolean(options?.formatting), operatorTurnId: this.operatorTurnId, requestId: this.requestIds.get(binding.role),
      workflowId: attribute("workflowId"), handoffId: attribute("handoffId"), provenance: attribute("provenance") ?? "planning_user" };
    const branchId = binding.session.sessionManager?.appendCustomEntry?.("pi-dual-run", metadata) ?? binding.session.sessionManager?.getLeafId();
    const logRun = (eventType: string, details: Record<string, unknown>) => this.logger.log({
      ...normalizeLifecycleEvent({ role: binding.role, sessionId: binding.sessionId, sessionFile: binding.sessionFile,
        requestId: metadata.requestId, eventType, details: { ...metadata, branchId, ...details } }),
      runId, operatorTurnId: this.operatorTurnId
    });
    const startedAt = performance.now();
    let firstNativeResultMs: number | undefined;
    logRun("runtime.run_started", {});
    this.turnIds.set(binding.role, `${this.requestIds.get(binding.role) ?? "turn"}:${++this.turnSequence}`);
    this.bufferedTurnEnds.set(sessionKey, []);
    this.submissions.set(sessionKey, { responseId: options?.responseId ?? "unscoped", formatOnly: Boolean(options?.formatting) });
    const turnEndPromise = this.awaitNextTurnEnd(sessionKey);
    void turnEndPromise.catch(() => undefined);
    const session = binding.session;
    const prompt = Promise.resolve().then(() => session.prompt(text, { ...options, onTurnEnd: async (event, signal) => {
      if (event.message.role === "assistant" && event.message.stopReason !== "error" && event.message.stopReason !== "aborted") {
        const misuse = event.message.content.find((part) => part.type === "toolCall" && (options?.formatting || PROTOCOL_TOOL_NAMES.has(part.name)));
        if (misuse) throw new ResponseFormatError(options?.responseId ?? "unscoped", "Protocol labels are assistant text; a separate response formatter cannot invoke tools.");
      }
      if (event.toolResults.length && firstNativeResultMs === undefined) firstNativeResultMs = performance.now() - startedAt;
      return options?.onTurnEnd?.(event, signal);
    } }));
    const pending = (async () => {
      try {
        await prompt;
        const firstMessage = await turnEndPromise;
        await this.waitForIdle();
        const message = this.bufferedTurnEnds.get(sessionKey)?.at(-1) ?? firstMessage;
        if (message.role === "assistant" && (message.stopReason === "error" || message.stopReason === "aborted")) {
          throw new Error(message.errorMessage ?? `Provider stopped: ${message.stopReason}`);
        }
        this.assertActive();
        logRun("runtime.run_finished", { elapsedMs: performance.now() - startedAt, firstNativeResultMs, requestBudget: options?.formatting ? undefined : session.requestBudget, outcome: "completed", leafId: binding.session.sessionManager?.getLeafId() });
        return message;
      } catch (error) {
        if (!this.operationSignal?.aborted && !options?.formatting) await binding.session.abort();
        logRun("runtime.run_finished", { elapsedMs: performance.now() - startedAt, firstNativeResultMs, requestBudget: options?.formatting ? undefined : session.requestBudget, outcome: this.operationSignal?.aborted ? "interrupted" : "failed",
          reason: this.operationSignal?.aborted ? undefined : safeDisplayText(error instanceof Error ? error.message : String(error)).slice(0, 1600),
          leafId: binding.session.sessionManager?.getLeafId() });
        throw this.operationSignal?.aborted ? new OperationStoppedError() : this.submissions.get(sessionKey)?.failure ?? error;
      } finally {
        try {
          await prompt.catch(() => undefined);
          await this.waitForIdle();
        } finally {
          this.runIds.delete(binding.role);
          this.submissions.delete(sessionKey);
          this.bufferedTurnEnds.delete(sessionKey);
          const waiters = this.turnWaiters.get(sessionKey) ?? [];
          this.turnWaiters.delete(sessionKey);
          for (const waiter of waiters) waiter.reject(new Error("Prompt ended before turn_end."));
        }
      }
    })();
    void pending.catch(() => undefined);
    return pending;
  }

  public logResponseEvent(eventType: string, binding: RoleRuntimeBinding, progress: ResponseProgress): void {
    const event = normalizeLifecycleEvent({ role: binding.role, sessionId: binding.sessionId, sessionFile: binding.sessionFile,
      requestId: progress.requestId, eventType, details: { ...progress } });
    event.operatorTurnId = this.operatorTurnId;
    this.logger.log(event);
    this.metrics.observe(event);
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
    this.submissions.clear();
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
      messageId: this.turnIds.get(binding.role),
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
      (PROTOCOL_TOOL_NAMES.has(event.toolName) || this.submissions.get(sessionKey)?.formatOnly)
    ) {
      this.observePseudoToolLoop(sessionKey, event.toolName);
    }

    if (event.type !== "turn_end") {
      return;
    }

    this.turnIds.set(binding.role, `${requestId ?? "turn"}:${++this.turnSequence}`);

    if (event.message.role === "assistant" && event.message.stopReason !== "error" && event.message.stopReason !== "aborted" && event.message.content.some((part) => part.type === "toolCall")) return;

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
        runId: this.runIds.get(binding.role),
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
      runId: this.runIds.get(binding.role),
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
    sessionKey: string,
    toolName: string
  ): void {
    const submission = this.submissions.get(sessionKey);
    if (!submission || submission.failure) return;
    const error = new ResponseFormatError(submission.responseId,
      submission.formatOnly ? "The response formatter has no tools; execution tools remain available in the separate session." : `Protocol label ${toolName} must be fenced assistant text, not a tool.`, toolName);
    submission.failure = error;
    const waiters = this.turnWaiters.get(sessionKey) ?? [];
    this.turnWaiters.delete(sessionKey);
    for (const waiter of waiters) waiter.reject(error);
  }
}

export class OperationStoppedError extends Error {
  public constructor() { super("Work cancelled. Completed file changes are preserved."); }
}
