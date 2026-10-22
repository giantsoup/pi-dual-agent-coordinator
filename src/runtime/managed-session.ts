import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { ResponseFormatError, PROTOCOL_TOOL_NAMES } from "../coordinator/response-repair.js";
import type { CompactionController, CompactionEvent } from "./compaction.js";
import { type RequestBudget, ContextManagementError } from "./context-budget.js";
import type { SessionLike } from "./create-role-runtime.js";
import type { ResponseFormattingInput } from "./response-formatter.js";
import { redactValue } from "../security/redact.js";

/** Owns Pi preflight, agent work, and post-turn compaction as one submission. */
export class ManagedSession implements SessionLike {
  public requestBudget: RequestBudget | undefined;
  private submissionController: AbortController | undefined;
  private contextFailure: Error | undefined;
  private stopped = true;
  private pending: Promise<void> | undefined;
  private compactionDone = Promise.resolve();
  private finishCompaction = () => {};
  private readonly autoCompactionEnabled: boolean;
  private readonly unsubscribe: () => void;
  private readonly formatterListeners = new Set<(event: AgentSessionEvent) => void>();

  public constructor(public readonly piSession: AgentSession, private readonly format: (input: ResponseFormattingInput) => Promise<void>, private readonly onAbort?: (() => Promise<void>) | undefined, private readonly compaction?: CompactionController, private readonly preflight?: (text: string, signal: AbortSignal) => Promise<void>) {
    const session = this.piSession;
    this.autoCompactionEnabled = session.autoCompactionEnabled;
    session.setAutoCompactionEnabled(false);
    this.unsubscribe = session.subscribe((event) => {
      if (event.type === "compaction_start") {
        this.compactionDone = new Promise((resolve) => { this.finishCompaction = resolve; });
        // Pi installs its abort controller immediately after emitting this event.
        if (this.stopped) queueMicrotask(() => session.abortCompaction());
      } else if (event.type === "compaction_end") {
        if (event.errorMessage) this.failContext(new ContextManagementError("History compaction failed; execution stopped."));
        this.finishCompaction();
      }
    });
  }

  public get sessionId() { return this.piSession.sessionId; }
  public get sessionFile() { return this.piSession.sessionFile; }
  public get model() { return this.piSession.model; }
  public get thinkingLevel() { return this.piSession.thinkingLevel; }
  public get isStreaming() { return this.pending !== undefined || this.piSession.isStreaming; }
  public get messages() { return this.piSession.messages; }
  public get sessionManager() { return this.piSession.sessionManager; }
  public bindExtensions(bindings: Record<string, never>) { return this.piSession.bindExtensions(bindings); }
  public subscribe(listener: (event: AgentSessionEvent) => void) {
    this.formatterListeners.add(listener);
    const unsubscribe = this.piSession.subscribe(listener);
    return () => { unsubscribe(); this.formatterListeners.delete(listener); };
  }

  public subscribeCompaction(listener: (event: CompactionEvent) => void): () => void { return this.compaction?.subscribe(listener) ?? (() => {}); }
  public failContext(error: unknown): void { this.contextFailure ??= error instanceof Error ? error : new ContextManagementError("Context admission failed."); }
  public assertActive(): void {
    if (this.contextFailure) throw this.contextFailure;
    this.compaction?.assertHealthy();
    if (this.stopped) throw new Error("Submission has stopped.");
  }

  public prompt(text: string, options?: Parameters<SessionLike["prompt"]>[1]): Promise<void> {
    if (this.pending) throw new Error("A submission is already active.");
    const controller = new AbortController();
    this.submissionController = controller;
    this.contextFailure = undefined;
    this.compaction?.reset();
    this.stopped = false;
    const { onTurnEnd, formatting, responseId, responseAttempt: _responseAttempt, ...piOptions } = options ?? {};
    if (!formatting) this.piSession.setAutoCompactionEnabled(this.autoCompactionEnabled);
    let turnError: Error | undefined;
    // AgentSession notifications are queued and cannot pause the model loop.
    const unsubscribeTurns = formatting ? () => {} : this.piSession.agent.subscribe(async (event, signal) => {
      if (event.type === "message_end" && event.message.role === "assistant" && event.message.stopReason !== "error" && event.message.stopReason !== "aborted") {
        const calls = event.message.content.filter((part) => part.type === "toolCall");
        const misuse = calls.find((call) => PROTOCOL_TOOL_NAMES.has(call.name));
        if (misuse) {
          turnError = new ResponseFormatError(responseId ?? "unscoped", `Protocol label ${misuse.name} is assistant text, not a tool.`, misuse.name);
          throw turnError;
        }
      }
      if (event.type !== "turn_end" || !onTurnEnd) return;
      try {
        this.assertActive();
        signal.throwIfAborted();
        const steering = await onTurnEnd(event, signal);
        this.assertActive();
        signal.throwIfAborted();
        if (steering) await this.piSession.steer(steering);
      } catch (error) {
        turnError = error instanceof Error ? error : new Error(String(error));
        throw turnError;
      }
    });
    const pending = (async () => {
      try {
        if (formatting) {
          await this.format({ text, source: this.piSession.messages, previousResponse: formatting.previousResponse,
            responseId: responseId ?? "unscoped", signal: controller.signal, onTurnEnd,
            onEvent: (event) => {
              if (event.type === "message_end") this.piSession.sessionManager.appendCustomEntry("pi-dual-format-message", { message: redactValue(event.message) });
              for (const listener of this.formatterListeners) listener(event);
            } });
          controller.signal.throwIfAborted();
          return;
        }
        await this.preflight?.(text, controller.signal);
        controller.signal.throwIfAborted();
        this.assertActive();
        await this.piSession.prompt(text, { ...piOptions, preflightResult: (disposition) => {
          if (disposition === "started" && this.stopped) void this.piSession.abort();
          options?.preflightResult?.(disposition === "started");
        } });
        await this.piSession.waitForIdle();
        await this.compactionDone;
        this.compaction?.assertHealthy();
        if (this.contextFailure) throw this.contextFailure;
        if (turnError) throw turnError;
      } catch (error) {
        this.piSession.clearQueue();
        this.compaction?.assertHealthy();
        throw this.contextFailure ?? turnError ?? error;
      } finally {
        this.stopped = true;
        if (this.contextFailure) this.piSession.clearQueue();
        this.piSession.setAutoCompactionEnabled(false);
        unsubscribeTurns();
        this.pending = undefined;
        this.submissionController = undefined;
      }
    })();
    this.pending = pending;
    return pending;
  }

  public async abort(): Promise<void> {
    this.stopped = true;
    this.submissionController?.abort();
    this.piSession.setAutoCompactionEnabled(false);
    this.compaction?.abort();
    this.piSession.abortCompaction();
    this.piSession.abortBranchSummary();
    this.piSession.clearQueue();
    await this.piSession.abort();
    await this.pending?.catch(() => undefined);
    await this.compactionDone;
    await this.onAbort?.();
  }

  public dispose(): void {
    this.unsubscribe();
    this.formatterListeners.clear();
    this.piSession.dispose();
  }
}
