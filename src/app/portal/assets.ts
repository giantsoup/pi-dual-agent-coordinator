import type { PortalBootstrapConfigDto } from "./protocol.js";

export const PORTAL_APP_CSS = `
:root {
  color-scheme: light;
  font-family: "SF Mono", "Consolas", "Liberation Mono", monospace;
  --bg: #f4f1e8;
  --panel: #fffdf8;
  --panel-border: #d5ccb8;
  --ink: #1d1a15;
  --muted: #645a48;
  --accent: #0f766e;
  --accent-soft: #d8f1ee;
  --warning: #b45309;
  --warning-soft: #ffedd5;
  --danger: #b42318;
  --danger-soft: #fee4e2;
  --shadow: 0 20px 50px rgba(29, 26, 21, 0.12);
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  min-height: 100%;
  background:
    radial-gradient(circle at top left, rgba(15, 118, 110, 0.10), transparent 34%),
    linear-gradient(180deg, #f7f4ec 0%, #ece5d7 100%);
  color: var(--ink);
}

body {
  min-height: 100vh;
}

.app-shell {
  width: min(1440px, calc(100vw - 32px));
  margin: 0 auto;
  padding: 20px 0 24px;
}

.header {
  display: grid;
  gap: 12px;
  padding: 18px 20px;
  background: rgba(255, 253, 248, 0.88);
  border: 1px solid rgba(213, 204, 184, 0.9);
  border-radius: 22px;
  box-shadow: var(--shadow);
  backdrop-filter: blur(12px);
}

.header-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
}

.title {
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--muted);
}

.headline {
  font-size: 24px;
  line-height: 1.2;
  font-weight: 700;
}

.badge-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--panel-border);
  background: rgba(255, 253, 248, 0.92);
  font-size: 12px;
  color: var(--muted);
}

.badge[data-tone="accent"] {
  border-color: rgba(15, 118, 110, 0.25);
  background: var(--accent-soft);
  color: #0b5b56;
}

.badge[data-tone="warning"] {
  border-color: rgba(180, 83, 9, 0.20);
  background: var(--warning-soft);
  color: var(--warning);
}

.badge[data-tone="danger"] {
  border-color: rgba(180, 35, 24, 0.20);
  background: var(--danger-soft);
  color: var(--danger);
}

.notification {
  padding: 12px 14px;
  border-radius: 16px;
  border: 1px solid rgba(15, 118, 110, 0.18);
  background: rgba(216, 241, 238, 0.75);
  color: #0b5b56;
  white-space: pre-wrap;
}

.notification[data-tone="error"] {
  border-color: rgba(180, 35, 24, 0.18);
  background: rgba(254, 228, 226, 0.9);
  color: var(--danger);
}

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(320px, 0.9fr);
  gap: 18px;
  margin-top: 18px;
}

.panel {
  background: rgba(255, 253, 248, 0.92);
  border: 1px solid rgba(213, 204, 184, 0.92);
  border-radius: 22px;
  box-shadow: var(--shadow);
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px 0;
}

.panel-title {
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--muted);
}

.panel-body {
  padding: 18px;
}

.transcript {
  display: grid;
  gap: 14px;
}

.entry {
  display: grid;
  gap: 8px;
  padding: 14px 16px;
  border-radius: 18px;
  border: 1px solid rgba(213, 204, 184, 0.92);
  background: rgba(255, 255, 255, 0.7);
}

.entry[data-kind="operator_message"] {
  background: rgba(15, 118, 110, 0.08);
  border-color: rgba(15, 118, 110, 0.18);
}

.entry[data-kind="plan_ready"] {
  background: rgba(180, 83, 9, 0.08);
  border-color: rgba(180, 83, 9, 0.16);
}

.entry[data-kind="error"] {
  background: rgba(254, 228, 226, 0.9);
  border-color: rgba(180, 35, 24, 0.18);
}

.entry-meta {
  font-size: 12px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.entry-text,
.code-block {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.55;
}

.sidebar {
  display: grid;
  gap: 18px;
}

.stack {
  display: grid;
  gap: 12px;
}

.key-value {
  display: grid;
  gap: 8px;
}

.key-value-row {
  display: grid;
  grid-template-columns: minmax(96px, 120px) minmax(0, 1fr);
  gap: 12px;
  font-size: 13px;
  align-items: start;
}

.key {
  color: var(--muted);
}

.runtime-card,
.activity-card {
  display: grid;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 16px;
  border: 1px solid rgba(213, 204, 184, 0.92);
  background: rgba(255, 255, 255, 0.65);
}

.controls {
  margin-top: 18px;
  padding: 18px;
  background: rgba(255, 253, 248, 0.94);
  border: 1px solid rgba(213, 204, 184, 0.92);
  border-radius: 22px;
  box-shadow: var(--shadow);
}

.control-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.button {
  border: 1px solid rgba(29, 26, 21, 0.12);
  border-radius: 14px;
  background: #fffdf8;
  color: var(--ink);
  padding: 10px 14px;
  font: inherit;
  cursor: pointer;
  transition: transform 120ms ease, border-color 120ms ease, background 120ms ease;
}

.button:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: rgba(15, 118, 110, 0.35);
  background: rgba(216, 241, 238, 0.55);
}

.button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.button[data-tone="primary"] {
  border-color: rgba(15, 118, 110, 0.3);
  background: var(--accent);
  color: #f8fffe;
}

.button[data-tone="danger"] {
  border-color: rgba(180, 35, 24, 0.2);
  background: rgba(254, 228, 226, 0.92);
  color: var(--danger);
}

.composer {
  display: grid;
  gap: 12px;
  margin-top: 14px;
}

.composer textarea {
  width: 100%;
  min-height: 128px;
  resize: vertical;
  padding: 14px 16px;
  border-radius: 18px;
  border: 1px solid rgba(213, 204, 184, 0.92);
  background: rgba(255, 255, 255, 0.75);
  color: var(--ink);
  font: inherit;
}

.composer-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
}

.hint {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.4;
}

@media (max-width: 1024px) {
  .layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .app-shell {
    width: min(100vw - 16px, 1440px);
    padding-top: 10px;
  }

  .header,
  .panel,
  .controls {
    border-radius: 18px;
  }

  .panel-body,
  .controls {
    padding: 14px;
  }
}
`;

