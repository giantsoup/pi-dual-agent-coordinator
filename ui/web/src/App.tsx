import {
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useState,
  type ReactElement
} from "react";

import type { UiAction } from "../../../src/types/ui.js";
import { NoticeBanner } from "./components/ui.js";
import { ComposerBar } from "./features/ComposerBar.js";
import { ModalDrawer } from "./features/ModalDrawer.js";
import { SettingsView } from "./features/SettingsView.js";
import { ThreadHeader } from "./features/ThreadHeader.js";
import { TimelineFeed } from "./features/TimelineFeed.js";
import { WorkspaceSidebar } from "./features/WorkspaceSidebar.js";
import {
  toSnapshotBanner,
  usePortalSession
} from "./state/usePortalSession.js";

export function App(): ReactElement {
  const session = usePortalSession();
  const snapshot = session.snapshot;
  const timeline = useDeferredValue(snapshot?.timeline ?? []);
  const activeBanner = session.localBanner ?? toSnapshotBanner(snapshot);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const dispatch = useEffectEvent((action: UiAction) => session.dispatchAction(action));

  useEffect(() => {
    if (!snapshot) {
      return;
    }
    syncUrlWithState(snapshot);
  }, [snapshot]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }
    const url = new URL(window.location.href);
    const requestedThreadId = url.searchParams.get("threadId");
    const requestedView = url.searchParams.get("view");
    const requestedScope = url.searchParams.get("scope");

    if (
      requestedThreadId &&
      requestedThreadId !== snapshot.workspace.selectedThreadId
    ) {
      void dispatch({
        type: "select_thread",
        threadId: requestedThreadId
      });
      return;
    }

    if (requestedView === "settings" && snapshot.activeView !== "settings") {
      void dispatch({
        type: "open_settings",
        scope:
          requestedScope === "global" ||
          requestedScope === "project" ||
          requestedScope === "thread"
            ? requestedScope
            : undefined
      });
      return;
    }

    if (requestedView !== "settings" && snapshot.activeView === "settings") {
      void dispatch({ type: "close_settings" });
    }
  }, [dispatch, snapshot]);

  const selectedThreadId = snapshot?.workspace.selectedThreadId;
  const activeThreadId = snapshot?.workspace.activeThreadId;
  const isLiveThread = Boolean(selectedThreadId && selectedThreadId === activeThreadId);
  const canOpenUtilities = session.connectionState === "connected";
  const disabledReason = !isLiveThread
    ? "This thread is a persisted local snapshot. Return to the live thread to continue the conversation."
    : session.connectionState !== "connected"
      ? "The local event stream is reconnecting."
      : !session.canMutate
        ? "This browser tab is read-only right now."
        : "The live thread is ready.";

  return (
    <div className="workspace-shell">
      {activeBanner ? (
        <NoticeBanner
          tone={activeBanner.tone}
          onDismiss={session.localBanner ? session.dismissBanner : undefined}
        >
          {[
            activeBanner.title,
            activeBanner.message,
            activeBanner.nextStep
          ]
            .filter(Boolean)
            .join("\n")}
        </NoticeBanner>
      ) : null}

      <div className="workspace-layout">
        <WorkspaceSidebar
          activeView={snapshot?.activeView ?? "thread"}
          canOpenProject={session.canMutate && session.connectionState === "connected"}
          connectionState={session.connectionState}
          mobileOpen={mobileSidebarOpen}
          onAction={dispatch}
          onCloseMobile={() => setMobileSidebarOpen(false)}
          workspace={
            snapshot?.workspace ?? {
              projects: [],
              recentProjects: [],
              threads: []
            }
          }
        />

        <main className="workspace-main">
          {snapshot ? (
            snapshot.activeView === "settings" ? (
              <SettingsView
                canMutate={session.canMutate}
                isSubmitting={session.isSubmitting}
                onAction={dispatch}
                settings={snapshot.settings}
              />
            ) : (
              <>
                <ThreadHeader
                  canOpenUtilities={canOpenUtilities}
                  canMutate={session.canMutate}
                  isLiveThread={isLiveThread}
                  onAction={dispatch}
                  onOpenSidebar={() => setMobileSidebarOpen(true)}
                  snapshot={snapshot}
                />
                <TimelineFeed onAction={dispatch} timeline={timeline} />
                <ComposerBar
                  canOpenUtilities={canOpenUtilities}
                  canMutate={session.canMutate}
                  connectionState={session.connectionState}
                  disabledReason={disabledReason}
                  hasPendingPlan={Boolean(snapshot.pendingPlan)}
                  isLiveThread={isLiveThread}
                  isSubmitting={session.isSubmitting}
                  onAction={dispatch}
                />
              </>
            )
          ) : (
            <section className="workspace-loading">
              <h2>Loading local workspace</h2>
              <p>Waiting for the first authoritative PI Dual snapshot.</p>
            </section>
          )}
        </main>
      </div>

      <ModalDrawer
        modal={snapshot?.modal ?? { kind: "none" }}
        onClose={() => {
          void dispatch({ type: "close_modal" });
        }}
      />
    </div>
  );
}

function syncUrlWithState(snapshot: NonNullable<ReturnType<typeof usePortalSession>["snapshot"]>): void {
  const url = new URL(window.location.href);
  url.searchParams.set("threadId", snapshot.workspace.selectedThreadId ?? snapshot.status.threadId);
  url.searchParams.set("view", snapshot.activeView);
  if (snapshot.activeView === "settings") {
    url.searchParams.set("scope", snapshot.settings.activeScope);
  } else {
    url.searchParams.delete("scope");
  }
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}
