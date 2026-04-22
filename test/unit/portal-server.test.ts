import { afterEach, describe, expect, it } from "vitest";

import { startInteractivePortalServer } from "../../src/app/portal/server.js";
import type { InteractiveCoordinatorService } from "../../src/app/interactive/service.js";
import type { InteractiveUiState, UiAction, UiEvent } from "../../src/types/ui.js";

class FakeInteractiveService implements InteractiveCoordinatorService {
  private readonly stateListeners = new Set<(state: InteractiveUiState) => void>();
  private readonly uiListeners = new Set<(event: UiEvent) => void>();
  private state = createState();

  public async start(): Promise<void> {}

  public async dispose(): Promise<void> {}

  public async dispatch(action: UiAction): Promise<void> {
    if (action.type === "submit_input") {
      this.state = {
        ...this.state,
        conversation: [
          ...this.state.conversation,
          {
            id: `entry-${this.state.conversation.length + 1}`,
            kind: "operator_message",
            text: action.input,
            createdAt: "2026-04-20T00:00:00.000Z"
          }
        ]
      };
    }

    if (action.type === "quit") {
      this.state = {
        ...this.state,
        shouldExit: true
      };
    }

    this.emit({
      type: "state_changed",
      state: this.state
    });
  }

  public getState(): InteractiveUiState {
    return this.state;
  }

  public subscribeState(listener: (state: InteractiveUiState) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  public subscribeUiEvents(listener: (event: UiEvent) => void): () => void {
    this.uiListeners.add(listener);
    return () => {
      this.uiListeners.delete(listener);
    };
  }

  private emit(event: UiEvent): void {
    for (const listener of this.stateListeners) {
      listener(this.state);
    }
    for (const listener of this.uiListeners) {
      listener(event);
    }
  }
}

describe("portal server", () => {
  const servers: Array<{ stop(): Promise<void> }> = [];
  const abortControllers: AbortController[] = [];

  afterEach(async () => {
    for (const controller of abortControllers) {
      controller.abort();
    }
    abortControllers.length = 0;

    while (servers.length > 0) {
      await servers.pop()?.stop();
    }
  });

  it("requires auth for protected routes while keeping healthz public", async () => {
    const portal = await startInteractivePortalServer({
      service: new FakeInteractiveService(),
      authToken: "secret-token"
    });
    servers.push(portal);

    const healthz = await fetch(`http://${portal.host}:${portal.port}/healthz`);
    const unauthorized = await fetch(`http://${portal.host}:${portal.port}/api/state`);
    const authorized = await fetch(
      `http://${portal.host}:${portal.port}/api/state?token=secret-token`
    );
    const root = await fetch(portal.launchUrl);
    const css = await fetch(`http://${portal.host}:${portal.port}/assets/portal.css`);
    const js = await fetch(`http://${portal.host}:${portal.port}/assets/portal.js`);
    const rootHtml = await root.text();

    expect(healthz.status).toBe(200);
    expect(unauthorized.status).toBe(401);
    expect(authorized.status).toBe(200);
    expect(root.status).toBe(200);
    expect(css.status).toBe(200);
    expect(js.status).toBe(200);
    expect(rootHtml).toContain("window.__PI_DUAL_PORTAL__");
    expect(rootHtml).toContain('<div id="root"></div>');
    expect(root.headers.get("content-security-policy")).toContain(
      "style-src 'self' 'unsafe-inline'"
    );
    expect(css.headers.get("content-type")).toContain("text/css");
    expect(js.headers.get("content-type")).toContain("text/javascript");
  });

  it("rejects non-loopback hosts and malformed action payloads", async () => {
    await expect(
      startInteractivePortalServer({
        service: new FakeInteractiveService(),
        host: "0.0.0.0"
      })
    ).rejects.toThrow("localhost");

    const portal = await startInteractivePortalServer({
      service: new FakeInteractiveService(),
      authToken: "secret-token"
    });
    servers.push(portal);

    const invalid = await fetch(`http://${portal.host}:${portal.port}/api/actions`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        controllerId: "controller-a",
        action: {
          type: "replace_runtime",
          role: "C",
          mode: "new"
        }
      })
    });

    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({
      error: expect.stringContaining("action.role")
    });
  });

  it("locks mutations to the active controller stream and releases on disconnect", async () => {
    const portal = await startInteractivePortalServer({
      service: new FakeInteractiveService(),
      authToken: "secret-token"
    });
    servers.push(portal);

    const controllerA = new AbortController();
    abortControllers.push(controllerA);
    const eventsA = await fetch(
      `http://${portal.host}:${portal.port}/api/events?token=secret-token&controllerId=controller-a`,
      {
        signal: controllerA.signal
      }
    );
    expect(eventsA.status).toBe(200);

    const acceptedA = await postAction(portal, "controller-a", {
      type: "submit_input",
      input: "ship it"
    });
    expect(acceptedA.status).toBe(200);
    expect(acceptedA.body.accepted).toBe(true);
    expect(acceptedA.body.controller).toMatchObject({
      locked: true,
      controllerId: "controller-a"
    });

    const controllerB = new AbortController();
    abortControllers.push(controllerB);
    const eventsB = await fetch(
      `http://${portal.host}:${portal.port}/api/events?token=secret-token&controllerId=controller-b`,
      {
        signal: controllerB.signal
      }
    );
    expect(eventsB.status).toBe(200);

    const rejectedB = await postAction(portal, "controller-b", {
      type: "submit_input",
      input: "should fail"
    });
    expect(rejectedB.status).toBe(409);
    expect(rejectedB.body.accepted).toBe(false);
    expect(rejectedB.body.error).toContain("controller lock");

    controllerA.abort();
    await waitFor(async () => {
      const snapshot = await fetchJson(
        `http://${portal.host}:${portal.port}/api/state?token=secret-token`
      );
      return snapshot.controller.locked === false;
    });

    const acceptedB = await postAction(portal, "controller-b", {
      type: "submit_input",
      input: "take over"
    });
    expect(acceptedB.status).toBe(200);
    expect(acceptedB.body.accepted).toBe(true);
    expect(acceptedB.body.controller).toMatchObject({
      locked: true,
      controllerId: "controller-b"
    });
  });

  it("adds SSE event ids, replays buffered events, and rejects cross-origin posts", async () => {
    const portal = await startInteractivePortalServer({
      service: new FakeInteractiveService(),
      authToken: "secret-token",
      heartbeatMs: 50
    });
    servers.push(portal);

    const controllerA = new AbortController();
    abortControllers.push(controllerA);
    const eventsA = await fetch(
      `http://${portal.host}:${portal.port}/api/events?token=secret-token&controllerId=controller-a`,
      {
        signal: controllerA.signal
      }
    );
    expect(eventsA.status).toBe(200);
    const readerA = eventsA.body!.getReader();
    const firstEvent = await readSseEvent(readerA);

    const accepted = await postAction(portal, "controller-a", {
      type: "submit_input",
      input: "buffer this"
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.lastEventId).toBeGreaterThanOrEqual(firstEvent.eventId);
    const secondEvent = await readSseEvent(readerA);
    expect(secondEvent.eventId).toBe(firstEvent.eventId + 1);
    expect(secondEvent.sentAt).toEqual(expect.any(String));

    const controllerB = new AbortController();
    abortControllers.push(controllerB);
    const replay = await fetch(
      `http://${portal.host}:${portal.port}/api/events?token=secret-token&controllerId=controller-b`,
      {
        headers: {
          "Last-Event-ID": String(firstEvent.eventId)
        },
        signal: controllerB.signal
      }
    );
    expect(replay.status).toBe(200);
    const replayEvent = await readSseEvent(replay.body!.getReader());
    expect(replayEvent.eventId).toBe(secondEvent.eventId);
    expect(replayEvent.event.type).toBe("state_changed");

    const rejectedOrigin = await fetch(
      `http://${portal.host}:${portal.port}/api/actions`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer secret-token",
          "content-type": "application/json",
          origin: "http://evil.invalid"
        },
        body: JSON.stringify({
          controllerId: "controller-a",
          action: {
            type: "quit"
          }
        })
      }
    );
    expect(rejectedOrigin.status).toBe(403);
  });

  it("fails cleanly when the chosen port is already in use", async () => {
    const first = await startInteractivePortalServer({
      service: new FakeInteractiveService(),
      authToken: "secret-token",
      port: 0
    });
    servers.push(first);

    await expect(
      startInteractivePortalServer({
        service: new FakeInteractiveService(),
        authToken: "secret-token",
        port: first.port
      })
    ).rejects.toThrow(/EADDRINUSE|address already in use/i);
  });
});