export function renderPortalIndexHtml(
  bootstrap: PortalBootstrapConfigDto,
  cspNonce: string
): string {
  const configJson = JSON.stringify(bootstrap);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <title>pi-dual portal</title>
    <link rel="stylesheet" href="/assets/portal.css" />
    <script nonce="${cspNonce}">window.__PI_DUAL_PORTAL__ = ${configJson};</script>
    <script type="module" src="/assets/portal.js"></script>
  </head>
  <body>
    <div class="app-shell">
      <header class="header">
        <div class="header-row">
          <div>
            <div class="title">pi-dual localhost portal</div>
            <div class="headline" id="headline">Connecting to coordinator...</div>
          </div>
          <div class="badge-row" id="header-badges"></div>
        </div>
        <div class="notification" id="notification" hidden></div>
      </header>
      <main class="layout">
        <section class="panel">
          <div class="panel-header">
            <div class="panel-title">Transcript</div>
            <div class="badge-row" id="transcript-badges"></div>
          </div>
          <div class="panel-body">
            <div class="transcript" id="transcript"></div>
          </div>
        </section>
        <aside class="sidebar">
          <section class="panel">
            <div class="panel-header">
              <div class="panel-title">Status</div>
            </div>
            <div class="panel-body stack" id="status-panel"></div>
          </section>
          <section class="panel">
            <div class="panel-header">
              <div class="panel-title">Activity</div>
            </div>
            <div class="panel-body stack" id="activity-panel"></div>
          </section>
        </aside>
      </main>
      <section class="controls">
        <div class="control-row" id="command-row"></div>
        <form class="composer" id="composer-form">
          <textarea id="composer-input" placeholder="Send a prompt or type a slash command like /status or /approve"></textarea>
          <div class="composer-footer">
            <div class="hint" id="composer-hint">Opening the controller stream...</div>
            <button class="button" data-tone="primary" id="submit-button" type="submit">Send</button>
          </div>
        </form>
      </section>
    </div>
  </body>
</html>`;
}

export const PORTAL_APP_JS = `
const bootstrap = window.__PI_DUAL_PORTAL__;

if (!bootstrap || !bootstrap.authToken || !bootstrap.controllerId) {
  throw new Error("Missing portal bootstrap configuration.");
}

const stateModel = {
  snapshot: undefined,
  controller: { locked: false, controllerId: undefined },
  connected: false,
  lastMessage: "",
  reconnecting: false
};

const elements = {
  headline: document.getElementById("headline"),
  notification: document.getElementById("notification"),
  headerBadges: document.getElementById("header-badges"),
  transcriptBadges: document.getElementById("transcript-badges"),
  transcript: document.getElementById("transcript"),
  statusPanel: document.getElementById("status-panel"),
  activityPanel: document.getElementById("activity-panel"),
  commandRow: document.getElementById("command-row"),
  composerForm: document.getElementById("composer-form"),
  composerInput: document.getElementById("composer-input"),
  composerHint: document.getElementById("composer-hint"),
  submitButton: document.getElementById("submit-button")
};

const commandButtons = [
  { label: "Help", action: { type: "open_help" } },
  { label: "Status", action: { type: "open_status" } },
  { label: "Sessions", action: { type: "open_sessions" } },
  { label: "Handoff", action: { type: "open_handoff" } },
  { label: "Approve Plan", action: { type: "approve_pending_plan" } },
  { label: "Discard Plan", action: { type: "discard_pending_plan" } },
  { label: "Quit", tone: "danger", action: { type: "quit" } }
];

for (const item of commandButtons) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button";
  if (item.tone) {
    button.dataset.tone = item.tone;
  }
  button.textContent = item.label;
  button.addEventListener("click", () => {
    void dispatchAction(item.action);
  });
  elements.commandRow.appendChild(button);
}

