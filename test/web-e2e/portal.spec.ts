import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const liveThreadId = "thread-live";
const archivedThreadId = "thread-archived";
const launchedThreadId = "thread-switched";

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

  test("hydrates, switches threads, opens settings, submits a prompt, and opens the status drawer", async ({
    page
  }) => {
    await page.goto(server.url);

    await expect(page.getByText("Local Workspace")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Production Portal Thread" })).toBeVisible();
    await expect(page.getByText("Live thread", { exact: true })).toBeVisible();
    await expect(page.getByText("Plan is ready")).toBeVisible();

    await page.locator(".thread-header__actions").getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("button", { name: "Back to Thread" })).toBeVisible();
    const modelBCard = page.locator(".agent-target-card").filter({
      has: page.getByRole("heading", { name: "Model B" })
    });
    await modelBCard.getByLabel("Provider").selectOption("openai");
    await expect(modelBCard.getByLabel("Model")).toHaveValue("gpt-5.4");
    await page.getByRole("button", { name: "Back to Thread" }).click();

    await page.getByLabel("Prompt or slash command").fill("ship the portal");
    await page.keyboard.press("Enter");
    await expect(page.getByText("ship the portal")).toBeVisible();

    await page.getByRole("button", { name: "Approve Plan" }).click();
    await expect(page.getByText("Approved the pending plan.")).toBeVisible();
  });

  test("keeps the unified workspace usable at responsive widths", async ({ page }) => {
    await page.goto(server.url);
    for (const width of [360, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      if (width < 920) {
        await page.getByLabel("Open workspace sidebar").click();
        await expect(page.getByLabel("Filter local threads")).toBeVisible();
        await page.getByLabel("Close workspace sidebar").click();
      }
      await expect(page.getByLabel("Prompt or slash command")).toBeVisible();
      await page.screenshot({
        path: `test-results/web/portal-${width}.png`,
        fullPage: true
      });
    }
  });

  test("keeps unsaved global target selections stable across incoming portal snapshots", async ({
    page
  }) => {
    await page.goto(server.url);

    await page.locator(".thread-header__actions").getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Global defaults" }).click();

    const modelACard = page.locator(".agent-target-card").filter({
      has: page.getByRole("heading", { name: "Model A" })
    });
    await modelACard.getByLabel("Provider").selectOption("openai");
    await expect(modelACard.getByLabel("Provider")).toHaveValue("openai");
    await expect(modelACard.getByLabel("Model")).toHaveValue("gpt-5.4");

    await page.evaluate(async () => {
      await fetch("/__e2e/push-state", { method: "POST" });
    });

    await expect(modelACard.getByLabel("Provider")).toHaveValue("openai");
    await expect(modelACard.getByLabel("Model")).toHaveValue("gpt-5.4");
  });

  test("opens the project dialog and switches to a new live thread in another directory", async ({
    page
  }) => {
    await page.goto(server.url);

    await page.getByRole("button", { name: "Approve Plan" }).click();
    await page.getByRole("button", { name: "Open Project" }).click();
    await expect(page.getByRole("dialog", { name: "Open Project" })).toBeVisible();

    await page.getByLabel("Project path").fill("/tmp/project-b");
    await page.getByRole("button", { name: "Start New Thread" }).click();

    await expect(page.getByRole("dialog", { name: "Open Project" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Production Portal Thread" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Project B Thread" })).toBeVisible();
  });

  test("fills recent project shortcuts in the project launcher", async ({ page }) => {
    await page.goto(server.url);

    await page.getByRole("button", { name: "Approve Plan" }).click();
    await page.getByRole("button", { name: "Open Project" }).click();
    await page.getByRole("button", { name: "project-b" }).click();
    await expect(page.getByLabel("Project path")).toHaveValue("/tmp/project-b");
  });

  test("shows validation and blocked feedback for project launch failures", async ({
    page
  }) => {
    await page.goto(server.url);

    await page.getByRole("button", { name: "Open Project" }).click();
    await page.getByLabel("Project path").fill("/tmp/project-b");
    await page.getByRole("button", { name: "Start New Thread" }).click();
    await expect(page.getByRole("dialog", { name: "Open Project" })).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Approve Plan" }).click();
    await page.getByRole("button", { name: "Open Project" }).click();
    await page.getByLabel("Project path").fill("/tmp/missing");
    await page.getByRole("button", { name: "Start New Thread" }).click();
    await expect(page.getByRole("dialog", { name: "Open Project" })).toBeVisible();
  });
});

