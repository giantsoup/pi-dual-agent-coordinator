import { describe, expect, it } from "vitest";

import {
  INTERACTIVE_PORTAL_PROTOCOL_VERSION,
  createPortalActionResponseDto,
  createPortalBootstrapConfigDto,
  createPortalStateSnapshotDto,
  createPortalStreamEventDto,
  parsePortalActionRequestDto
} from "../../src/app/portal/protocol.js";
import type { InteractiveUiState } from "../../src/types/ui.js";

describe("portal protocol serialization", () => {
  it("serializes a state snapshot as a detached DTO", () => {
    const state = createState();
    const dto = createPortalStateSnapshotDto(state, {
      controllerId: "controller-1",
      locked: true
    }, 12);

    expect(dto.protocolVersion).toBe(INTERACTIVE_PORTAL_PROTOCOL_VERSION);
    expect(dto.lastEventId).toBe(12);
    expect(dto.state).not.toBe(state);
    dto.state.notifications[0]!.message = "changed";
    expect(state.notifications[0]!.message).toBe("Plan available");
  });

  it("serializes action responses and stream events without leaking references", () => {
    const state = createState();
    const response = createPortalActionResponseDto({
      accepted: true,
      state,
      controller: {
        controllerId: "controller-1",
        locked: true
      },
      lastEventId: 13
    });
    const event = createPortalStreamEventDto(
      {
        type: "notification_raised",
        state,
        notification: state.notifications[0]!
      },
      {
        controllerId: "controller-1",
        locked: true
      },
      14,
      "2026-04-20T00:00:00.000Z"
    );

    expect(response.protocolVersion).toBe(INTERACTIVE_PORTAL_PROTOCOL_VERSION);
    expect(response.lastEventId).toBe(13);
    expect(event.eventId).toBe(14);
    expect(event.sentAt).toBe("2026-04-20T00:00:00.000Z");
    expect(response.state).not.toBe(state);
    expect(event.event.state).not.toBe(state);
    event.event.state.status.cwd = "/tmp/changed";
    expect(state.status.cwd).toBe("/tmp/project");
  });

  it("creates bootstrap config and validates incoming action DTOs", () => {
    const bootstrap = createPortalBootstrapConfigDto({
      authToken: "secret-token",
      controllerId: "controller-1"
    });
    const parsed = parsePortalActionRequestDto({
      controllerId: "controller-1",
      action: {
        type: "replace_runtime",
        role: "A",
        mode: "switch",
        sessionPath: "/tmp/a.jsonl"
      }
    });

    expect(bootstrap).toEqual({
      protocolVersion: INTERACTIVE_PORTAL_PROTOCOL_VERSION,
      authToken: "secret-token",
      controllerId: "controller-1",
      launchUrl: "http://127.0.0.1/",
      host: "127.0.0.1",
      port: 0,
      localOnly: true,
      startupMessage: "",
      startupNotice: {
        scope: "startup",
        title: "PI Dual web interface is ready",
        message: "Open this link in any browser on this computer: http://127.0.0.1/",
        nextStep:
          "If the link does not open automatically, copy and paste it into a local browser."
      }
    });
    expect(parsed).toEqual({
      controllerId: "controller-1",
      action: {
        type: "replace_runtime",
        role: "A",
        mode: "switch",
        sessionPath: "/tmp/a.jsonl"
      }
    });
  });

  it("parses provider settings actions", () => {
    const parsed = parsePortalActionRequestDto({
      controllerId: "controller-1",
      action: {
        type: "save_custom_provider",
        label: "Local proxy",
        baseUrl: "http://127.0.0.1:4000/v1",
        authMode: "custom-env",
        authValue: "LOCAL_PROXY_KEY",
        modelId: "proxy-model"
      }
    });

    expect(parsed).toEqual({
      controllerId: "controller-1",
      action: {
        type: "save_custom_provider",
        label: "Local proxy",
        baseUrl: "http://127.0.0.1:4000/v1",
        authMode: "custom-env",
        authValue: "LOCAL_PROXY_KEY",
        modelId: "proxy-model"
      }
    });
  });

  it("parses launch_project_thread actions", () => {
    const parsed = parsePortalActionRequestDto({
      controllerId: "controller-1",
      action: {
        type: "launch_project_thread",
        projectPath: "~/Sites/print-for-me"
      }
    });

    expect(parsed).toEqual({
      controllerId: "controller-1",
      action: {
        type: "launch_project_thread",
        projectPath: "~/Sites/print-for-me"
      }
    });
  });

  it("rejects malformed action DTOs", () => {
    expect(() =>
      parsePortalActionRequestDto({
        controllerId: "controller-1",
        action: {
          type: "replace_runtime",
          role: "C",
          mode: "new"
        }
      })
    ).toThrow("action.role");
  });
});

function createState(): InteractiveUiState {
  return {
    status: {
      threadId: "thread-1",
      threadTitle: "Thread 1",
      threadStartedAt: "2026-04-20T00:00:00.000Z",
      threadUpdatedAt: "2026-04-20T00:00:00.000Z",
      cwd: "/tmp/project",
      conversationMode: "planning",
      phase: "planning",
      phaseLabel: "Planning",
      activeRole: "A",
      activeRoleLabel: "Agent A",
      activeModelDisplay: "GPT-5.4",
      sessionRoot: "/tmp/sessions",
      repairCount: 0,
      maxReviewRounds: 3,
      runtimes: [],
      metrics: {}
    },
    conversation: [],
    workspace: {
      projects: [],
      recentProjects: [],
      threads: [],
      activeThreadId: "thread-1",
      selectedThreadId: "thread-1"
    },
    timeline: [],
    activeView: "thread",
    settings: createEmptySettingsState(),
    activity: {
      runtimes: {},
      history: {}
    },
    modal: { kind: "none" },
    commandPalette: {
      open: false
    },
    notifications: [
      {
        id: "notice-1",
        level: "info",
        scope: "workflow",
        code: "plan.ready",
        message: "Plan available",
        createdAt: "2026-04-20T00:00:00.000Z"
      }
    ],
    notification: {
      id: "notice-1",
      level: "info",
      scope: "workflow",
      code: "plan.ready",
      message: "Plan available",
      createdAt: "2026-04-20T00:00:00.000Z"
    },
    shouldExit: false
  };
}

function createEmptySettingsState() {
  return {
    activeScope: "global" as const,
    effective: {
      values: {},
      sources: {
        modelA: "legacy" as const,
        modelB: "legacy" as const,
        thinkingA: "legacy" as const,
        thinkingB: "legacy" as const,
        mcpEnabled: "legacy" as const
      }
    },
    scopes: {
      global: { scope: "global" as const, label: "Global defaults", available: true, hasOverrides: false, values: {} },
      project: { scope: "project" as const, label: "Project overrides", available: false, hasOverrides: false, values: {} },
      thread: { scope: "thread" as const, label: "Thread overrides", available: false, hasOverrides: false, values: {} }
    },
    providers: [],
    catalogByProvider: {},
    providerOperation: undefined
  };
}
