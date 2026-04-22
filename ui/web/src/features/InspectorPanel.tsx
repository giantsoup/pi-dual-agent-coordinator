import type { ReactElement } from "react";
import {
  Activity,
  Cpu,
  DatabaseZap,
  Gauge,
  Server,
  Wrench
} from "lucide-react";

import type { InteractiveUiState } from "../../../../src/types/ui.js";
import type { RuntimeStatusSnapshot } from "../../../../src/types/status.js";
import type { RoleMcpStatusSnapshot } from "../../../../src/mcp/types.js";
import { Badge, KeyValueList, SectionHeader, StatusDot, Tabs } from "../components/ui.js";
import {
  formatTime,
  roleLabel,
  runtimeTone,
  summarizeMcpRole
} from "./format.js";
import { PendingPlan } from "./PendingPlan.js";

export function InspectorPanel(props: {
  canMutate: boolean;
  isSubmitting: boolean;
  onApprovePlan(): void;
  onDiscardPlan(): void;
  snapshot: InteractiveUiState | null;
}): ReactElement {
  const snapshot = props.snapshot;
  return (
    <aside className="pane inspector-pane">
      <SectionHeader kicker="Inspector" title="State" />
      {snapshot ? (
        <Tabs
          defaultValue="workflow"
          items={[
            {
              label: "Workflow",
              value: "workflow",
              content: (
                <WorkflowPanel
                  canMutate={props.canMutate}
                  isSubmitting={props.isSubmitting}
                  snapshot={snapshot}
                  onApprovePlan={props.onApprovePlan}
                  onDiscardPlan={props.onDiscardPlan}
                />
              )
            },
            {
              label: "Runtimes",
              value: "runtimes",
              content: <RuntimePanel snapshot={snapshot} />
            },
            {
              label: "MCP",
              value: "mcp",
              content: <McpPanel snapshot={snapshot} />
            },
            {
              label: "Metrics",
              value: "metrics",
              content: <MetricsPanel snapshot={snapshot} />
            }
          ]}
        />
      ) : (
        <div className="empty-state">
          <h3>Loading inspector</h3>
          <p>Waiting for the first authoritative state snapshot.</p>
        </div>
      )}
    </aside>
  );
}

export function WorkflowPanel(props: {
  canMutate: boolean;
  isSubmitting: boolean;
  onApprovePlan(): void;
  onDiscardPlan(): void;
  snapshot: InteractiveUiState;
}): ReactElement {
  const { snapshot } = props;
  const status = snapshot.status;
  return (
    <div className="inspector-stack">
      <KeyValueList
        rows={[
          ["Workflow", status.activeWorkflowId ?? "Idle"],
          ["Phase", status.phaseLabel],
          ["Mode", status.conversationMode],
          ["Status", status.workflowStatus ?? "idle"],
          ["Iteration", String(status.currentIteration ?? 0)],
          ["Project", status.cwd],
          ["Sessions", status.sessionRoot]
        ]}
      />
      {status.currentActivity || status.currentTarget || status.currentReason ? (
        <ActivityBlock
          title="Coordinator Activity"
          lines={[status.currentActivity, status.currentTarget, status.currentReason]}
        />
      ) : null}
      {snapshot.activity.active ? (
        <ActivityBlock
          title="Current Focus"
          lines={[
            snapshot.activity.active.label,
            snapshot.activity.active.target,
            snapshot.activity.active.reason
          ]}
        />
      ) : null}
      {snapshot.pendingPlan ? (
        <PendingPlan
          canMutate={props.canMutate}
          compact={true}
          isSubmitting={props.isSubmitting}
          nextActionHint={snapshot.pendingPlan.nextActionHint}
          plan={snapshot.pendingPlan.plan}
          onApprove={props.onApprovePlan}
          onDiscard={props.onDiscardPlan}
        />
      ) : null}
    </div>
  );
}

