import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test.describe("portal web UI", () => {
  let server: Awaited<ReturnType<typeof startMockPortal>>;
  let browserErrors: string[];

  test.beforeEach(async ({ page }) => {
    browserErrors = [];
    page.on("pageerror", (error) => {
      browserErrors.push(error.message);
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        browserErrors.push(message.text());
      }
    });
    server = await startMockPortal();
  });

  test.afterEach(async () => {
    expect(browserErrors).toEqual([]);
    await server.stop();
  });

  test("hydrates, submits a prompt, renders MCP, and opens drawers", async ({ page }) => {
    await page.goto(server.url);
    await expect(page.getByTitle("/tmp/project")).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reconnect with this link" })).toBeVisible();
    await expect(page.getByText("Plan pending")).toBeVisible();

    await page.getByRole("tab", { name: "MCP" }).click();
    await expect(page.getByText("filesystem").first()).toBeVisible();
    await expect(page.getByText("3 direct tools").first()).toBeVisible();

    await page.getByLabel("Prompt or slash command").fill("ship the portal");
    await page.keyboard.press("Enter");
    await expect(page.getByText("ship the portal")).toBeVisible();

    await page.getByRole("button", { name: "Approve Plan" }).click();
    await expect(page.getByText("Plan approved")).toBeVisible();

    await page.getByRole("button", { name: "Open status" }).click();
    await expect(page.getByRole("dialog", { name: "Status" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Status" })).toBeHidden();
  });

  test("keeps the operations console usable at responsive widths", async ({ page }) => {
    await page.goto(server.url);
    for (const width of [360, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByLabel("Prompt or slash command")).toBeVisible();
      await page.screenshot({
        path: `test-results/web/portal-${width}.png`,
        fullPage: true
      });
    }
  });
});

async function startMockPortal(): Promise<{
  stop(): Promise<void>;
  url: string;
}> {
  let lastEventId = 0;
  let state = createMockState();
  const clients = new Set<ServerResponse>();

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8"
      });
      response.end(await renderIndex());
      return;
    }
    if (request.method === "GET" && url.pathname === "/assets/portal.js") {
      response.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8"
      });
      response.end(await readFile(resolve(repoRoot, "dist/ui/web/assets/portal.js"), "utf8"));
      return;
    }
    if (request.method === "GET" && url.pathname === "/assets/portal.css") {
      response.writeHead(200, {
        "content-type": "text/css; charset=utf-8"
      });
      response.end(await readFile(resolve(repoRoot, "dist/ui/web/assets/portal.css"), "utf8"));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/state") {
      writeJson(response, {
        protocolVersion: 1,
        lastEventId,
        state,
        controller: {
          locked: true,
          controllerId: "e2e-controller"
        }
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/events") {
      response.writeHead(200, {
        "cache-control": "no-store",
        connection: "keep-alive",
        "content-type": "text/event-stream; charset=utf-8"
      });
      clients.add(response);
      request.on("close", () => clients.delete(response));
      sendEvent(response, nextEvent("state_changed"));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/actions") {
      const body = JSON.parse(await readBody(request)) as {
        action: { type: string; input?: string };
      };
      if (body.action.type === "submit_input") {
        state = {
          ...state,
          conversation: [
            ...state.conversation,
            {
              id: `operator-${state.conversation.length + 1}`,
              kind: "operator_message",
              text: body.action.input ?? "",
              createdAt: new Date().toISOString()
            }
          ]
        };
      }
      if (body.action.type === "approve_pending_plan") {
        state = {
          ...state,
          pendingPlan: undefined,
          conversation: [
            ...state.conversation,
            {
              id: `approval-${state.conversation.length + 1}`,
              kind: "approval_discard",
              action: "approved",
              text: "Plan approved",
              createdAt: new Date().toISOString()
            }
          ]
        };
      }
      if (body.action.type === "open_status") {
        state = {
          ...state,
          modal: {
            kind: "status",
            title: "Status",
            format: "json",
            content: JSON.stringify(state.status, null, 2),
            createdAt: new Date().toISOString()
          }
        };
      }
      if (body.action.type === "close_modal") {
        state = {
          ...state,
          modal: { kind: "none" }
        };
      }
      const event = nextEvent("state_changed");
      for (const client of clients) {
        sendEvent(client, event);
      }
      writeJson(response, {
        protocolVersion: 1,
        lastEventId,
        accepted: true,
        state,
        controller: {
          locked: true,
          controllerId: "e2e-controller"
        }
      });
      return;
    }
    response.writeHead(404);
    response.end("Not found");
  });

  const address = await new Promise<Exclude<ReturnType<typeof server.address>, string | null>>(
    (resolveAddress, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Mock portal did not get a TCP address."));
          return;
        }
        resolveAddress(address);
      });
    }
  );

  return {
    url: `http://127.0.0.1:${address.port}/?token=e2e-token`,
    stop: () =>
      new Promise<void>((resolveStop, reject) => {
        for (const client of clients) {
          client.end();
        }
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolveStop();
        });
      })
  };

  function nextEvent(type: "state_changed"): any {
    lastEventId += 1;
    return {
      protocolVersion: 1,
      eventId: lastEventId,
      sentAt: new Date().toISOString(),
      event: {
        type,
        state
      },
      controller: {
        locked: true,
        controllerId: "e2e-controller"
      }
    };
  }
}

