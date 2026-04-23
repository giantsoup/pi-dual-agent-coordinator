import { randomBytes, randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse
} from "node:http";

import type { InteractiveCoordinatorService } from "../interactive/service.js";
import {
  renderControllerActionNotice,
  renderNoticeText,
  renderRequestOriginNotice,
  renderStartupInstructions,
  renderUnauthorizedPortalNotice
} from "../presentation/notices.js";
import { loadPortalAssetBundle, renderPortalIndexHtml } from "./assets.js";
import {
  createPortalActionResponseDto,
  createPortalBootstrapConfigDto,
  createPortalStateSnapshotDto,
  createPortalStreamEventDto,
  parsePortalActionRequestDto,
  type PortalControllerLockSnapshot
} from "./protocol.js";
import type { UiEvent } from "../../types/ui.js";

interface SseClient {
  id: string;
  controllerId: string;
  response: ServerResponse;
  heartbeat: NodeJS.Timeout;
}

interface ReplayEvent {
  eventId: number;
  sentAt: string;
  event: UiEvent;
  controller: PortalControllerLockSnapshot;
}

export interface StartPortalServerOptions {
  service: InteractiveCoordinatorService;
  host?: string;
  port?: number;
  authToken?: string;
  heartbeatMs?: number;
  replayBufferSize?: number;
  controllerIdFactory?(): string;
}

export interface InteractivePortalServer {
  host: string;
  port: number;
  authToken: string;
  launchUrl: string;
  healthCheckUrl: string;
  localOnly: true;
  startupMessage: string;
  startupNotice: ReturnType<typeof renderStartupInstructions>["startupNotice"];
  stop(): Promise<void>;
}

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff"
} as const;

