import type { RuntimeStatusSnapshot } from "../../../../src/types/status.js";
import type { Role } from "../../../../src/types/role.js";
import type { UiConversationEntry } from "../../../../src/types/ui.js";
import type { CoordinatorMcpStatusSnapshot, RoleMcpStatusSnapshot } from "../../../../src/mcp/types.js";
import type { Actor, Tone } from "../components/ui.js";
import type { ConnectionState } from "../state/usePortalSession.js";

const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit"
});

export function actorForRole(role: Role | undefined): Actor {
  if (role === "A" || role === "B") {
    return role;
  }
  return "unknown";
}

export function actorForConversation(entry: UiConversationEntry): Actor {
  switch (entry.kind) {
    case "assistant_planning_response":
      return actorForRole(entry.role);
    case "operator_message":
    case "workflow_summary":
    case "plan_ready":
    case "approval_discard":
    case "runtime_session":
      return "coordinator";
    case "error":
      return "unknown";
  }
}

export function conversationLabel(entry: UiConversationEntry): string {
  switch (entry.kind) {
    case "operator_message":
      return "Operator";
    case "assistant_planning_response":
      return `Agent ${entry.role}`;
    case "workflow_summary":
      return "Workflow";
    case "plan_ready":
      return "Pending Plan";
    case "approval_discard":
      return "Operator Decision";
    case "runtime_session":
      return `Agent ${entry.role} Session`;
    case "error":
      return "Error";
  }
}

export function formatTime(timestamp: string | undefined): string {
  if (!timestamp) {
    return "n/a";
  }
  const date = new Date(timestamp);
  return Number.isNaN(date.valueOf()) ? timestamp : TIME_FORMATTER.format(date);
}

export function connectionTone(connectionState: ConnectionState): Tone {
  switch (connectionState) {
    case "connected":
      return "success";
    case "connecting":
      return "neutral";
    case "reconnecting":
      return "warning";
    case "offline":
      return "danger";
  }
}

export function describeConnection(connectionState: ConnectionState): string {
  switch (connectionState) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting";
    case "reconnecting":
      return "Reconnecting";
    case "offline":
      return "Offline";
  }
}

export function runtimeTone(runtime: RuntimeStatusSnapshot): Tone {
  return runtime.healthy ? "success" : "danger";
}

export function roleLabel(role: Role): string {
  return role === "A" ? "Agent A" : "Agent B";
}

export function summarizeMcpRole(roleStatus: RoleMcpStatusSnapshot): string {
  const connected = roleStatus.servers.filter((server) => server.connected).length;
  const totalTools = roleStatus.servers.reduce(
    (count, server) => count + server.directTools.length,
    0
  );
  if (!roleStatus.enabled) {
    return "Disabled";
  }
  return `${connected}/${roleStatus.servers.length} connected, ${totalTools} direct tools`;
}

export function summarizeMcp(status: CoordinatorMcpStatusSnapshot | undefined): string {
  if (!status?.enabled) {
    return "MCP disabled";
  }
  return `A: ${summarizeMcpRole(status.roleA)} · B: ${summarizeMcpRole(status.roleB)}`;
}
