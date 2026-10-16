import {
  deriveActivityUpdate,
  renderActivityText,
  renderReasonText,
  type ActivitySnapshot
} from "./activity-summary.js";
import {
  INTERACTIVE_COMMAND_HINT,
  INTERACTIVE_PLAIN_KEY_HINT,
  INTERACTIVE_RUNTIME_HINT
} from "./interactive/compat.js";
import type { NormalizedTelemetryEvent } from "../types/telemetry.js";
import type { UiEvent } from "../types/ui.js";
import type {
  CoordinatorStatusSnapshot,
  CoordinatorUiPhase,
  RuntimeStatusSnapshot
} from "../types/status.js";
import type { Role } from "../types/role.js";

export interface ReplProgressRendererOptions {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
  isTTY: boolean;
  getStatus: () => CoordinatorStatusSnapshot;
}

export class ReplProgressRenderer {
  private readonly runtimeActivity = new Map<Role, ActivitySnapshot>();
  private coordinatorActivity: ActivitySnapshot | undefined;
  private lastContextKey: string | undefined;
  private lastContextLine: string | undefined;
  private lastActivityLine: string | undefined;
  private lastReasonLine: string | undefined;
  private progressSinceLastResponse = false;

  public constructor(private readonly options: ReplProgressRendererOptions) {}

  public renderStartupBanner(): void {
    this.options.stdout.write(buildStartupBanner(this.options.getStatus(), this.options.isTTY));
  }

  public renderHelp(): void {
    this.options.stdout.write(buildHelpText(this.options.isTTY));
  }

  public getPrompt(): string {
    return buildPromptLabel(this.options.getStatus());
  }

  public handleEvent(event: NormalizedTelemetryEvent): void {
    const lines = this.renderEvent(event);
    if (lines.length === 0) {
      return;
    }
    this.progressSinceLastResponse = true;
    for (const line of lines) {
      this.options.stderr.write(`${line}\n`);
    }
  }

  public handleUiEvent(event: UiEvent): void {
    if (event.type !== "activity_changed") {
      return;
    }

    const lines = this.renderActivitySnapshot(event.state.status, event.activity.active);
    if (lines.length === 0) {
      return;
    }

    this.progressSinceLastResponse = true;
    for (const line of lines) {
      this.options.stderr.write(`${line}\n`);
    }
  }

  public beforeTextOutput(): void {
    if (this.progressSinceLastResponse) {
      this.options.stdout.write("\n");
    }
    this.resetProgressBurst();
    this.progressSinceLastResponse = false;
  }

  private renderEvent(event: NormalizedTelemetryEvent): string[] {
    const status = this.getStatusWithLocalActivity();
    const update = deriveActivityUpdate(event, status);
    if (!update) {
      return [];
    }

    if (update.clear) {
      if (update.role === "coordinator") {
        this.coordinatorActivity = undefined;
      } else {
        this.runtimeActivity.delete(update.role);
      }
      if (this.isActiveContextRole(update.role)) {
        this.resetProgressBurst();
      }
      return [];
    }

    const snapshot = update.snapshot;
    if (!snapshot) {
      return [];
    }

    if (update.role === "coordinator") {
      this.coordinatorActivity = snapshot;
    } else {
      this.runtimeActivity.set(update.role, snapshot);
    }

    const lines: string[] = [];
    const context = this.getContext(event, snapshot);
    if (context.key !== this.lastContextKey) {
      this.lastContextKey = context.key;
      this.lastContextLine = context.line;
      this.lastActivityLine = undefined;
      this.lastReasonLine = undefined;
      lines.push(this.lastContextLine);
    }

    const activityLine = this.renderSnapshotLine(snapshot);
    if (activityLine !== this.lastActivityLine) {
      this.lastActivityLine = activityLine;
      lines.push(activityLine);
    }

    const reasonText = renderReasonText(snapshot);
    if (reasonText) {
      const reasonLine = `  reason: ${reasonText}`;
      if (reasonLine !== this.lastReasonLine) {
        this.lastReasonLine = reasonLine;
        lines.push(reasonLine);
      }
    }

    return lines;
  }