export function RuntimePanel(props: {
  snapshot: InteractiveUiState;
}): ReactElement {
  const runtimes = props.snapshot.status.runtimes;
  return (
    <div className="inspector-stack">
      {runtimes.length === 0 ? (
        <div className="empty-state">
          <h3>No active runtimes</h3>
          <p>Runtime health appears after Agent A or Agent B has a bound session.</p>
        </div>
      ) : (
        runtimes.map((runtime) => (
          <RuntimeHealthRow key={runtime.role} runtime={runtime} />
        ))
      )}
      {(["A", "B"] as const).map((role) => {
        const history = props.snapshot.activity.history[role];
        if (!history) {
          return null;
        }
        return (
          <section key={role} className="activity-history">
            <SectionHeader kicker={roleLabel(role)} title="Recent Activity" />
            <KeyValueList
              rows={[
                ["Reads", history.totals.reads],
                ["Searches", history.totals.searches],
                ["Writes", history.totals.writes],
                ["Commands", history.totals.commands],
                ["MCP calls", history.totals.mcpCalls]
              ]}
            />
            {history.recent.map((item) => (
              <ActivityBlock
                key={item.id}
                title={item.status}
                lines={[item.text, item.detail, item.toolName]}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function RuntimeHealthRow(props: { runtime: RuntimeStatusSnapshot }): ReactElement {
  const { runtime } = props;
  return (
    <section className="runtime-row" data-actor={runtime.role}>
      <div className="runtime-row__head">
        <div>
          <div className="section-kicker">{roleLabel(runtime.role)}</div>
          <h3>{runtime.modelDisplay}</h3>
        </div>
        <Badge tone={runtimeTone(runtime)}>
          <StatusDot tone={runtimeTone(runtime)} />
          {runtime.healthy ? "Healthy" : "Degraded"}
        </Badge>
      </div>
      <KeyValueList
        rows={[
          ["Session", runtime.sessionId],
          ["File", runtime.sessionFile ?? "(memory)"],
          ["CWD", runtime.cwd],
          ["Thinking", runtime.thinking],
          ["Last tool", runtime.lastToolName ?? "None"]
        ]}
      />
      {runtime.currentActivity || runtime.currentTarget || runtime.currentReason ? (
        <ActivityBlock
          title="Current Runtime Activity"
          lines={[
            runtime.currentActivity,
            runtime.currentTarget,
            runtime.currentReason
          ]}
        />
      ) : null}
    </section>
  );
}

export function McpPanel(props: {
  snapshot: InteractiveUiState;
}): ReactElement {
  const mcp = props.snapshot.status.mcp;
  if (!mcp) {
    return (
      <div className="empty-state">
        <h3>MCP status unavailable</h3>
        <p>The backend has not reported MCP configuration for this session.</p>
      </div>
    );
  }

  return (
    <div className="inspector-stack">
      <KeyValueList
        rows={[
          ["State", mcp.enabled ? "Enabled" : "Disabled"],
          ["Config sources", mcp.configSources.length ? mcp.configSources.join("\n") : "None"]
        ]}
      />
      <McpRoleSection roleStatus={mcp.roleA} />
      <McpRoleSection roleStatus={mcp.roleB} />
    </div>
  );
}

function McpRoleSection(props: { roleStatus: RoleMcpStatusSnapshot }): ReactElement {
  const { roleStatus } = props;
  return (
    <section className="mcp-role">
      <SectionHeader
        kicker={roleLabel(roleStatus.role)}
        title={summarizeMcpRole(roleStatus)}
        actions={<Badge tone={roleStatus.enabled ? "success" : "neutral"}>Read only</Badge>}
      />
      {roleStatus.servers.length === 0 ? (
        <div className="empty-state compact">
          <p>No MCP servers are visible to this role.</p>
        </div>
      ) : (
        roleStatus.servers.map((server) => (
          <section key={server.name} className="mcp-server">
            <div className="mcp-server__head">
              <strong>{server.name}</strong>
              <Badge tone={server.connected ? "success" : "warning"}>
                <StatusDot tone={server.connected ? "success" : "warning"} />
                {server.connected ? "Connected" : "Disconnected"}
              </Badge>
            </div>
            <KeyValueList
              rows={[
                ["Transport", server.transport],
                ["Direct tools", String(server.directTools.length)],
                ["Metadata sync", formatTime(server.lastMetadataSync)],
                ["Last error", server.lastError ?? "None"]
              ]}
            />
          </section>
        ))
      )}
    </section>
  );
}

export function MetricsPanel(props: {
  snapshot: InteractiveUiState;
}): ReactElement {
  const metrics = Object.entries(props.snapshot.status.metrics);
  return (
    <div className="metrics-grid">
      {metrics.length === 0 ? (
        <div className="empty-state">
          <h3>No metrics yet</h3>
          <p>Coordinator counters appear here as workflow activity is reported.</p>
        </div>
      ) : (
        metrics.map(([key, value]) => (
          <div key={key} className="metric-cell">
            <div className="metric-cell__icon">
              <MetricIcon metric={key} />
            </div>
            <dt>{key}</dt>
            <dd>{value}</dd>
          </div>
        ))
      )}
    </div>
  );
}

function MetricIcon(props: { metric: string }): ReactElement {
  const metric = props.metric.toLowerCase();
  if (metric.includes("tool") || metric.includes("mcp")) {
    return <Wrench />;
  }
  if (metric.includes("runtime") || metric.includes("model")) {
    return <Cpu />;
  }
  if (metric.includes("session")) {
    return <DatabaseZap />;
  }
  if (metric.includes("health")) {
    return <Gauge />;
  }
  if (metric.includes("server")) {
    return <Server />;
  }
  return <Activity />;
}

function ActivityBlock(props: {
  lines: Array<string | undefined>;
  title: string;
}): ReactElement {
  const lines = props.lines.filter(Boolean) as string[];
  return (
    <section className="activity-block">
      <div className="section-kicker">{props.title}</div>
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </section>
  );
}
