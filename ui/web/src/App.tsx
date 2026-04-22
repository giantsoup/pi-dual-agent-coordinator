import {
  useDeferredValue,
  useEffect,
  useEffectEvent,
  type ReactElement
} from "react";

import type { UiAction, UiConversationEntry } from "../../../src/types/ui.js";
import { NoticeBanner, SplitPane } from "./components/ui.js";
import { AppHeader } from "./features/AppHeader.js";
import { CommandDock } from "./features/CommandDock.js";
import { InspectorPanel } from "./features/InspectorPanel.js";
import { ModalDrawer } from "./features/ModalDrawer.js";
import { TranscriptPane } from "./features/TranscriptPane.js";
import {
  toSnapshotBanner,
  usePortalSession
} from "./state/usePortalSession.js";

const EMPTY_CONVERSATION: UiConversationEntry[] = [];

export function App(): ReactElement {
  const session = usePortalSession();
  const conversation = useDeferredValue(
    session.snapshot?.conversation ?? EMPTY_CONVERSATION
  );
  const liveStream = useDeferredValue(session.snapshot?.liveStream);
  const activeBanner = session.localBanner ?? toSnapshotBanner(session.snapshot);
  const hasPendingPlan = Boolean(session.snapshot?.pendingPlan);

  const dispatch = useEffectEvent((action: UiAction) => {
    return session.dispatchAction(action);
  });

  const handleGlobalKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented) {
      return;
    }

    const lowerKey = event.key.toLowerCase();
    if (event.key === "Escape") {
      if (session.snapshot?.modal.kind !== "none" && session.canMutate) {
        event.preventDefault();
        void dispatch({ type: "close_modal" });
        return;
      }
      if (session.localBanner) {
        event.preventDefault();
        session.dismissBanner();
      }
      return;
    }

    if (!(event.ctrlKey || event.metaKey)) {
      return;
    }

    if (lowerKey === "/" && !event.shiftKey) {
      event.preventDefault();
      void dispatch({ type: "open_help" });
      return;
    }

    if (!event.shiftKey) {
      return;
    }

    switch (lowerKey) {
      case "a":
        if (hasPendingPlan) {
          event.preventDefault();
          void dispatch({ type: "approve_pending_plan" });
        }
        break;
      case "d":
        if (hasPendingPlan) {
          event.preventDefault();
          void dispatch({ type: "discard_pending_plan" });
        }
        break;
      case "h":
        event.preventDefault();
        void dispatch({ type: "open_handoff" });
        break;
      case "q":
        event.preventDefault();
        void dispatch({ type: "quit" });
        break;
      case "s":
        event.preventDefault();
        void dispatch({ type: "open_status" });
        break;
      case "u":
        event.preventDefault();
        void dispatch({ type: "open_sessions" });
        break;
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", handleGlobalKeyDown, {
      capture: true
    });
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown, {
        capture: true
      });
    };
  }, [handleGlobalKeyDown]);

  return (
    <div className="portal-shell">
      <AppHeader
        connectionState={session.connectionState}
        controller={session.controller}
        isController={session.isController}
        lastEventId={session.lastEventId}
        snapshot={session.snapshot}
      />

      {activeBanner ? (
        <NoticeBanner
          tone={activeBanner.tone}
          onDismiss={session.localBanner ? session.dismissBanner : undefined}
        >
          {activeBanner.message}
        </NoticeBanner>
      ) : null}

      <SplitPane
        left={
          <TranscriptPane
            canMutate={session.canMutate}
            conversation={conversation}
            isSubmitting={session.isSubmitting}
            liveStream={liveStream}
            onAction={dispatch}
          />
        }
        right={
          <InspectorPanel
            canMutate={session.canMutate}
            isSubmitting={session.isSubmitting}
            snapshot={session.snapshot}
            onApprovePlan={() => {
              void dispatch({ type: "approve_pending_plan" });
            }}
            onDiscardPlan={() => {
              void dispatch({ type: "discard_pending_plan" });
            }}
          />
        }
      />

      <CommandDock
        canMutate={session.canMutate}
        connectionState={session.connectionState}
        controller={session.controller}
        hasPendingPlan={hasPendingPlan}
        isController={session.isController}
        isSubmitting={session.isSubmitting}
        onAction={dispatch}
      />

      <ModalDrawer
        canMutate={session.canMutate}
        modal={session.snapshot?.modal ?? { kind: "none" }}
        onClose={() => {
          void dispatch({ type: "close_modal" });
        }}
      />
    </div>
  );
}