  private renderActivitySnapshot(
    status: CoordinatorStatusSnapshot,
    snapshot?: ActivitySnapshot | undefined
  ): string[] {
    if (!snapshot) {
      this.resetProgressBurst();
      return [];
    }

    const role = snapshot.role === "coordinator" ? status.activeRole : snapshot.role;
    const modelDisplay = resolveModelDisplayFromStatus(status, role);
    const contextKey = `${labelPhase(snapshot.phase)}\u0000${role}\u0000${modelDisplay}`;
    const contextLine = `${labelPhase(snapshot.phase)} · Agent ${role} · ${modelDisplay}`;
    const lines: string[] = [];

    if (contextKey !== this.lastContextKey) {
      this.lastContextKey = contextKey;
      this.lastContextLine = contextLine;
      this.lastActivityLine = undefined;
      this.lastReasonLine = undefined;
      lines.push(contextLine);
    }

    const activityLine = this.renderSnapshotLine(snapshot);
    if (activityLine !== this.lastActivityLine) {
      this.lastActivityLine = activityLine;
      lines.push(activityLine);
    }

    const reasonText = renderReasonText(snapshot);
    if (reasonText) {
      const reasonLine = `  reason: ${reasonText}`;
      if (reasonLine !== this.lastReasonLine) {
        this.lastReasonLine = reasonLine;
        lines.push(reasonLine);
      }
    }

    return lines;
  }

  private renderSnapshotLine(
    snapshot: ActivitySnapshot
  ): string {
    return `  ${renderActivityText(snapshot)}`;
  }

  private getContext(
    event: NormalizedTelemetryEvent,
    snapshot: ActivitySnapshot
  ): { key: string; line: string } {
    const role = snapshot.role === "coordinator" ? event.role : snapshot.role;
    const phaseLabel = labelPhase(snapshot.phase);
    const modelDisplay = resolveModelDisplay(event, role, this.getStatusWithLocalActivity());
    return {
      key: `${phaseLabel}\u0000${role}\u0000${modelDisplay}`,
      line: `${phaseLabel} · Agent ${role} · ${modelDisplay}`
    };
  }

  private isActiveContextRole(role: Role | "coordinator"): boolean {
    if (role === "coordinator") {
      return false;
    }
    return this.lastContextKey?.split("\u0000")[1] === role;
  }

  private resetProgressBurst(): void {
    this.lastContextKey = undefined;
    this.lastContextLine = undefined;
    this.lastActivityLine = undefined;
    this.lastReasonLine = undefined;
  }

  private getStatusWithLocalActivity(): CoordinatorStatusSnapshot {
    const status = this.options.getStatus();
    return {
      ...status,
      currentActivity:
        this.runtimeActivity.get(status.activeRole)
          ? renderActivityText(this.runtimeActivity.get(status.activeRole)!)
          : status.currentActivity,
      currentReason:
        this.runtimeActivity.get(status.activeRole)
          ? renderReasonText(this.runtimeActivity.get(status.activeRole)!)
          : status.currentReason,
      currentTarget: this.runtimeActivity.get(status.activeRole)?.target ?? status.currentTarget,
      coordinatorActivity: this.coordinatorActivity
        ? renderActivityText(this.coordinatorActivity)
        : status.coordinatorActivity,
      coordinatorReason: this.coordinatorActivity
        ? renderReasonText(this.coordinatorActivity)
        : status.coordinatorReason,
      runtimes: status.runtimes.map((runtime) => {
        const snapshot = this.runtimeActivity.get(runtime.role);
        return snapshot
          ? {
              ...runtime,
              currentActivity: renderActivityText(snapshot),
              currentReason: renderReasonText(snapshot),
              currentTarget: snapshot.target
            }
          : runtime;
      })
    };
  }
}

