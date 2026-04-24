import type { InteractiveUiState, UiNotification } from "../../types/ui.js";

export interface UserNotice {
  scope: "browser" | "config" | "project" | "service" | "startup" | "thread";
  title: string;
  message: string;
  nextStep?: string | undefined;
  detail?: string | undefined;
}

export interface StartupInstructions {
  lines: string[];
  startupMessage: string;
  startupNotice: UserNotice;
}

export function renderStartupInstructions(input: {
  browserOpenStatus: "opened" | "failed" | "unsupported";
  healthCheckUrl: string;
  launchUrl: string;
  projectPath: string;
}): StartupInstructions {
  const startupNotice: UserNotice = {
    scope: "startup",
    title: "PI Dual web interface is ready",
    message: `Open this link in any browser on this computer: ${input.launchUrl}`,
    nextStep:
      "If the link does not open automatically, copy and paste it into Chrome, Safari, Firefox, or another local browser.",
    detail:
      "This interface is only available on this machine because the server listens on localhost."
  };

  const lines = [
    `${startupNotice.title}.`,
    startupNotice.message,
    startupNotice.nextStep,
    startupNotice.detail,
    `Project loaded: ${input.projectPath}`
  ].filter((line): line is string => Boolean(line));

  if (input.browserOpenStatus === "opened") {
    lines.push("The default browser was asked to open the link automatically.");
  } else if (input.browserOpenStatus === "failed") {
    lines.push(
      "The browser did not open automatically. Copy and paste the link above into any local browser."
    );
  }

  lines.push(`Health check URL: ${input.healthCheckUrl}`);

  return {
    lines,
    startupMessage: renderNoticeText(startupNotice),
    startupNotice
  };
}

export function renderConfigSaveNotice(input: {
  activeThreadsNeedRestart: boolean;
  scope: "global" | "project" | "thread";
  targetName?: string | undefined;
}): UserNotice {
  const scopeLabel =
    input.scope === "global"
      ? "global defaults"
      : input.scope === "project"
        ? `project settings${input.targetName ? ` for ${input.targetName}` : ""}`
        : `thread settings${input.targetName ? ` for ${input.targetName}` : ""}`;

  return {
    scope: input.scope === "project" ? "project" : "config",
    title: "Settings were saved",
    message: `The change applies to ${scopeLabel}.`,
    nextStep: input.activeThreadsNeedRestart
      ? "Start new threads to use the change, or restart active threads if you want them to pick it up now."
      : "New work will use the updated settings right away."
  };
}

export function renderThreadLaunchNotice(input: {
  firstAction: string;
  modelA: string;
  modelB: string;
  projectPath: string;
}): UserNotice {
  return {
    scope: "thread",
    title: "Thread started",
    message: `This thread is using ${input.modelA} for Agent A and ${input.modelB} for Agent B in ${input.projectPath}.`,
    nextStep: `First step: ${input.firstAction}.`
  };
}

export function renderProjectLaunchBlockedNotice(
  reason: "pending_plan" | "active_workflow" | "active_runtime_activity"
): UserNotice {
  switch (reason) {
    case "pending_plan":
      return {
        scope: "project",
        title: "Cannot start a new project thread yet",
        message:
          "The current live thread has a pending plan, so switching projects is blocked right now.",
        nextStep:
          "Approve it, discard it, or wait for the current run to finish before starting a new thread in another directory."
      };
    case "active_workflow":
      return {
        scope: "project",
        title: "Cannot start a new project thread yet",
        message:
          "The current live thread still has an active workflow, so PI Dual cannot replace it safely.",
        nextStep:
          "Wait for the run to finish before switching projects. If a plan is waiting, approve or discard it first."
      };
    case "active_runtime_activity":
      return {
        scope: "project",
        title: "Cannot start a new project thread yet",
        message:
          "The current live thread is still streaming or reporting active coordinator work.",
        nextStep:
          "Wait for the current activity to settle before starting a new thread in another directory."
      };
  }
}

export function renderProjectLaunchSuccessNotice(projectPath: string): UserNotice {
  return {
    scope: "project",
    title: "Thread started",
    message: `Started a new live thread in ${projectPath}.`,
    nextStep: "The previous live thread is now saved in history in the sidebar."
  };
}

export function renderProjectValidationNotice(message: string): UserNotice {
  return {
    scope: "project",
    title: "Project path was not valid",
    message,
    nextStep:
      "Enter an absolute path or a path that starts with \"~/\", and make sure the directory exists and is readable."
  };
}

export function renderRecoveryNotice(input: {
  projectPath: string;
  resumable: boolean;
}): UserNotice {
  return {
    scope: "thread",
    title: "A previous thread was interrupted",
    message: `PI Dual found a previous thread for ${input.projectPath} that did not finish cleanly.`,
    nextStep: input.resumable
      ? "Resume it if you want to continue from the last saved point, or leave it stopped and start a new thread."
      : "Leave it stopped and start a new thread when you are ready."
  };
}

