import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { ResponseFormatError, PROTOCOL_TOOL_NAMES } from "../coordinator/response-repair.js";
import type { SessionLike } from "./create-role-runtime.js";

/** Owns Pi preflight, agent work, and post-turn compaction as one submission. */
export class ManagedSession implements SessionLike {
  private stopped = true;
  private pending: Promise<void> | undefined;
  private compactionDone = Promise.resolve();
  private finishCompaction = () => {};
  private readonly autoCompactionEnabled: boolean;
  private readonly unsubscribe: () => void;

  public constructor(public readonly piSession: AgentSession) {
    const session = this.piSession;
    this.autoCompactionEnabled = session.autoCompactionEnabled;
    session.setAutoCompactionEnabled(false);
    this.unsubscribe = session.subscribe((event) => {
      if (event.type === "compaction_start") {
        this.compactionDone = new Promise((resolve) => { this.finishCompaction = resolve; });
        // Pi installs its abort controller immediately after emitting this event.
        if (this.stopped) queueMicrotask(() => session.abortCompaction());
      } else if (event.type === "compaction_end") this.finishCompaction();
    });
  }

  public get sessionId() { return this.piSession.sessionId; }
  public get sessionFile() { return this.piSession.sessionFile; }
  public get model() { return this.piSession.model; }
  public get thinkingLevel() { return this.piSession.thinkingLevel; }
  public get isStreaming() { return this.piSession.isStreaming; }
  public get messages() { return this.piSession.messages; }
  public get sessionManager() { return this.piSession.sessionManager; }
  public bindExtensions(bindings: Record<string, never>) { return this.piSession.bindExtensions(bindings); }
  public subscribe(listener: (event: AgentSessionEvent) => void) { return this.piSession.subscribe(listener); }

  public assertActive(): void {
    if (this.stopped) throw new Error("Submission has stopped.");
  }

  public prompt(text: string, options?: Parameters<SessionLike["prompt"]>[1]): Promise<void> {
    if (this.pending) throw new Error("A submission is already active.");
    this.stopped = false;
    const { onTurnEnd, formatOnly, responseId, responseAttempt: _responseAttempt, ...piOptions } = options ?? {};
    const previousTools = this.piSession.getActiveToolNames();
    if (formatOnly) this.piSession.setActiveToolsByName([]);
    this.piSession.setAutoCompactionEnabled(this.autoCompactionEnabled);
    let turnError: Error | undefined;
    // AgentSession notifications are queued and cannot pause the model loop.
    const unsubscribeTurns = this.piSession.agent.subscribe(async (event, signal) => {
      if (event.type === "message_end" && event.message.role === "assistant" && event.message.stopReason !== "error" && event.message.stopReason !== "aborted") {
        const calls = event.message.content.filter((part) => part.type === "toolCall");
        const misuse = calls.find((call) => formatOnly || PROTOCOL_TOOL_NAMES.has(call.name));
        if (misuse) {
          turnError = new ResponseFormatError(responseId ?? "unscoped", formatOnly
            ? "Tools are disabled during response formatting. Return assistant text only."
            : `Protocol label ${misuse.name} is assistant text, not a tool.`, misuse.name);
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
        await this.piSession.prompt(text, { ...piOptions, preflightResult: (disposition) => {
          if (disposition === "started" && this.stopped) void this.piSession.abort();
          options?.preflightResult?.(disposition === "started");
        } });
        await this.piSession.waitForIdle();
        await this.compactionDone;
        if (turnError) throw turnError;
      } catch (error) {
        throw turnError ?? error;
      } finally {
        this.stopped = true;
        this.piSession.setAutoCompactionEnabled(false);
        unsubscribeTurns();
        this.pending = undefined;
        if (formatOnly) this.piSession.setActiveToolsByName(previousTools);
      }
    })();
    this.pending = pending;
    return pending;
  }

  public async abort(): Promise<void> {
    this.stopped = true;
    this.piSession.setAutoCompactionEnabled(false);
    this.piSession.abortCompaction();
    this.piSession.abortBranchSummary();
    this.piSession.clearQueue();
    await this.piSession.abort();
    await this.pending?.catch(() => undefined);
    await this.compactionDone;
  }

  public dispose(): void {
    this.unsubscribe();
    this.piSession.dispose();
  }
}