export function buildStartupBanner(status: CoordinatorStatusSnapshot, isTTY: boolean): string {
  const title = style(isTTY, "bold", "pi-dual coordinator");
  return [
    `${title}`,
    `Project: ${status.cwd}`,
    `Current phase: ${status.phaseLabel}`,
    `Operator-facing role: ${status.activeRoleLabel}`,
    `Agent A model: ${findRuntime(status, "A")?.modelDisplay ?? "(pi-default)"}`,
    `Agent B model: ${findRuntime(status, "B")?.modelDisplay ?? "(pi-default)"}`,
    "Planning = you are talking to Agent A",
    "Execution = coordinator is driving Agent B",
    "Review = coordinator is driving Agent A",
    "Agent A can now propose a pending plan that waits for /approve",
    "Modes switch automatically",
    `Commands: ${INTERACTIVE_COMMAND_HINT}`,
    `Keys: ${INTERACTIVE_PLAIN_KEY_HINT}`,
    ""
  ].join("\n");
}

export function buildPromptLabel(status: CoordinatorStatusSnapshot): string {
  return `pi-dual [${status.phaseLabel} · ${status.activeModelDisplay}]> `;
}

export function buildHelpText(isTTY: boolean): string {
  const title = style(isTTY, "bold", "Help");
  return [
    `${title}`,
    "Planning: you are talking to Agent A directly.",
    "Execution: the coordinator is driving Agent B automatically.",
    "Review: the coordinator is driving Agent A automatically.",
    "Repair: the coordinator is issuing a correction prompt to the active agent.",
    "If Agent A proposes a pending plan, run /approve to start execution or /discard to clear it.",
    "Modes switch automatically.",
    `Commands: ${INTERACTIVE_COMMAND_HINT}`,
    `Runtime/session commands: ${INTERACTIVE_RUNTIME_HINT}`,
    "/history lists retained operator turns, individual role runs and calls. /inspect ID summary|request|output|metadata [line offset] reads up to 100 lines.",
    "Inspection never approves, reruns, resumes, switches sessions, or repairs files. Missing data has an explicit reason.",
    "TUI: F1 help from any view; F1/Esc returns. F6/Shift+F6 panes; F2 activity. Editor /help is the typed fallback.",
    "/sessions A or /sessions B lists saved history. Viewing does not switch a runtime.",
    "/model A|B and /thinking A|B open selectors. Choices affect the current conversation and next operation.",
    "Append save to an explicit model, thinking, or /config command to update saved defaults.",
    "Only one request runs at once. Drafts stay editable. /cancel stops work and preserves completed changes.",
    "The default total deadline is 600000 ms per submission. Use /config timeout-ms N or --timeout-ms N.",
    `Keys: ${INTERACTIVE_PLAIN_KEY_HINT}.`,
    ""
  ].join("\n");
}

function resolveModelDisplay(
  event: NormalizedTelemetryEvent,
  role: Role,
  status: CoordinatorStatusSnapshot
): string {
  const detailKey = role === "A" ? "modelDisplayA" : role === "B" ? "modelDisplayB" : "modelDisplay";
  const detailValue = event.details[detailKey];
  if (typeof detailValue === "string" && detailValue) {
    return detailValue;
  }

  if (typeof event.details.modelDisplay === "string" && role === event.role) {
    return event.details.modelDisplay;
  }

  return findRuntime(status, role)?.modelDisplay ?? status.activeModelDisplay;
}

function resolveModelDisplayFromStatus(
  status: CoordinatorStatusSnapshot,
  role: Role
): string {
  return findRuntime(status, role)?.modelDisplay ?? status.activeModelDisplay;
}

function findRuntime(
  status: CoordinatorStatusSnapshot,
  role: Role
): RuntimeStatusSnapshot | undefined {
  return status.runtimes.find((runtime) => runtime.role === role);
}

function labelPhase(phase: CoordinatorUiPhase): string {
  switch (phase) {
    case "planning":
      return "Planning";
    case "execution":
      return "Execution";
    case "review":
      return "Review";
    case "repair":
      return "Repair";
  }
}

function style(isTTY: boolean, kind: "bold", text: string): string {
  if (!isTTY) {
    return text;
  }
  if (kind === "bold") {
    return `\u001B[1m${text}\u001B[22m`;
  }
  return text;
}