async function postAction(
  portal: { host: string; port: number },
  controllerId: string,
  action: UiAction
): Promise<{ status: number; body: any }> {
  const response = await fetch(`http://${portal.host}:${portal.port}/api/actions`, {
    method: "POST",
    headers: {
      authorization: "Bearer secret-token",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      controllerId,
      action
    })
  });

  return {
    status: response.status,
    body: await response.json()
  };
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url);
  return response.json();
}

async function readSseEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs = 1_500
): Promise<any> {
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { done, value } = await Promise.race([
      reader.read(),
      new Promise<{ done: false; value: Uint8Array }>((resolve) =>
        setTimeout(() => resolve({ done: false, value: new Uint8Array() }), 20)
      )
    ]);
    if (done) {
      throw new Error("SSE stream closed before an event was received.");
    }
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const dataLine = frame
        .split("\n")
        .find((line) => line.startsWith("data: "));
      if (dataLine) {
        return JSON.parse(dataLine.slice("data: ".length));
      }
    }
  }

  throw new Error("Timed out waiting for SSE event.");
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 1_500
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for portal condition.");
}

function createState(): InteractiveUiState {
  return {
    status: {
      cwd: "/tmp/project",
      conversationMode: "planning",
      phase: "planning",
      phaseLabel: "Planning",
      activeRole: "A",
      activeRoleLabel: "Agent A",
      activeModelDisplay: "GPT-5.4 (openai/gpt-5.4)",
      sessionRoot: "/tmp/sessions",
      repairCount: 0,
      maxReviewRounds: 3,
      runtimes: [],
      metrics: {}
    },
    conversation: [],
    activity: {
      runtimes: {},
      history: {}
    },
    modal: { kind: "none" },
    commandPalette: {
      open: false
    },
    notifications: [],
    shouldExit: false
  };
}
