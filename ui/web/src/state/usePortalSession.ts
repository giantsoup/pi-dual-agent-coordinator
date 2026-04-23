import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState
} from "react";

import {
  renderControllerActionNotice,
  renderLaunchLinkCopiedNotice,
  renderLaunchLinkCopyFailedNotice,
  renderLocalOnlyAccessNotice,
  renderThreadStateNotice
} from "../../../../src/app/presentation/notices.js";
import type { InteractiveUiState, UiAction } from "../../../../src/types/ui.js";
import {
  fetchPortalState,
  postPortalAction,
  readPortalBootstrapConfig,
  subscribePortalEvents,
  type PortalControllerLockSnapshot
} from "../portal-client.js";

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "offline";

export interface LocalBannerState {
  title?: string | undefined;
  message: string;
  nextStep?: string | undefined;
  tone: "info" | "error";
}

export interface PortalSession {
  bootstrap: ReturnType<typeof readPortalBootstrapConfig>;
  canMutate: boolean;
  connectionState: ConnectionState;
  controller: PortalControllerLockSnapshot;
  dispatchAction(action: UiAction): Promise<boolean>;
  dismissBanner(): void;
  isController: boolean;
  isSubmitting: boolean;
  lastEventId: number;
  localBanner: LocalBannerState | null;
  notifyCopyLinkResult(copied: boolean): void;
  snapshot: InteractiveUiState | null;
}

const BOOTSTRAP = readPortalBootstrapConfig();

export function usePortalSession(): PortalSession {
  const [snapshot, setSnapshot] = useState<InteractiveUiState | null>(null);
  const [controller, setController] = useState<PortalControllerLockSnapshot>({
    locked: false
  });
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const [localBanner, setLocalBanner] = useState<LocalBannerState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastEventId, setLastEventId] = useState(0);
  const lastEventIdRef = useRef(0);

  const isController = controller.controllerId === BOOTSTRAP.controllerId;
  const canMutate =
    connectionState === "connected" && (!controller.locked || isController);

  const applySnapshot = useEffectEvent(
    (
      nextSnapshot: InteractiveUiState,
      nextController: PortalControllerLockSnapshot,
      nextEventId: number
    ) => {
      lastEventIdRef.current = nextEventId;
      startTransition(() => {
        setSnapshot(nextSnapshot);
        setController(nextController);
        setLastEventId(nextEventId);
      });
    }
  );

  const hydrateSnapshot = useEffectEvent(async () => {
    const dto = await fetchPortalState(BOOTSTRAP);
    applySnapshot(dto.state, dto.controller, dto.lastEventId);
  });

  const dispatchAction = useEffectEvent(async (action: UiAction): Promise<boolean> => {
    if (!canMutate) {
      setLocalBanner({
        tone: "error",
        ...toBanner(
          connectionState === "connected"
            ? renderControllerActionNotice("controller_locked")
            : renderControllerActionNotice("stream_disconnected")
        )
      });
      return false;
    }

    setIsSubmitting(true);
    try {
      const { response, dto } = await postPortalAction(BOOTSTRAP, action);
      applySnapshot(dto.state, dto.controller, dto.lastEventId);

      if (!response.ok || !dto.accepted) {
        setLocalBanner({
          tone: "error",
          ...(dto.error
            ? {
                message: dto.error
              }
            : toBanner({
                title: "The request did not complete",
                message: `PI Dual returned HTTP ${response.status}.`,
                nextStep:
                  "Reload the page or reopen the launch link, then try the action again."
              }))
        });
        return false;
      }

      setLocalBanner(null);
      return true;
    } catch (error) {
      setLocalBanner({
        tone: "error",
        message: error instanceof Error ? error.message : String(error)
      });
      return false;
    } finally {
      setIsSubmitting(false);
    }
  });

  useEffect(() => {
    let disposed = false;

    if (!isLocalPortalHost(window.location.hostname)) {
      setLocalBanner({
        tone: "error",
        ...toBanner(
          renderLocalOnlyAccessNotice(window.location.hostname, BOOTSTRAP.launchUrl)
        )
      });
    }

    const source = subscribePortalEvents(
      BOOTSTRAP,
      {
        onOpen: () => {
          if (disposed) {
            return;
          }
          setConnectionState("connected");
          void hydrateSnapshot().catch((error) => {
            if (!disposed) {
              setLocalBanner(toErrorBanner(error));
            }
          });
        },
        onEvent: (dto) => {
          if (disposed) {
            return;
          }
          setConnectionState("connected");
          const expectedEventId = lastEventIdRef.current + 1;
          applySnapshot(dto.event.state, dto.controller, dto.eventId);
          if (lastEventIdRef.current > 0 && dto.eventId > expectedEventId) {
            void hydrateSnapshot().catch((error) => {
              if (!disposed) {
                setLocalBanner(toErrorBanner(error));
              }
            });
          }
        },
        onError: () => {
          if (!disposed) {
            setConnectionState((current) =>
              current === "connected" ? "reconnecting" : "offline"
            );
          }
        },
        onProtocolError: (error) => {
          if (!disposed) {
            setLocalBanner({
              tone: "error",
              message: error.message
            });
          }
        }
      },
      {
        lastEventId: lastEventIdRef.current
      }
    );

    void hydrateSnapshot().catch((error) => {
      if (!disposed) {
        setConnectionState("offline");
        setLocalBanner(toErrorBanner(error));
      }
    });

    return () => {
      disposed = true;
      source.close();
    };
  }, [applySnapshot, hydrateSnapshot]);

  return {
    bootstrap: BOOTSTRAP,
    canMutate,
    connectionState,
    controller,
    dispatchAction,
    dismissBanner: () => {
      setLocalBanner(null);
    },
    isController,
    isSubmitting,
    lastEventId,
    localBanner,
    notifyCopyLinkResult(copied) {
      setLocalBanner({
        tone: copied ? "info" : "error",
        ...toBanner(
          copied
            ? renderLaunchLinkCopiedNotice()
            : renderLaunchLinkCopyFailedNotice()
        )
      });
    },
    snapshot
  };
}

export function toSnapshotBanner(
  snapshot: InteractiveUiState | null
): LocalBannerState | null {
  if (!snapshot) {
    return null;
  }

  const notice = renderThreadStateNotice(snapshot);
  return notice
    ? {
        tone: snapshot.lastError ? "error" : "info",
        ...toBanner(notice)
      }
    : null;
}

function toBanner(notice: {
  title: string;
  message: string;
  nextStep?: string | undefined;
}): Omit<LocalBannerState, "tone"> {
  return {
    title: notice.title,
    message: notice.message,
    nextStep: notice.nextStep
  };
}

function toErrorBanner(error: unknown): LocalBannerState {
  return {
    tone: "error",
    message: error instanceof Error ? error.message : String(error)
  };
}

function isLocalPortalHost(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}
