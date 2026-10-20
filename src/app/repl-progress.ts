import { safeDisplayText } from "../security/display-text.js";
import { currentActionText } from "./interactive/current-activity.js";
import {
  INTERACTIVE_COMMAND_HINT,
  INTERACTIVE_PLAIN_KEY_HINT,
  INTERACTIVE_RUNTIME_HINT
} from "./interactive/compat.js";
import type { UiEvent } from "../types/ui.js";
import type {
  CoordinatorStatusSnapshot,
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
  private progressSinceLastResponse = false;
  private sharedActivityKey: string | undefined;

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

  public handleUiEvent(event: UiEvent): void {
    if (event.type !== "state_changed") return;
    const activity = event.state.currentActivity;
    const owner = activity.owner.kind === "runtime" ? `Agent ${activity.owner.role}${activity.model ? ` / ${activity.model}` : ""}` : "Coordinator";
    const failure = activity.action.kind === "terminal" && activity.action.outcome === "failed" ? activity.action.failure : undefined;
    const line = `${owner} / ${activity.phase}: ${currentActionText(activity.action)}${failure ? ` / ${failure.reason}` : ""}${activity.action.kind === "tool_execution" && activity.action.target ? ` ${activity.action.target}` : ""}${activity.progress ? ` / ${activity.progress}` : ""}`;
    const key = JSON.stringify([activity.owner, activity.action.kind === "tool_execution" ? activity.action.callId : "", line]);
    if (key === this.sharedActivityKey) return;
    this.sharedActivityKey = key;
    this.progressSinceLastResponse = true;
    this.options.stderr.write(`${safeDisplayText(line)}\n`);
  }

  public beforeTextOutput(): void {
    if (this.progressSinceLastResponse) {
      this.options.stdout.write("\n");
    }
    this.progressSinceLastResponse = false;
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

function findRuntime(
  status: CoordinatorStatusSnapshot,
  role: Role
): RuntimeStatusSnapshot | undefined {
  return status.runtimes.find((runtime) => runtime.role === role);
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