export async function startInteractivePortalServer(
  options: StartPortalServerOptions
): Promise<InteractivePortalServer> {
  const host = assertLoopbackHost(options.host ?? "127.0.0.1");
  const authToken = options.authToken ?? createPortalAuthToken();
  const controllerIdFactory = options.controllerIdFactory ?? randomUUID;
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  const replayBufferSize = options.replayBufferSize ?? 500;
  const clients = new Map<string, SseClient>();
  const replayBuffer: ReplayEvent[] = [];
  let controller: PortalControllerLockSnapshot = {
    locked: false
  };
  let lastEventId = 0;
  let stopped = false;
  let address: Exclude<ReturnType<HttpServer["address"]>, null | string>;

  const server = createServer((request, response) => {
    void handleRequest(request, response).catch((error) => {
      if (error instanceof PortalHttpError) {
        respondWithError(response, error.statusCode, error.message);
        return;
      }
      respondWithError(
        response,
        500,
        error instanceof Error ? error.message : String(error)
      );
    });
  });

  const unsubscribe = options.service.subscribeUiEvents((event) => {
    broadcastUiEvent(event);
  });

  try {
    address = await listenServer(server, host, options.port ?? 0);
  } catch (error) {
    unsubscribe();
    throw error;
  }

  async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", `http://${host}`);

    if (method === "GET" && url.pathname === "/healthz") {
      writeJson(response, 200, {
        ok: true,
        controller: controller.locked,
        workflowId: options.service.getState().status.activeWorkflowId ?? null
      });
      return;
    }

    if (method === "GET" && url.pathname === "/favicon.ico") {
      response.writeHead(204, {
        "cache-control": "no-store"
      });
      response.end();
      return;
    }

    if (method === "GET" && url.pathname === "/assets/portal.css") {
      const assets = await loadPortalAssetBundle();
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/css; charset=utf-8",
        "x-content-type-options": "nosniff"
      });
      response.end(assets.css);
      return;
    }

    if (method === "GET" && url.pathname === "/assets/portal.js") {
      const assets = await loadPortalAssetBundle();
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/javascript; charset=utf-8",
        "x-content-type-options": "nosniff"
      });
      response.end(assets.js);
      return;
    }

    if (!hasValidAuthToken(request, url, authToken)) {
      respondWithError(
        response,
        401,
        renderNoticeText(renderUnauthorizedPortalNotice())
      );
      return;
    }

    if (method === "GET" && url.pathname === "/") {
      const cspNonce = randomBytes(16).toString("base64");
      const controllerId = controllerIdFactory();
      const startup = renderStartupInstructions({
        browserOpenStatus: "unsupported",
        healthCheckUrl,
        launchUrl,
        projectPath: options.service.getState().status.cwd
      });
      const bootstrap = createPortalBootstrapConfigDto({
        authToken,
        controllerId,
        host,
        launchUrl,
        localOnly: true,
        port: address.port,
        startupMessage: startup.startupMessage,
        startupNotice: startup.startupNotice
      });
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
        "content-security-policy":
          `default-src 'self'; script-src 'self' 'nonce-${cspNonce}'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff"
      });
      response.end(renderPortalIndexHtml(bootstrap, cspNonce));
      return;
    }

    if (method === "GET" && url.pathname === "/api/state") {
      writeJson(
        response,
        200,
        createPortalStateSnapshotDto(options.service.getState(), controller, lastEventId)
      );
      return;
    }

    if (method === "GET" && url.pathname === "/api/events") {
      const controllerId = readControllerId(url);
      if (!controllerId) {
        respondWithError(response, 400, "controllerId is required for /api/events.");
        return;
      }

      response.writeHead(200, {
        "cache-control": "no-store",
        connection: "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
        "x-content-type-options": "nosniff"
      });
      response.write(": connected\n\n");

      const client: SseClient = {
        id: randomUUID(),
        controllerId,
        response,
        heartbeat: setInterval(() => {
          response.write(`: heartbeat ${new Date().toISOString()}\n\n`);
        }, heartbeatMs)
      };
      clients.set(client.id, client);
      attachSseCleanup(request, client);

      if (!controller.locked) {
        controller = {
          locked: true,
          controllerId
        };
        broadcastStateEcho();
      } else {
        replayOrSendSnapshot(response, readLastEventId(request, url));
      }
      return;
    }

    if (method === "POST" && url.pathname === "/api/actions") {
      validatePostOrigin(request, host);
      let body;
      try {
        body = parsePortalActionRequestDto(await readJsonBody(request));
      } catch (error) {
        throw new PortalHttpError(
          400,
          error instanceof Error ? error.message : "Invalid action request."
        );
      }
      if (!hasLiveControllerStream(body.controllerId, clients)) {
        writeJson(
          response,
          409,
          createPortalActionResponseDto({
            accepted: false,
            state: options.service.getState(),
            controller,
            lastEventId,
            error: renderNoticeText(renderControllerActionNotice("missing_stream"))
          })
        );
        return;
      }

      if (controller.locked && controller.controllerId !== body.controllerId) {
        writeJson(
          response,
          409,
          createPortalActionResponseDto({
            accepted: false,
            state: options.service.getState(),
            controller,
            lastEventId,
            error: renderNoticeText(renderControllerActionNotice("controller_locked"))
          })
        );
        return;
      }

      if (!controller.locked) {
        controller = {
          locked: true,
          controllerId: body.controllerId
        };
        broadcastStateEcho();
      }

      await options.service.dispatch(body.action);
      writeJson(
        response,
        200,
        createPortalActionResponseDto({
          accepted: true,
          state: options.service.getState(),
          controller,
          lastEventId
        })
      );
      return;
    }

    respondWithError(response, 404, "This PI Dual page does not exist.");
  }

  function attachSseCleanup(request: IncomingMessage, client: SseClient): void {
    let released = false;
    const release = () => {
      if (released) {
        return;
      }
      released = true;
      clearInterval(client.heartbeat);
      clients.delete(client.id);
      if (
        controller.locked &&
        controller.controllerId === client.controllerId &&
        !hasLiveControllerStream(client.controllerId, clients)
      ) {
        controller = {
          locked: false
        };
        broadcastStateEcho();
      }
    };

    request.on("close", release);
    client.response.on("close", release);
  }

  function broadcastUiEvent(event: UiEvent): void {
    const replayEvent = appendReplayEvent(event, controller);
    for (const client of clients.values()) {
      sendUiEvent(client.response, replayEvent);
    }
  }

  function broadcastStateEcho(): void {
    broadcastUiEvent({
      type: "state_changed",
      state: options.service.getState()
    });
  }

  async function stop(): Promise<void> {
    if (stopped) {
      return;
    }
    stopped = true;
    unsubscribe();

    for (const client of clients.values()) {
      clearInterval(client.heartbeat);
      client.response.end();
    }
    clients.clear();

    await closeServer(server);
  }

  const launchUrl = `http://${host}:${address.port}/?token=${encodeURIComponent(authToken)}`;
  const healthCheckUrl = `http://${host}:${address.port}/healthz`;
  const startup = renderStartupInstructions({
    browserOpenStatus: "unsupported",
    healthCheckUrl,
    launchUrl,
    projectPath: options.service.getState().status.cwd
  });

  return {
    host,
    port: address.port,
    authToken,
    launchUrl,
    healthCheckUrl,
    localOnly: true,
    startupMessage: startup.startupMessage,
    startupNotice: startup.startupNotice,
    stop
  };

  function appendReplayEvent(
    event: UiEvent,
    eventController: PortalControllerLockSnapshot
  ): ReplayEvent {
    const replayEvent: ReplayEvent = {
      eventId: ++lastEventId,
      sentAt: new Date().toISOString(),
      event,
      controller: {
        ...eventController
      }
    };
    replayBuffer.push(replayEvent);
    while (replayBuffer.length > replayBufferSize) {
      replayBuffer.shift();
    }
    return replayEvent;
  }

  function replayOrSendSnapshot(
    response: ServerResponse,
    clientLastEventId: number | undefined
  ): void {
    if (clientLastEventId === undefined || replayBuffer.length === 0) {
      sendUiEvent(
        response,
        appendReplayEvent(
          {
            type: "state_changed",
            state: options.service.getState()
          },
          controller
        )
      );
      return;
    }

    const oldestEventId = replayBuffer[0]?.eventId;
    if (oldestEventId !== undefined && clientLastEventId < oldestEventId - 1) {
      sendUiEvent(
        response,
        appendReplayEvent(
          {
            type: "state_changed",
            state: options.service.getState()
          },
          controller
        )
      );
      return;
    }

    for (const replayEvent of replayBuffer) {
      if (replayEvent.eventId > clientLastEventId) {
        sendUiEvent(response, replayEvent);
      }
    }
  }
}