elements.composerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = elements.composerInput.value.trim();
  if (!text) {
    return;
  }
  void dispatchAction({
    type: "submit_input",
    input: text
  }, { clearComposer: true });
});

void initialize();

async function initialize() {
  try {
    await loadSnapshot();
    connectEvents();
  } catch (error) {
    stateModel.lastMessage = error instanceof Error ? error.message : String(error);
    render();
  }
}

async function loadSnapshot() {
  const response = await fetch(withToken("/api/state"), {
    cache: "no-store",
    credentials: "same-origin"
  });

  if (!response.ok) {
    throw new Error("Failed to load initial portal state.");
  }

  const dto = await response.json();
  applySnapshot(dto.state, dto.controller);
}

function connectEvents() {
  const source = new EventSource(withToken("/api/events", {
    controllerId: bootstrap.controllerId
  }));

  source.onopen = () => {
    stateModel.connected = true;
    stateModel.reconnecting = false;
    render();
  };

  source.onmessage = (message) => {
    stateModel.connected = true;
    stateModel.reconnecting = false;
    const dto = JSON.parse(message.data);
    applySnapshot(dto.event.state, dto.controller);
  };

  source.onerror = () => {
    stateModel.connected = false;
    stateModel.reconnecting = true;
    render();
  };

  window.addEventListener("beforeunload", () => {
    source.close();
  });
}

async function dispatchAction(action, options) {
  if (!canMutate()) {
    stateModel.lastMessage = "Another tab currently holds the controller lock.";
    render();
    return;
  }

  setComposerEnabled(false);

  try {
    const response = await fetch("/api/actions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + bootstrap.authToken
      },
      cache: "no-store",
      credentials: "same-origin",
      body: JSON.stringify({
        controllerId: bootstrap.controllerId,
        action
      })
    });

    const dto = await response.json();
    if (dto && dto.state && dto.controller) {
      applySnapshot(dto.state, dto.controller);
    }

    if (!response.ok) {
      stateModel.lastMessage = dto && dto.error ? dto.error : "Request failed.";
      render();
      return;
    }

    if (!dto.accepted) {
      stateModel.lastMessage = dto.error || "Action was rejected.";
      render();
      return;
    }

    stateModel.lastMessage = "";
    if (options && options.clearComposer) {
      elements.composerInput.value = "";
    }
  } catch (error) {
    stateModel.lastMessage = error instanceof Error ? error.message : String(error);
    render();
  } finally {
    setComposerEnabled(canMutate());
  }
}

function applySnapshot(snapshot, controller) {
  stateModel.snapshot = snapshot;
  stateModel.controller = controller;
  render();
}