export function renderThreadStateNotice(
  state: InteractiveUiState
): UserNotice | undefined {
  if (state.lastError) {
    return notificationToNotice(state.lastError);
  }

  if (state.notification) {
    return notificationToNotice(state.notification);
  }

  if (state.pendingPlan) {
    return {
      scope: "thread",
      title: "Plan is ready",
      message: "Agent A finished the plan for this project.",
      nextStep:
        "Review it, then choose Approve Plan to start execution, or Discard Plan to ask for changes."
    };
  }

  if (state.status.activeWorkflowId && state.status.phase === "execution") {
    return {
      scope: "thread",
      title: "Execution is running",
      message: `${state.status.activeRoleLabel} is working on ${state.status.cwd} with ${state.status.activeModelDisplay}.`,
      nextStep: "Wait for the next update in the transcript, or open Status for more detail."
    };
  }

  if (state.status.activeWorkflowId && state.status.phase === "review") {
    return {
      scope: "thread",
      title: "Review is running",
      message: `Agent A is reviewing the latest result for workflow ${state.status.activeWorkflowId}.`,
      nextStep: "Wait for the review result, or open Handoff for the latest exchange."
    };
  }

  return undefined;
}

export function renderControllerActionNotice(
  kind: "controller_locked" | "missing_stream" | "stream_disconnected"
): UserNotice {
  switch (kind) {
    case "controller_locked":
      return {
        scope: "browser",
        title: "This tab is read-only",
        message: "Another browser tab currently controls this PI Dual thread.",
        nextStep: "Use the active tab, or reconnect with the launch link to take control from a new tab."
      };
    case "missing_stream":
      return {
        scope: "browser",
        title: "This tab is not ready to send changes",
        message: "The live event stream is not connected yet, so PI Dual cannot track the controller lock for this tab.",
        nextStep: "Wait for the page to reconnect, then try the action again."
      };
    case "stream_disconnected":
      return {
        scope: "browser",
        title: "Connection was lost",
        message: "This page is not connected to the local PI Dual event stream right now.",
        nextStep: "Wait for it to reconnect, or reopen the launch link if the problem continues."
      };
  }
}

export function renderLaunchLinkCopiedNotice(): UserNotice {
  return {
    scope: "browser",
    title: "Link copied",
    message: "The reconnect link is now in your clipboard.",
    nextStep: "Paste it into any browser on this computer to reopen this PI Dual thread."
  };
}

export function renderLaunchLinkCopyFailedNotice(): UserNotice {
  return {
    scope: "browser",
    title: "Link could not be copied automatically",
    message: "The browser did not allow clipboard access for this page.",
    nextStep: "Copy the current address from the browser bar, or use Reconnect with this link."
  };
}

export function renderLocalOnlyAccessNotice(
  hostname: string,
  launchUrl: string
): UserNotice {
  return {
    scope: "browser",
    title: "This web interface is local-only",
    message: `This page was opened with ${hostname}, but the current PI Dual web interface only supports browsers on this machine.`,
    nextStep: `Open the local launch link instead: ${launchUrl}`
  };
}

export function renderUnauthorizedPortalNotice(): UserNotice {
  return {
    scope: "browser",
    title: "This page is not authorized",
    message: "The launch link is missing or no longer valid for this PI Dual process.",
    nextStep: "Return to the terminal and reopen the exact launch link that PI Dual printed."
  };
}

export function renderRequestOriginNotice(): UserNotice {
  return {
    scope: "browser",
    title: "This browser request was blocked",
    message: "PI Dual only accepts update requests from the local web page that opened this thread.",
    nextStep: "Reload the launch link in the browser you want to use, then try again."
  };
}

export function renderNoticeText(
  notice: Pick<UserNotice, "title" | "message" | "nextStep" | "detail">
): string {
  const lines = [ensureSentence(notice.title), notice.message];
  if (notice.detail) {
    lines.push(notice.detail);
  }
  if (notice.nextStep) {
    lines.push(notice.nextStep);
  }
  return lines.filter(Boolean).join("\n");
}

export function renderNotificationText(notification: UiNotification): string {
  if (!notification.title || notification.title === notification.message) {
    return [
      notification.message,
      notification.detail,
      notification.nextStep
    ]
      .filter(Boolean)
      .join("\n");
  }

  return renderNoticeText({
    title: notification.title,
    message: notification.message,
    detail: notification.detail,
    nextStep: notification.nextStep
  }).trim();
}

function notificationToNotice(notification: UiNotification): UserNotice {
  return {
    scope:
      notification.scope === "system" || notification.scope === "service"
        ? "service"
        : "thread",
    title:
      notification.title ??
      (notification.level === "error" ? "Action failed" : "Update available"),
    message: notification.message,
    detail: notification.detail,
    nextStep: notification.nextStep
  };
}

function ensureSentence(value: string): string {
  return /[.!?]$/.test(value) ? value : `${value}.`;
}
