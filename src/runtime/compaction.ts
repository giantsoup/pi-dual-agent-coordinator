import { estimateTokens } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { redactText } from "../security/redact.js";
import { randomUUID } from "node:crypto";
import type { CompactionResult, ExtensionFactory, SessionBeforeCompactEvent, SessionManager } from "@earendil-works/pi-coding-agent";
import type { Role } from "../types/role.js";
import { type RequestBudget, ContextManagementError } from "./context-budget.js";

export interface SummaryRequest {
  target: { role: Role; sessionId: string; generation: string; leafId: string | null };
  preparation: SessionBeforeCompactEvent["preparation"];
}
export type SummarizeCompaction = (request: SummaryRequest, signal: AbortSignal) => Promise<CompactionResult>;
export interface CompactionEvent {
  type: "started" | "completed" | "failed" | "cancelled";
  jobId: string; role: Role; sessionId: string; generation: string; summarizerModel: string;
  requestBudget?: RequestBudget;
  reason: string; tokensBefore: number; summaryInputTokens?: number; summaryOutputTokens?: number; estimatedTokensAfter?: number; error?: string;
}

export class CompactionController {
  private readonly generation = randomUUID();
  private readonly listeners = new Set<(event: CompactionEvent) => void>();
  private budget: RequestBudget | undefined;
  public recordBudget(budget: RequestBudget): void { this.budget = budget; }
  private failure: ContextManagementError | undefined;
  private job: { event: CompactionEvent; controller: AbortController } | undefined;
  public constructor(private readonly role: Role, private readonly manager: SessionManager,
    private readonly summarize: SummarizeCompaction | undefined, private readonly model: () => string) {}
  public subscribe(listener: (event: CompactionEvent) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  public reset(): void { this.assertSettled(); this.failure = undefined; }
  public assertHealthy(): void { if (this.failure) throw this.failure; }
  public abort(): void { this.job?.controller.abort(); }
  private assertSettled(): void { if (this.job) throw new ContextManagementError("History compaction has not settled."); }
  private emit(event: CompactionEvent): void { for (const listener of this.listeners) listener(event); }
  private fail(message: string): void { this.failure ??= new ContextManagementError(`History compaction failed; execution stopped. ${message}`); }
  public readonly extension: ExtensionFactory = (pi) => {
    pi.on("session_before_compact", async (event, ctx) => {
      const controller = new AbortController();
      const signal = AbortSignal.any([event.signal, controller.signal]);
      try {
        const leafId = this.manager.getLeafId();
        const target = { role: this.role, sessionId: this.manager.getSessionId(), generation: this.generation, leafId };
        const lifecycle: CompactionEvent = { type: "started", jobId: randomUUID(), role: this.role, sessionId: target.sessionId,
          generation: this.generation, ...(this.budget ? { requestBudget: this.budget } : {}), summarizerModel: this.model(), reason: event.reason, tokensBefore: event.preparation.tokensBefore };
        this.job = { event: lifecycle, controller };
        this.emit(lifecycle);
        if (!this.summarize) throw new ContextManagementError("Trusted Agent A summarizer is unavailable.");
        const previous = this.manager.getBranch().slice().reverse().find((entry) => entry.type === "compaction");
        const inherited = z.object({ schema: z.literal(1), readFiles: z.array(z.string()), modifiedFiles: z.array(z.string()) }).safeParse(previous?.type === "compaction" ? previous.details : undefined);
        const fileOps = { read: new Set(event.preparation.fileOps.read), written: new Set(event.preparation.fileOps.written), edited: new Set(event.preparation.fileOps.edited) };
        if (inherited.success) {
          for (const path of inherited.data.readFiles) fileOps.read.add(path);
          for (const path of inherited.data.modifiedFiles) fileOps.edited.add(path);
        }
        const result = await this.summarize({ target, preparation: { ...event.preparation, fileOps } }, signal);
        signal.throwIfAborted();
        if (this.manager.getLeafId() !== leafId) throw new ContextManagementError("Conversation changed during history compaction.");
        return { compaction: result };
      } catch (error) {
        if (!signal.aborted) this.fail(redactText(error instanceof Error ? error.message : "Summary generation failed."));
        ctx.abort();
        return { cancel: true };
      }
    });
    pi.on("session_compact", (event, ctx) => {
      const job = this.job; this.job = undefined;
      if (!job) return;
      try {
        this.emit({ ...job.event, type: "completed", ...(event.compactionEntry.usage ? { summaryInputTokens: event.compactionEntry.usage.input, summaryOutputTokens: event.compactionEntry.usage.output } : {}), estimatedTokensAfter: this.manager.buildSessionProjection().messages.reduce((sum, message) => sum + estimateTokens(message), 0) });
      } catch { this.fail("Compaction status delivery failed."); ctx.abort(); }
    });
    pi.on("session_compact_failed", (event, ctx) => {
      if (!event.aborted || this.failure) this.fail("Summary generation or checkpoint persistence failed.");
      const job = this.job; this.job = undefined;
      try { if (job) this.emit({ ...job.event, type: this.failure ? "failed" : "cancelled", ...(this.failure ? { error: this.failure.message } : {}) }); }
      catch { this.fail("Compaction status delivery failed."); }
      ctx.abort();
    });
  };
}
