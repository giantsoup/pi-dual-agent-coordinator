import { randomBytes, randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse
} from "node:http";

import type { InteractiveCoordinatorService } from "../interactive/service.js";
import { PORTAL_APP_CSS, PORTAL_APP_JS, renderPortalIndexHtml } from "./assets.js";
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
}

export interface StartPortalServerOptions {
  service: InteractiveCoordinatorService;
  host?: string;
  port?: number;
  authToken?: string;
  controllerIdFactory?(): string;
}

export interface InteractivePortalServer {
  host: string;
  port: number;
  authToken: string;
  launchUrl: string;
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
  const clients = new Map<string, SseClient>();
  let controller: PortalControllerLockSnapshot = {
    locked: false
  };
  let stopped = false;

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

  let address;
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
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/css; charset=utf-8",
        "x-content-type-options": "nosniff"
      });
      response.end(PORTAL_APP_CSS);
      return;
    }

    if (method === "GET" && url.pathname === "/assets/portal.js") {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/javascript; charset=utf-8",
        "x-content-type-options": "nosniff"
      });
      response.end(PORTAL_APP_JS);
      return;
    }

    if (!hasValidAuthToken(request, url, authToken)) {
      respondWithError(response, 401, "Unauthorized.");
      return;
    }

    if (method === "GET" && url.pathname === "/") {
      const cspNonce = randomBytes(16).toString("base64");
      const controllerId = controllerIdFactory();
      const bootstrap = createPortalBootstrapConfigDto({
        authToken,
        controllerId
      });
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
        "content-security-policy":
          `default-src 'self'; script-src 'self' 'nonce-${cspNonce}'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
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
        createPortalStateSnapshotDto(options.service.getState(), controller)
      );
      return;
    }

    if (method === "GET" && url.pathname === "/api/events") {
      const controllerId = readControllerId(url);
      if (!controllerId) {
        respondWithError(response, 400, "controllerId is required for /api/events.");
        return;
      }

      const client: SseClient = {
        id: randomUUID(),
        controllerId,
        response
      };
      clients.set(client.id, client);
      attachSseCleanup(request, client);

      response.writeHead(200, {
        "cache-control": "no-store",
        connection: "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
        "x-content-type-options": "nosniff"
      });

      if (!controller.locked) {
        controller = {
          locked: true,
          controllerId
        };
        broadcastStateEcho();
      } else {
        sendUiEvent(
          response,
          {
            type: "state_changed",
            state: options.service.getState()
          },
          controller
        );
      }
      return;
    }

    if (method === "POST" && url.pathname === "/api/actions") {
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
            error:
              "Open /api/events from this browser tab before sending actions so the controller lock can be tracked."
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
            error: "Another browser tab currently holds the controller lock."
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
          controller
        })
      );
      return;
    }

    respondWithError(response, 404, "Not found.");
  }

  function attachSseCleanup(request: IncomingMessage, client: SseClient): void {
    let released = false;
    const release = () => {
      if (released) {
        return;
      }
      released = true;
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
    for (const client of clients.values()) {
      sendUiEvent(client.response, event, controller);
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
      client.response.end();
    }
    clients.clear();

    await closeServer(server);
  }

  return {
    host,
    port: address.port,
    authToken,
    launchUrl: `http://${host}:${address.port}/?token=${encodeURIComponent(authToken)}`,
    stop
  };
}

function sendUiEvent(
  response: ServerResponse,
  event: UiEvent,
  controller: PortalControllerLockSnapshot
): void {
  const payload = JSON.stringify(createPortalStreamEventDto(event, controller));
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

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buffer.byteLength;
    if (size > 64 * 1024) {
      throw new PortalHttpError(413, "Request body exceeds the 64 KiB limit.");
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
    throw new PortalHttpError(400, "Request body must be valid JSON.");
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
    `Portal host must stay on localhost. Received ${host}.`
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