function render() {
  const snapshot = stateModel.snapshot;
  if (!snapshot) {
    elements.headline.textContent = stateModel.lastMessage
      ? "Portal unavailable"
      : "Loading portal state...";
    if (stateModel.lastMessage) {
      elements.notification.hidden = false;
      elements.notification.textContent = stateModel.lastMessage;
      elements.notification.dataset.tone = "error";
    } else {
      elements.notification.hidden = true;
      elements.notification.textContent = "";
      delete elements.notification.dataset.tone;
    }
    return;
  }

  const isController = stateModel.controller.controllerId === bootstrap.controllerId;
  const canEdit = canMutate();
  const status = snapshot.status;

  elements.headline.textContent =
    status.activeWorkflowId
      ? "Workflow " + status.activeWorkflowId + " in " + status.phaseLabel
      : "Coordinator in " + status.phaseLabel;

  replaceChildren(elements.headerBadges, [
    renderBadge("Phase " + status.phaseLabel, "accent"),
    renderBadge("Role " + status.activeRoleLabel),
    renderBadge(status.activeModelDisplay),
    renderBadge(renderControllerLabel(isController), isController ? "accent" : canEdit ? "warning" : "danger"),
    renderBadge(stateModel.connected ? "Events live" : stateModel.reconnecting ? "Reconnecting" : "Disconnected", stateModel.connected ? "accent" : "warning")
  ]);

  replaceChildren(elements.transcriptBadges, [
    renderBadge(snapshot.pendingPlan ? "Plan ready" : "No pending plan", snapshot.pendingPlan ? "warning" : undefined),
    renderBadge("Repairs " + status.repairCount + "/" + status.maxReviewRounds),
    renderBadge("Mode " + status.conversationMode)
  ]);

  renderNotification(snapshot, canEdit);
  renderTranscript(snapshot);
  renderStatus(snapshot);
  renderActivity(snapshot);

  elements.composerHint.textContent = canEdit
    ? "You can send prompts and coordinator actions from this tab."
    : stateModel.controller.locked
      ? "Read-only while another tab controls the portal."
      : "The controller lock is open. Your next action will claim it.";

  setComposerEnabled(canEdit);
}

function renderNotification(snapshot, canEdit) {
  const message = snapshot.lastError
    ? snapshot.lastError.message
    : stateModel.lastMessage || (snapshot.notification ? snapshot.notification.message : "");
  const tone = snapshot.lastError ? "error" : "info";

  if (!message) {
    elements.notification.hidden = true;
    elements.notification.textContent = "";
    delete elements.notification.dataset.tone;
    return;
  }

  elements.notification.hidden = false;
  elements.notification.textContent = message + (canEdit ? "" : "\\nThis tab is currently observing only.");
  elements.notification.dataset.tone = tone;
}

function renderTranscript(snapshot) {
  const nodes = [];

  if (!snapshot.conversation.length && !snapshot.liveStream) {
    const empty = document.createElement("div");
    empty.className = "entry";
    const meta = document.createElement("div");
    meta.className = "entry-meta";
    meta.textContent = "No transcript yet";
    const text = document.createElement("p");
    text.className = "entry-text";
    text.textContent = "Start with a planning request or a slash command.";
    empty.append(meta, text);
    nodes.push(empty);
  }

  for (const entry of snapshot.conversation) {
    nodes.push(renderEntry(entry.kind, labelForEntry(entry.kind), entry.text, entry.createdAt));
  }

  if (snapshot.liveStream) {
    nodes.push(
      renderEntry(
        "assistant_planning_response",
        "Streaming " + snapshot.liveStream.role,
        snapshot.liveStream.text || "...",
        snapshot.liveStream.startedAt
      )
    );
  }

  replaceChildren(elements.transcript, nodes);
}

function renderStatus(snapshot) {
  const status = snapshot.status;
  const nodes = [];

  nodes.push(renderKeyValueCard("Coordinator", [
    ["Project", status.cwd],
    ["Session root", status.sessionRoot],
    ["Workflow", status.activeWorkflowId || "idle"],
    ["Iteration", status.currentIteration ? String(status.currentIteration) : "n/a"],
    ["Workflow state", status.workflowStatus || "idle"],
    ["Active model", status.activeModelDisplay],
    ["Next action", status.nextActionHint || "n/a"]
  ]));

  if (snapshot.pendingPlan) {
    const card = document.createElement("div");
    card.className = "runtime-card";
    const title = document.createElement("div");
    title.className = "entry-meta";
    title.textContent = "Pending plan";
    const text = document.createElement("pre");
    text.className = "code-block";
    text.textContent = snapshot.pendingPlan.plan.summary + "\\n\\n" +
      "Objective: " + snapshot.pendingPlan.plan.objective + "\\n" +
      "Acceptance: " + snapshot.pendingPlan.plan.acceptanceCriteria.join("\\n- ").replace(/^/, "- ") + "\\n" +
      "Paths: " + snapshot.pendingPlan.plan.relevantPaths.join(", ");
    card.append(title, text);
    nodes.push(card);
  }

  for (const runtime of status.runtimes) {
    nodes.push(renderKeyValueCard("Runtime " + runtime.role, [
      ["Session", runtime.sessionId],
      ["Model", runtime.modelDisplay],
      ["Healthy", runtime.healthy ? "yes" : "no"],
      ["Thinking", runtime.thinking],
      ["Activity", runtime.currentActivity || "idle"],
      ["Reason", runtime.currentReason || "n/a"]
    ]));
  }

  replaceChildren(elements.statusPanel, nodes);
}