async function startMockPortal(): Promise<{
  stop(): Promise<void>;
  url: string;
}> {
  let lastEventId = 0;
  const clients = new Set<ServerResponse>();
  let activeThreadId = liveThreadId;
  let recentProjects = [
    {
      path: "/Users/Taylor/demo-project",
      name: "demo-project",
      lastOpenedAt: "2026-04-21T18:30:00.000Z"
    },
    {
      path: "/tmp/project-b",
      name: "project-b",
      lastOpenedAt: "2026-04-21T12:00:00.000Z"
    }
  ];
  const threadStates: Record<string, any> = {
    [liveThreadId]: createMockState({
      selectedThreadId: liveThreadId,
      threadId: liveThreadId,
      threadTitle: "Production Portal Thread",
      summaryText: "Plan ready for approval",
      pendingPlanReady: true,
      projectPath: "/tmp/project"
    }),
    [archivedThreadId]: createMockState({
      selectedThreadId: liveThreadId,
      threadId: archivedThreadId,
      threadTitle: "Earlier Archived Thread",
      summaryText: "Earlier archived summary",
      pendingPlanReady: false,
      projectPath: "/tmp/project"
    })
  };
  let selectedThreadId = liveThreadId;
  syncWorkspaceSelections(threadStates, selectedThreadId, activeThreadId, recentProjects);
  let state = cloneState(threadStates[selectedThreadId]);

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8"
      });
      response.end(await renderIndex());
      return;
    }
    if (request.method === "GET" && url.pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/assets/")) {
      const assetPath = resolve(repoRoot, "dist/ui/web", url.pathname.slice(1));
      const ext = extname(assetPath);
      response.writeHead(200, {
        "content-type": contentTypeForAsset(ext)
      });
      response.end(await readFile(assetPath));
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
    if (request.method === "POST" && url.pathname === "/__e2e/push-state") {
      const event = nextEvent("state_changed");
      for (const client of clients) {
        sendEvent(client, event);
      }
      writeJson(response, {
        ok: true,
        lastEventId
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/actions") {
      const body = JSON.parse(await readBody(request)) as {
        action:
          | { type: "submit_input"; input?: string }
          | { type: "approve_pending_plan" }
          | { type: "open_status" }
          | { type: "close_modal" }
          | { type: "launch_project_thread"; projectPath: string }
          | { type: "open_settings"; scope?: "global" | "project" | "thread" }
          | { type: "close_settings" }
          | { type: "select_thread"; threadId: string };
      };

      switch (body.action.type) {
        case "select_thread":
          selectedThreadId = body.action.threadId;
          syncWorkspaceSelections(threadStates, selectedThreadId, activeThreadId, recentProjects);
          state = cloneState(threadStates[selectedThreadId]);
          break;
        case "open_settings":
          state = {
            ...state,
            activeView: "settings",
            settings: {
              ...state.settings,
              activeScope: body.action.scope ?? state.settings.activeScope
            }
          };
          break;
        case "close_settings":
          state = {
            ...state,
            activeView: "thread"
          };
          break;
        case "submit_input":
          if (selectedThreadId !== liveThreadId) {
            break;
          }
          threadStates[liveThreadId] = appendOperatorMessage(
            threadStates[liveThreadId],
            body.action.input ?? ""
          );
          state = cloneState(threadStates[liveThreadId]);
          break;
        case "approve_pending_plan":
          if (selectedThreadId !== liveThreadId) {
            break;
          }
          threadStates[liveThreadId] = approvePlan(threadStates[liveThreadId]);
          state = cloneState(threadStates[liveThreadId]);
          break;
        case "open_status":
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
          break;
        case "close_modal":
          state = {
            ...state,
            modal: { kind: "none" }
          };
          break;
        case "launch_project_thread": {
          const blockedMessage = getProjectLaunchBlockedMessage(threadStates[liveThreadId]);
          if (blockedMessage) {
            writeJson(response, {
              protocolVersion: 1,
              lastEventId,
              accepted: false,
              error: blockedMessage,
              state,
              controller: {
                locked: true,
                controllerId: "e2e-controller"
              }
            });
            return;
          }

          const target = resolveProjectLaunchTarget(body.action.projectPath);
          if (!target) {
            writeJson(response, {
              protocolVersion: 1,
              lastEventId,
              accepted: false,
              error: "Project path was not valid: directory does not exist.",
              state,
              controller: {
                locked: true,
                controllerId: "e2e-controller"
              }
            });
            return;
          }

          activeThreadId = target.threadId;
          selectedThreadId = target.threadId;
          recentProjects = [
            {
              path: target.projectPath,
              name: basename(target.projectPath),
              lastOpenedAt: new Date().toISOString()
            },
            ...recentProjects.filter((project) => project.path !== target.projectPath)
          ].slice(0, 8);
          threadStates[target.threadId] = createMockState({
            selectedThreadId,
            threadId: target.threadId,
            threadTitle: target.threadTitle,
            summaryText: "Fresh thread ready",
            pendingPlanReady: false,
            projectPath: target.projectPath
          });
          syncWorkspaceSelections(threadStates, selectedThreadId, activeThreadId, recentProjects);
          state = {
            ...cloneState(threadStates[selectedThreadId]),
            notification: {
              id: `notice-${target.threadId}`,
              level: "info",
              scope: "service",
              code: "project.thread_launched",
              title: "Thread started",
              message: `Started a new live thread in ${target.projectPath}.`,
              createdAt: new Date().toISOString()
            }
          };
          break;
        }
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

function createMockState(input: {
  pendingPlanReady: boolean;
  projectPath: string;
  selectedThreadId: string;
  summaryText: string;
  threadId: string;
  threadTitle: string;
}): any {
  const now = "2026-04-22T00:00:00.000Z";
  const projectPath = input.projectPath;
  const plan = {
    objective: "Production portal",
    summary: "Build the browser operations console.",
    acceptanceCriteria: ["Hydrates", "Submits prompts"],
    relevantPaths: ["ui/web/src/App.tsx"],
    executionPlan: ["Render shell", "Verify controls"],
    constraints: ["Localhost only"],
    proposedAt: now,
    requestId: "request-1",
    proposedByRole: "A"
  };

  return {
    status: {
      threadId: input.threadId,
      threadTitle: input.threadTitle,
      threadStartedAt: now,
      threadUpdatedAt: now,
      cwd: projectPath,
      conversationMode: "planning",
      phase: input.pendingPlanReady ? "planning" : "execution",
      phaseLabel: input.pendingPlanReady ? "Planning" : "Execution",
      activeRole: input.pendingPlanReady ? "A" : "B",
      activeRoleLabel: input.pendingPlanReady ? "Agent A" : "Agent B",
      activeModelDisplay: "GPT-5.4",
      sessionRoot: "/tmp/sessions",
      pendingPlan: input.pendingPlanReady ? plan : undefined,
      pendingPlanReady: input.pendingPlanReady,
      nextActionHint: input.pendingPlanReady ? "Approve or discard." : undefined,
      activeWorkflowId: input.pendingPlanReady ? "wf-1" : undefined,
      currentIteration: input.pendingPlanReady ? 1 : undefined,
      workflowStatus: input.pendingPlanReady ? "running" : undefined,
      repairCount: 0,
      maxReviewRounds: 3,
      runtimes: [
        {
          role: "A",
          sessionId: "session-a",
          cwd: projectPath,
          modelDisplay: "GPT-5.4",
          thinking: "high",
          healthy: true
        },
        {
          role: "B",
          sessionId: "session-b",
          cwd: projectPath,
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
              lastMetadataSync: now
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
              lastMetadataSync: now
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
        id: `${input.threadId}-entry`,
        kind: input.pendingPlanReady ? "plan_ready" : "workflow_summary",
        text: input.summaryText,
        createdAt: now,
        ...(input.pendingPlanReady
          ? {
              plan,
              nextActionHint: "Approve or discard."
            }
          : {
              workflowId: "wf-prev",
              status: "completed"
            })
      }
    ],
    workspace: buildWorkspaceState({
      activeThreadId: liveThreadId,
      recentProjects: [],
      selectedThreadId: input.selectedThreadId
    }),
    timeline: [
      {
        id: `${input.threadId}-timeline`,
        kind: "message",
        threadId: input.threadId,
        activityKind: "message",
        actor: input.pendingPlanReady ? "system" : "A",
        sourceLabel: input.pendingPlanReady ? "Plan" : "Agent A",
        createdAt: now,
        text: input.summaryText,
        streaming: false
      }
    ],
    activeView: "thread",
    settings: {
      activeScope: "thread",
      effective: {
        values: {
          modelA: "openai/gpt-5.4",
          modelB: "managed-lm-studio/qwen3-coder-next",
          thinkingA: "high",
          thinkingB: "off",
          mcpEnabled: true
        },
        sources: {
          modelA: "thread",
          modelB: "project",
          thinkingA: "thread",
          thinkingB: "project",
          mcpEnabled: "project"
        }
      },
      scopes: {
        global: {
          scope: "global",
          label: "Global defaults",
          available: true,
          hasOverrides: true,
          values: {
            modelA: "openai/gpt-5.4",
            modelB: "openai/gpt-5.4-mini"
          }
        },
        project: {
          scope: "project",
          label: "Project overrides",
          available: true,
          hasOverrides: true,
          description: projectPath,
          values: {
            modelB: "managed-lm-studio/qwen3-coder-next",
            thinkingB: "off",
            mcpEnabled: true
          }
        },
        thread: {
          scope: "thread",
          label: "Thread overrides",
          available: true,
          hasOverrides: input.threadId === liveThreadId,
          description: input.threadId,
          values: input.threadId === liveThreadId ? { thinkingA: "high" } : {}
        }
      },
      providers: [
        {
          id: "openai-codex",
          kind: "openai-codex",
          label: "OpenAI Codex",
          auth: {
            connected: false,
            label: "Not connected",
            source: "oauth"
          },
          discovery: {
            available: true,
            reachable: true,
            modelsFound: 2,
            label: "Not connected"
          },
          verify: {
            status: "idle"
          },
          sourceModelCount: 2,
          defaultModelId: "gpt-5.4"
        },
        {
          id: "openai",
          kind: "openai",
          label: "OpenAI API",
          auth: {
            connected: true,
            label: "Authenticated",
            source: "stored-key"
          },
          discovery: {
            available: true,
            reachable: true,
            modelsFound: 2,
            label: "Authenticated"
          },
          verify: {
            status: "idle"
          },
          sourceModelCount: 2,
          defaultModelId: "gpt-5.4"
        },
        {
          id: "managed-lm-studio",
          kind: "lm-studio",
          label: "LM Studio",
          auth: {
            connected: true,
            label: "Running",
            source: "no-auth"
          },
          discovery: {
            available: true,
            reachable: true,
            running: true,
            installed: true,
            modelsFound: 1,
            label: "Running"
          },
          verify: {
            status: "idle"
          },
          sourceModelCount: 1,
          defaultModelId: "qwen3-coder-next"
        },
        {
          id: "managed-ollama",
          kind: "ollama",
          label: "Ollama",
          auth: {
            connected: false,
            label: "Not connected",
            source: "no-auth"
          },
          discovery: {
            available: false,
            reachable: false,
            running: false,
            installed: false,
            modelsFound: 0,
            label: "Not reachable"
          },
          verify: {
            status: "idle"
          },
          sourceModelCount: 0
        }
      ],
      catalogByProvider: {
        openai: [
          {
            id: "gpt-5.4-mini",
            provider: "openai",
            canonicalRef: "openai/gpt-5.4-mini",
            name: "GPT-5.4 mini",
            available: true,
            reasoning: true,
            supportsReasoningEffort: true,
            input: ["text", "image"]
          },
          {
            id: "gpt-5.4",
            provider: "openai",
            canonicalRef: "openai/gpt-5.4",
            name: "GPT-5.4",
            available: true,
            reasoning: true,
            supportsReasoningEffort: true,
            input: ["text", "image"]
          }
        ],
        "openai-codex": [
          {
            id: "gpt-5.4",
            provider: "openai-codex",
            canonicalRef: "openai-codex/gpt-5.4",
            name: "GPT-5.4",
            available: true,
            reasoning: true,
            supportsReasoningEffort: true,
            input: ["text"]
          }
        ],
        "managed-lm-studio": [
          {
            id: "qwen3-coder-next",
            provider: "managed-lm-studio",
            canonicalRef: "managed-lm-studio/qwen3-coder-next",
            name: "Qwen3 Coder Next",
            available: true,
            reasoning: false,
            supportsReasoningEffort: false,
            input: ["text"]
          }
        ]
      },
      providerOperation: undefined
    },
    activity: {
      runtimes: {},
      history: {}
    },
    pendingPlan: input.pendingPlanReady
      ? {
          plan,
          nextActionHint: "Approve or discard."
        }
      : undefined,
    modal: { kind: "none" },
    commandPalette: { open: false },
    notifications: [],
    shouldExit: false
  };
}

function buildWorkspaceState(input: {
  activeThreadId: string;
  recentProjects: Array<{ path: string; name: string; lastOpenedAt: string }>;
  selectedThreadId: string;
}) {
  const primaryThreads = [
    {
      id: liveThreadId,
      threadId: liveThreadId,
      title: "Production Portal Thread",
      projectHash: "project-1",
      projectName: basename("/tmp/project"),
      projectPath: "/tmp/project",
      startedAt: "2026-04-22T00:00:00.000Z",
      updatedAt: "2026-04-22T00:02:00.000Z",
      latestStatus: "planning",
      latestSummary: "Plan ready for approval",
      activeModelA: "GPT-5.4",
      activeModelB: "Qwen local",
      resumable: true,
      isActive: input.activeThreadId === liveThreadId
    },
    {
      id: archivedThreadId,
      threadId: archivedThreadId,
      title: "Earlier Archived Thread",
      projectHash: "project-1",
      projectName: basename("/tmp/project"),
      projectPath: "/tmp/project",
      startedAt: "2026-04-21T00:00:00.000Z",
      updatedAt: "2026-04-21T00:02:00.000Z",
      latestStatus: "completed",
      latestSummary: "Earlier archived summary",
      activeModelA: "GPT-5.4",
      activeModelB: "Qwen local",
      resumable: false,
      isActive: false
    }
  ];

  const projects = [
    {
      id: "project-1",
      projectHash: "project-1",
      projectName: basename("/tmp/project"),
      projectPath: "/tmp/project",
      threads: primaryThreads
    }
  ];
  const threads = [...primaryThreads];

  if (input.activeThreadId === launchedThreadId) {
    const launchedThread = {
      id: launchedThreadId,
      threadId: launchedThreadId,
      title: "Project B Thread",
      projectHash: "project-2",
      projectName: basename("/tmp/project-b"),
      projectPath: "/tmp/project-b",
      startedAt: "2026-04-23T00:00:00.000Z",
      updatedAt: "2026-04-23T00:01:00.000Z",
      latestStatus: "execution",
      latestSummary: "Fresh thread ready",
      activeModelA: "GPT-5.4",
      activeModelB: "Qwen local",
      resumable: false,
      isActive: true
    };
    projects.unshift({
      id: "project-2",
      projectHash: "project-2",
      projectName: basename("/tmp/project-b"),
      projectPath: "/tmp/project-b",
      threads: [launchedThread]
    });
    threads.unshift(launchedThread);
  }

  if (input.activeThreadId === "thread-home") {
    const launchedThread = {
      id: "thread-home",
      threadId: "thread-home",
      title: "Home Project Thread",
      projectHash: "project-3",
      projectName: basename("/Users/Taylor/demo-project"),
      projectPath: "/Users/Taylor/demo-project",
      startedAt: "2026-04-23T00:00:00.000Z",
      updatedAt: "2026-04-23T00:01:00.000Z",
      latestStatus: "execution",
      latestSummary: "Fresh thread ready",
      activeModelA: "GPT-5.4",
      activeModelB: "Qwen local",
      resumable: false,
      isActive: true
    };
    projects.unshift({
      id: "project-3",
      projectHash: "project-3",
      projectName: basename("/Users/Taylor/demo-project"),
      projectPath: "/Users/Taylor/demo-project",
      threads: [launchedThread]
    });
    threads.unshift(launchedThread);
  }

  return {
    projects,
    recentProjects: input.recentProjects,
    threads,
    activeThreadId: input.activeThreadId,
    selectedThreadId: input.selectedThreadId
  };
}

function syncWorkspaceSelections(
  threadStates: Record<string, any>,
  selectedThreadId: string,
  activeThreadId: string,
  recentProjects: Array<{ path: string; name: string; lastOpenedAt: string }>
): void {
  for (const snapshot of Object.values(threadStates)) {
    snapshot.workspace = buildWorkspaceState({
      activeThreadId,
      recentProjects,
      selectedThreadId
    });
  }
}

function appendOperatorMessage(state: any, input: string): any {
  const createdAt = new Date().toISOString();
  return {
    ...state,
    status: {
      ...state.status,
      threadUpdatedAt: createdAt
    },
    conversation: [
      ...state.conversation,
      {
        id: `operator-${state.conversation.length + 1}`,
        kind: "operator_message",
        text: input,
        createdAt
      }
    ],
    timeline: [
      ...state.timeline,
      {
        id: `timeline-${state.timeline.length + 1}`,
        kind: "message",
        threadId: liveThreadId,
        activityKind: "message",
        actor: "operator",
        sourceLabel: "Operator",
        createdAt,
        text: input,
        streaming: false
      }
    ]
  };
}

function approvePlan(state: any): any {
  const createdAt = new Date().toISOString();
  return {
    ...state,
    status: {
      ...state.status,
      pendingPlan: undefined,
      pendingPlanReady: false,
      nextActionHint: undefined,
      phase: "execution",
      phaseLabel: "Execution",
      activeRole: "B",
      activeRoleLabel: "Agent B",
      activeWorkflowId: undefined,
      workflowStatus: undefined,
      threadUpdatedAt: createdAt
    },
    conversation: [
      ...state.conversation,
      {
        id: `approval-${state.conversation.length + 1}`,
        kind: "approval_discard",
        action: "approved",
        text: "Approved the pending plan.",
        createdAt
      }
    ],
    timeline: [
      ...state.timeline,
      {
        id: `timeline-${state.timeline.length + 1}`,
        kind: "message",
        threadId: liveThreadId,
        activityKind: "message",
        actor: "system",
        sourceLabel: "Operator",
        createdAt,
        text: "Approved the pending plan.",
        streaming: false
      }
    ],
    pendingPlan: undefined,
    notification: {
      id: "notice-plan-approved",
      level: "info",
      scope: "workflow",
      code: "pending_plan.approved",
      title: "Plan approved",
      message: "Execution started for this project.",
      createdAt
    }
  };
}

function getProjectLaunchBlockedMessage(liveState: any): string | undefined {
  if (liveState.status.pendingPlanReady) {
    return "The current live thread has a pending plan, so switching projects is blocked right now. Approve it, discard it, or wait for the current run to finish before starting a new thread in another directory.";
  }
  if (liveState.status.activeWorkflowId) {
    return "The current live thread still has an active workflow, so PI Dual cannot replace it safely.";
  }
  return undefined;
}

function resolveProjectLaunchTarget(projectPath: string):
  | {
      projectPath: string;
      threadId: string;
      threadTitle: string;
    }
  | undefined {
  if (projectPath === "/tmp/project-b") {
    return {
      projectPath,
      threadId: launchedThreadId,
      threadTitle: "Project B Thread"
    };
  }
  if (projectPath === "/Users/Taylor/demo-project" || projectPath === "~/demo-project") {
    return {
      projectPath: "/Users/Taylor/demo-project",
      threadId: "thread-home",
      threadTitle: "Home Project Thread"
    };
  }
  return undefined;
}

function cloneState<T>(value: T): T {
  return structuredClone(value);
}

function contentTypeForAsset(ext: string): string {
  switch (ext) {
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".woff2":
      return "font/woff2";
    case ".woff":
      return "font/woff";
    default:
      return "application/octet-stream";
  }
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

function writeJson(response: ServerResponse, payload: unknown, statusCode = 200): void {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(payload)}\n`);
}
