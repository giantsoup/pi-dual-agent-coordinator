import type { ReactElement } from "react";
import { Copy, Lock, RefreshCw, Unlock, Wifi, WifiOff } from "lucide-react";

import type { InteractiveUiState } from "../../../../src/types/ui.js";
import type { PortalBootstrapConfigDto, PortalControllerLockSnapshot } from "../../../../src/app/portal/protocol.js";
import { ActorMarker, Badge, Button, StatusDot, Toolbar } from "../components/ui.js";
import {
  connectionTone,
  describeConnection,
  summarizeMcp
} from "./format.js";
import type { ConnectionState } from "../state/usePortalSession.js";

export function AppHeader(props: {
  bootstrap: PortalBootstrapConfigDto;
  connectionState: ConnectionState;
  controller: PortalControllerLockSnapshot;
  isController: boolean;
  lastEventId: number;
  onCopyLink(): Promise<void>;
  snapshot: InteractiveUiState | null;
}): ReactElement {
  const snapshot = props.snapshot;
  const status = snapshot?.status;
  const connectionLabel = describeConnection(props.connectionState);
  const lockLabel = !props.controller.locked
    ? "Unlocked"
    : props.isController
      ? "Controller"
      : "Observer";

  return (
    <header className="app-header">
      <div className="app-header__main">
        <div className="section-kicker">pi-dual local web interface</div>
        <div className="path-line" title={status?.cwd ?? ""}>
          {status?.cwd ?? "Connecting to coordinator"}
        </div>
        <div className="app-header__helper">
          {props.bootstrap.startupNotice.message}
        </div>
        <div className="app-header__launch-line" title={props.bootstrap.launchUrl}>
          {props.bootstrap.launchUrl}
        </div>
        <div className="app-header__actions">
          <Button
            icon={<Copy />}
            onClick={() => {
              void props.onCopyLink();
            }}
          >
            Copy link
          </Button>
          <Button
            icon={<RefreshCw />}
            onClick={() => {
              window.open(props.bootstrap.launchUrl, "_blank", "noopener,noreferrer");
            }}
            tone="accent"
          >
            Reconnect with this link
          </Button>
        </div>
        <div className="app-header__helper">
          This link works in any browser on this computer. It does not work over your
          local network or the internet.
        </div>
      </div>
      <Toolbar>
        <Badge tone="accent">{status?.phaseLabel ?? "Starting"}</Badge>
        <Badge>{status?.activeWorkflowId ?? "No workflow"}</Badge>
        <ActorMarker actor={status?.activeRole ?? "unknown"} label={status?.activeRoleLabel ?? "No role"} />
        <Badge>{status?.activeModelDisplay ?? "Model unknown"}</Badge>
        <Badge tone={connectionTone(props.connectionState)}>
          <StatusDot tone={connectionTone(props.connectionState)} />
          {props.connectionState === "offline" ? <WifiOff /> : <Wifi />}
          {connectionLabel}
        </Badge>
        <Badge tone={props.isController || !props.controller.locked ? "success" : "warning"}>
          {props.controller.locked ? <Lock /> : <Unlock />}
          {lockLabel}
        </Badge>
        <Badge tone={snapshot?.pendingPlan ? "warning" : "neutral"}>
          {snapshot?.pendingPlan
            ? "Plan pending"
            : `Review ${status?.repairCount ?? 0}/${status?.maxReviewRounds ?? 0}`}
        </Badge>
        <Badge>Event {props.lastEventId}</Badge>
        <Badge>{summarizeMcp(status?.mcp)}</Badge>
      </Toolbar>
    </header>
  );
}