function renderActivity(snapshot) {
  const nodes = [];

  if (snapshot.activity.coordinator) {
    nodes.push(renderActivityCard("Coordinator", snapshot.activity.coordinator));
  }

  const runtimeKeys = Object.keys(snapshot.activity.runtimes).sort();
  for (const key of runtimeKeys) {
    const activity = snapshot.activity.runtimes[key];
    if (activity) {
      nodes.push(renderActivityCard("Runtime " + key, activity));
    }
  }

  if (!nodes.length) {
    const idle = document.createElement("div");
    idle.className = "activity-card";
    idle.textContent = "No live activity is being reported right now.";
    nodes.push(idle);
  }

  replaceChildren(elements.activityPanel, nodes);
}

function renderEntry(kind, label, text, timestamp) {
  const entry = document.createElement("article");
  entry.className = "entry";
  entry.dataset.kind = kind;

  const meta = document.createElement("div");
  meta.className = "entry-meta";
  meta.textContent = label + " · " + formatTimestamp(timestamp);

  const body = document.createElement("pre");
  body.className = "entry-text";
  body.textContent = text;

  entry.append(meta, body);
  return entry;
}

function renderActivityCard(label, activity) {
  const card = document.createElement("div");
  card.className = "activity-card";
  card.appendChild(renderMeta(label));

  const details = [
    activity.activity ? "Activity: " + activity.activity : "",
    activity.reason ? "Reason: " + activity.reason : "",
    activity.target ? "Target: " + activity.target : "",
    activity.toolName ? "Tool: " + activity.toolName : ""
  ].filter(Boolean).join("\\n");

  const body = document.createElement("pre");
  body.className = "code-block";
  body.textContent = details || "No structured activity details.";
  card.appendChild(body);
  return card;
}

function renderKeyValueCard(title, rows) {
  const card = document.createElement("div");
  card.className = "runtime-card";
  card.appendChild(renderMeta(title));

  const wrapper = document.createElement("div");
  wrapper.className = "key-value";
  for (const row of rows) {
    const item = document.createElement("div");
    item.className = "key-value-row";
    const key = document.createElement("div");
    key.className = "key";
    key.textContent = row[0];
    const value = document.createElement("div");
    value.textContent = row[1];
    item.append(key, value);
    wrapper.appendChild(item);
  }
  card.appendChild(wrapper);
  return card;
}

function renderMeta(text) {
  const meta = document.createElement("div");
  meta.className = "entry-meta";
  meta.textContent = text;
  return meta;
}

function renderBadge(text, tone) {
  const badge = document.createElement("div");
  badge.className = "badge";
  badge.textContent = text;
  if (tone) {
    badge.dataset.tone = tone;
  }
  return badge;
}

function replaceChildren(node, children) {
  node.replaceChildren(...children);
}

function renderControllerLabel(isController) {
  if (isController) {
    return "Controller";
  }
  if (stateModel.controller.locked) {
    return "Observer";
  }
  return "Lock open";
}

function labelForEntry(kind) {
  switch (kind) {
    case "operator_message":
      return "Operator";
    case "assistant_planning_response":
      return "Assistant";
    case "workflow_summary":
      return "Workflow";
    case "plan_ready":
      return "Plan ready";
    case "approval_discard":
      return "Approval";
    case "runtime_session":
      return "Runtime";
    case "error":
      return "Error";
    default:
      return "Entry";
  }
}

function formatTimestamp(value) {
  if (!value) {
    return "now";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString();
}

function canMutate() {
  return !stateModel.controller.locked || stateModel.controller.controllerId === bootstrap.controllerId;
}

function setComposerEnabled(enabled) {
  elements.composerInput.disabled = !enabled;
  elements.submitButton.disabled = !enabled;
  const buttons = elements.commandRow.querySelectorAll("button");
  for (const button of buttons) {
    button.disabled = !enabled;
  }
}

function withToken(path, extraQuery) {
  const url = new URL(path, window.location.origin);
  url.searchParams.set("token", bootstrap.authToken);
  if (extraQuery) {
    for (const key of Object.keys(extraQuery)) {
      url.searchParams.set(key, extraQuery[key]);
    }
  }
  return url.toString();
}
`;
