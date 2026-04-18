import { join } from "node:path";

import { withPromptProvenance } from "../app/prompt-provenance.js";
import { createRequestId } from "../telemetry/correlation.js";
import { HandoffOrchestrator } from "./handoff-orchestrator.js";
import { RuntimeEventBridge } from "./bind-runtime-events.js";
import { createEmptyHandoffState } from "./handoff-state-machine.js";
import { createRoleRuntime, getDefaultSessionRoot, type RoleRuntimeBinding, type SupportedThinkingLevel } from "../runtime/create-role-runtime.js";
import { RuntimeRegistry } from "../runtime/runtime-registry.js";
import { applyRuntimeOperation, type RuntimeReplacementAction } from "../runtime/runtime-operations.js";
import { getRuntimeHealth } from "../runtime/runtime-health.js";
import { TelemetryLogger } from "../telemetry/logger.js";
import { Metrics } from "../telemetry/metrics.js";
import { createPersistencePaths } from "../persistence/checkpoints.js";
import { RecoveryLoader } from "../persistence/recovery-loader.js";
import { SessionLedger } from "../persistence/session-ledger.js";
import type { HandoffRecord, HandoffState } from "../types/handoff.js";
import type { Role } from "../types/role.js";

export interface CoordinatorOptions {
  cwd: string;
  agentDir?: string;
  sessionRoot?: string;
  sessionMode: "persistent" | "memory";
  jsonLogs: boolean;
  verbose: boolean;
  modelA?: string;
  modelB?: string;
  thinkingA?: SupportedThinkingLevel;
  thinkingB?: SupportedThinkingLevel;
  createRoleRuntime?: typeof createRoleRuntime;
  stdout?: NodeJS.WriteStream;
  stderr?: NodeJS.WriteStream;
}

export class Coordinator {
  private readonly registry = new RuntimeRegistry();
  private readonly requestIds = new Map<Role, string>();
  private readonly metrics = new Metrics();
  private readonly sessionRoot: string;
  private readonly ledger: SessionLedger;
  private readonly logger: TelemetryLogger;
  private readonly recoveryLoader: RecoveryLoader;
  private readonly orchestrator: HandoffOrchestrator;
  private readonly runtimeFactory: typeof createRoleRuntime;
  private readonly eventBridge: RuntimeEventBridge;
  private handoffState: HandoffState = createEmptyHandoffState();
  private lastSummary: string | undefined;

  public constructor(private readonly options: CoordinatorOptions) {
    this.sessionRoot = options.sessionRoot ?? getDefaultSessionRoot(options.cwd);
    const paths = createPersistencePaths(this.sessionRoot);
    this.ledger = new SessionLedger(paths.ledgerFile);
    this.logger = new TelemetryLogger({
      filePath: paths.telemetryFile,
      jsonLogs: options.jsonLogs,
      verbose: options.verbose,
      stdout: options.stdout,
      stderr: options.stderr
    });
    this.recoveryLoader = new RecoveryLoader(this.ledger);
    this.orchestrator = new HandoffOrchestrator(this.ledger);
    this.runtimeFactory = options.createRoleRuntime ?? createRoleRuntime;
    this.eventBridge = new RuntimeEventBridge(
      this.logger,
      this.metrics,
      this.orchestrator,
      {
        getRequestId: (role) => this.requestIds.get(role),
        getHandoffState: () => this.handoffState,
        setHandoffState: (state) => {
          this.handoffState = state;
        },
        onPrepared: (summary) => {
          this.lastSummary = summary;
        },
        onCompleted: (summary) => {
          this.lastSummary = summary;
        }
      }
    );
  }

  public async start(): Promise<void> {
    this.handoffState = await this.recoveryLoader.load();
    const bindingA = await this.runtimeFactory({
      role: "A",
      cwd: this.options.cwd,
      agentDir: this.options.agentDir,
      sessionRoot: this.sessionRoot,
      modelOverride: this.options.modelA,
      thinkingOverride: this.options.thinkingA,
      sessionMode: this.options.sessionMode
    });
    const bindingB = await this.runtimeFactory({
      role: "B",
      cwd: this.options.cwd,
      agentDir: this.options.agentDir,
      sessionRoot: this.sessionRoot,
      modelOverride: this.options.modelB,
      thinkingOverride: this.options.thinkingB,
      sessionMode: this.options.sessionMode
    });
    this.registry.set(bindingA);
    this.registry.set(bindingB);
    await this.eventBridge.bind(bindingA, (role) => this.registry.get(role));
    await this.eventBridge.bind(bindingB, (role) => this.registry.get(role));
  }

  public async submitUserTask(text: string): Promise<string> {
    const bindingA = this.requireBinding("A");
    const requestId = createRequestId();
    this.requestIds.set("A", requestId);
    this.requestIds.set("B", requestId);
    this.lastSummary = undefined;
    try {
      await bindingA.session.prompt(
        withPromptProvenance("user_task", text, {
          requestId,
          sessionRole: "A"
        }),
        bindingA.session.isStreaming ? { streamingBehavior: "followUp" } : undefined
      );
      await this.eventBridge.waitForIdle();

      return this.lastSummary ?? "Agent A did not produce an executable handoff.";
    } finally {
      this.requestIds.delete("A");
      this.requestIds.delete("B");
    }
  }

  public async replaceRuntime(
    role: Role,
    action: RuntimeReplacementAction
  ): Promise<void> {
    const binding = this.requireBinding(role);
    const updated = await applyRuntimeOperation(binding, action);
    this.registry.set(updated);
    await this.eventBridge.bind(updated, (candidateRole) => this.registry.get(candidateRole));
    await this.eventBridge.waitForIdle();
  }

  public getStatus(): Record<string, unknown> {
    const list = this.registry.list().map((binding) => ({
      role: binding.role,
      sessionId: binding.sessionId,
      sessionFile: binding.sessionFile,
      cwd: binding.cwd,
      model: binding.session.model
        ? `${binding.session.model.provider}/${binding.session.model.id}`
        : "(pi-default)",
      thinking: binding.session.thinkingLevel ?? "(default)"
    }));

    return {
      cwd: this.options.cwd,
      sessionRoot: this.options.sessionMode === "memory" ? "(memory)" : this.sessionRoot,
      lastSummary: this.lastSummary,
      activeHandoffId: this.handoffState.activeHandoffId,
      lastPrepared: this.handoffState.lastPrepared?.handoffId,
      lastCompleted: this.handoffState.lastCompleted?.handoffId,
      runtimes: list,
      metrics: this.metrics.snapshot()
    };
  }

  public getSessions(): ReturnType<typeof getRuntimeHealth>[] {
    return this.registry.list().map(getRuntimeHealth);
  }

  public async getLastHandoff(): Promise<{
    state: HandoffState;
    lastValidated?: HandoffRecord | undefined;
    ledgerTail?: HandoffRecord | undefined;
  }> {
    const ledgerTail = await this.ledger.latest();
    return {
      state: this.handoffState,
      lastValidated: selectLastValidatedRecord(this.handoffState),
      ledgerTail
    };
  }

  public async dispose(): Promise<void> {
    this.eventBridge.dispose();
    await this.registry.disposeAll();
  }

  private requireBinding(role: Role): RoleRuntimeBinding {
    const binding = this.registry.get(role);
    if (!binding) {
      throw new Error(`No runtime binding for role ${role}`);
    }
    return binding;
  }
}

export function selectLastValidatedRecord(
  state: HandoffState
): HandoffRecord | undefined {
  return (
    state.records.at(-1) ??
    state.lastCompleted ??
    state.lastDelivered ??
    state.lastPrepared
  );
}