function sendUiEvent(response: ServerResponse, replayEvent: ReplayEvent): void {
  const payload = JSON.stringify(
    createPortalStreamEventDto(
      replayEvent.event,
      replayEvent.controller,
      replayEvent.eventId,
      replayEvent.sentAt
    )
  );
  response.write(`id: ${replayEvent.eventId}\n`);
  response.write(`data: ${payload}\n\n`);
}

function hasValidAuthToken(
  request: IncomingMessage,
  url: URL,
  expectedToken: string
): boolean {
  const header = request.headers.authorization;
  const bearer =
    typeof header === "string" && header.startsWith("Bearer ")
      ? header.slice("Bearer ".length)
      : undefined;
  const queryToken = url.searchParams.get("token");
  return bearer === expectedToken || queryToken === expectedToken;
}

function readControllerId(url: URL): string | undefined {
  const controllerId = url.searchParams.get("controllerId");
  return controllerId?.trim() ? controllerId : undefined;
}

function readLastEventId(request: IncomingMessage, url: URL): number | undefined {
  const rawHeader = request.headers["last-event-id"];
  const rawValue =
    typeof rawHeader === "string"
      ? rawHeader
      : Array.isArray(rawHeader)
        ? rawHeader[0]
        : url.searchParams.get("lastEventId") ?? undefined;
  if (!rawValue) {
    return undefined;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function validatePostOrigin(request: IncomingMessage, expectedHost: string): void {
  const origin = request.headers.origin;
  if (!origin) {
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new PortalHttpError(403, renderNoticeText(renderRequestOriginNotice()));
  }

  const requestHost = request.headers.host;
  if (!requestHost || parsed.host !== requestHost || parsed.protocol !== "http:") {
    throw new PortalHttpError(403, renderNoticeText(renderRequestOriginNotice()));
  }

  assertLoopbackHost(parsed.hostname === "[::1]" ? "::1" : parsed.hostname);
  assertLoopbackHost(expectedHost);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buffer.byteLength;
    if (size > 64 * 1024) {
      throw new PortalHttpError(
        413,
        "The browser sent too much data in one request. Refresh the page and try again."
      );
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new PortalHttpError(
      400,
      "The browser sent an invalid request. Refresh the page and try again."
    );
  }
}

function hasLiveControllerStream(
  controllerId: string,
  clients: Map<string, SseClient>
): boolean {
  for (const client of clients.values()) {
    if (client.controllerId === controllerId) {
      return true;
    }
  }
  return false;
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, JSON_HEADERS);
  response.end(`${JSON.stringify(payload)}\n`);
}

function respondWithError(
  response: ServerResponse,
  statusCode: number,
  message: string
): void {
  writeJson(response, statusCode, {
    error: message
  });
}

function createPortalAuthToken(): string {
  return randomBytes(24).toString("hex");
}

function assertLoopbackHost(host: string): string {
  if (host === "127.0.0.1" || host === "::1" || host === "localhost") {
    return host;
  }
  throw new Error(
    `The PI Dual web interface is local-only and must stay on localhost. Received ${host}.`
  );
}

function closeServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function listenServer(
  server: HttpServer,
  host: string,
  port: number
): Promise<Exclude<ReturnType<HttpServer["address"]>, null | string>> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onListening = () => {
      cleanup();
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Portal server did not expose a TCP address."));
        return;
      }
      resolve(address);
    };
    const cleanup = () => {
      server.off("error", onError);
      server.off("listening", onListening);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

class PortalHttpError extends Error {
  public constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "PortalHttpError";
  }
}