async function renderIndex(): Promise<string> {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>pi-dual portal e2e</title>
    <link rel="stylesheet" href="/assets/portal.css" />
    <script>window.__PI_DUAL_PORTAL__ = { protocolVersion: 1, authToken: "e2e-token", controllerId: "e2e-controller", launchUrl: "${serverLaunchUrlPlaceholder()}", host: "127.0.0.1", port: 0, localOnly: true, startupMessage: "PI Dual web interface is ready.", startupNotice: { scope: "startup", title: "PI Dual web interface is ready", message: "Open this link in any browser on this computer: ${serverLaunchUrlPlaceholder()}", nextStep: "If the link does not open automatically, copy and paste it into Chrome, Safari, Firefox, or another local browser." } };</script>
    <script type="module" src="/assets/portal.js"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;
}

function serverLaunchUrlPlaceholder(): string {
  return "http://127.0.0.1:0/?token=e2e-token";
}

function createMockState(): any {
  const plan = {
    objective: "Production portal",
    summary: "Build the browser operations console.",
    acceptanceCriteria: ["Hydrates", "Submits prompts"],
    relevantPaths: ["ui/web/src/App.tsx"],
    executionPlan: ["Render shell", "Verify controls"],
    constraints: ["Localhost only"],
    proposedAt: "2026-04-22T00:00:00.000Z",
    requestId: "request-1",
    proposedByRole: "A"
  };

  return {
    status: {
      cwd: "/tmp/project",
      conversationMode: "planning",
      phase: "planning",
      phaseLabel: "Planning",
      activeRole: "A",
      activeRoleLabel: "Agent A",
      activeModelDisplay: "GPT-5.4",
      sessionRoot: "/tmp/sessions",
      pendingPlan: plan,
      pendingPlanReady: true,
      nextActionHint: "Approve or discard.",
      activeWorkflowId: "wf-1",
      currentIteration: 1,
      workflowStatus: "running",
      repairCount: 0,
      maxReviewRounds: 3,
      runtimes: [
        {
          role: "A",
          sessionId: "session-a",
          cwd: "/tmp/project",
          modelDisplay: "GPT-5.4",
          thinking: "high",
          healthy: true
        },
        {
          role: "B",
          sessionId: "session-b",
          cwd: "/tmp/project",
          modelDisplay: "Qwen local",
          thinking: "off",
          healthy: true
        }
      ],
      mcp: {
        enabled: true,
        configSources: ["/tmp/project/.mcp.json"],
        roleA: {
          role: "A",
          enabled: true,
          servers: [
            {
              name: "filesystem",
              connected: true,
              transport: "stdio",
              directTools: ["read", "search", "list"],
              lastMetadataSync: "2026-04-22T00:00:00.000Z"
            }
          ]
        },
        roleB: {
          role: "B",
          enabled: true,
          servers: [
            {
              name: "filesystem",
              connected: true,
              transport: "stdio",
              directTools: ["read", "search", "list"],
              lastMetadataSync: "2026-04-22T00:00:00.000Z"
            }
          ]
        }
      },
      metrics: {
        turns: 2,
        toolCalls: 3
      }
    },
    conversation: [
      {
        id: "plan-ready",
        kind: "plan_ready",
        text: "Plan ready",
        createdAt: "2026-04-22T00:00:00.000Z",
        plan,
        nextActionHint: "Approve or discard."
      }
    ],
    activity: {
      runtimes: {},
      history: {}
    },
    pendingPlan: {
      plan,
      nextActionHint: "Approve or discard."
    },
    modal: { kind: "none" },
    commandPalette: { open: false },
    notifications: [],
    shouldExit: false
  };
}

async function readBody(request: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendEvent(response: ServerResponse, event: any): void {
  response.write(`id: ${event.eventId}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function writeJson(response: ServerResponse, payload: unknown): void {
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(payload)}\n`);
}
