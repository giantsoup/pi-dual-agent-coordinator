import type { ReactElement } from "react";
import {
  Folder,
  Menu,
  ScrollText,
  Settings2,
  Share2,
  SquareTerminal
} from "lucide-react";

import type { InteractiveUiState, UiAction } from "../../../../src/types/ui.js";
import { Badge, Button } from "../components/ui.js";

export function ThreadHeader(props: {
  canOpenUtilities: boolean;
  canMutate: boolean;
  isLiveThread: boolean;
  onAction(action: UiAction): Promise<boolean>;
  onOpenSidebar(): void;
  snapshot: InteractiveUiState;
}): ReactElement {
  const thread = props.snapshot.workspace.threads.find(
    (entry) => entry.threadId === props.snapshot.workspace.selectedThreadId
  );

  return (
    <header className="thread-header">
      <div className="thread-header__main">
        <button
          aria-label="Open workspace sidebar"
          className="thread-header__menu"
          type="button"
          onClick={props.onOpenSidebar}
        >
          <Menu />
        </button>
        <div className="thread-header__copy">
          <div className="workspace-eyebrow">Unified Thread</div>
          <h2>{thread?.title ?? props.snapshot.status.threadTitle}</h2>
          <div className="thread-header__path">
            <Folder />
            <span>{props.snapshot.status.cwd}</span>
          </div>
        </div>
      </div>

      <div className="thread-header__meta">
        <Badge tone={props.isLiveThread ? "accent" : "neutral"}>
          {props.isLiveThread ? "Live thread" : "History view"}
        </Badge>
        <Badge>{props.snapshot.status.phaseLabel}</Badge>
        {props.snapshot.status.activeWorkflowId ? (
          <Badge tone="warning">{props.snapshot.status.workflowStatus ?? "running"}</Badge>
        ) : null}
        <Badge>Agent A {props.snapshot.status.runtimes.find((runtime) => runtime.role === "A")?.modelDisplay ?? "n/a"}</Badge>
        <Badge>Agent B {props.snapshot.status.runtimes.find((runtime) => runtime.role === "B")?.modelDisplay ?? "n/a"}</Badge>
      </div>

      <div className="thread-header__actions">
        <Button
          disabled={!props.canOpenUtilities}
          icon={<Settings2 />}
          onClick={() => {
            void props.onAction({
              type: "open_settings",
              scope: props.isLiveThread ? "thread" : "project"
            });
          }}
        >
          Settings
        </Button>
        <Button
          disabled={!props.canOpenUtilities}
          icon={<SquareTerminal />}
          onClick={() => {
            void props.onAction({ type: "open_status" });
          }}
        >
          Status
        </Button>
        <Button
          disabled={!props.canOpenUtilities}
          icon={<Share2 />}
          onClick={() => {
            void props.onAction({ type: "open_handoff" });
          }}
        >
          Handoff
        </Button>
        <Button
          disabled={!props.canOpenUtilities}
          icon={<ScrollText />}
          onClick={() => {
            void props.onAction({ type: "open_sessions" });
          }}
        >
          Sessions
        </Button>
      </div>
    </header>
  );
}
