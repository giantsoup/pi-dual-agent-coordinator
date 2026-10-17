import type { AgentSession, AgentSessionEvent } from "@mariozechner/pi-coding-agent";
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
    const { onTurnEnd, ...piOptions } = options ?? {};
    this.piSession.setAutoCompactionEnabled(this.autoCompactionEnabled);
    let finishAgent = () => {};
    let started = false;
    const agentDone = new Promise<void>((resolve) => { finishAgent = resolve; });
    const unsubscribeAgent = this.piSession.agent.subscribe((event) => {
      if (event.type === "agent_start") started = true;
    });
    const unsubscribe = this.piSession.subscribe((event) => {
      if (event.type === "agent_end") finishAgent();
    });
    let turnError: Error | undefined;
    // AgentSession notifications are queued and cannot pause the model loop.
    const unsubscribeTurns = this.piSession.agent.subscribe(async (event, signal) => {
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
        await this.piSession.prompt(text, { ...piOptions, preflightResult: (success) => {
          if (success) this.assertActive();
          options?.preflightResult?.(success);
        } });
        if (started) await agentDone;
        await this.compactionDone;
        if (turnError) throw turnError;
      } finally {
        this.stopped = true;
        this.piSession.setAutoCompactionEnabled(false);
        unsubscribe();
        unsubscribeAgent();
        unsubscribeTurns();
        this.pending = undefined;
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
    await this.piSession.abort();
    await this.pending?.catch(() => undefined);
    await this.compactionDone;
  }

  public dispose(): void {
    this.unsubscribe();
    this.piSession.dispose();
  }
}
