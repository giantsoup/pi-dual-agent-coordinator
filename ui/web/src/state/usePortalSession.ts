import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState
} from "react";

import type { InteractiveUiState, UiAction, UiNotification } from "../../../../src/types/ui.js";
import {
  fetchPortalState,
  postPortalAction,
  readPortalBootstrapConfig,
  subscribePortalEvents,
  type PortalControllerLockSnapshot
} from "../portal-client.js";

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "offline";

export interface LocalBannerState {
  message: string;
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
    setLocalBanner(null);
  });

  const dispatchAction = useEffectEvent(async (action: UiAction): Promise<boolean> => {
    if (!canMutate) {
      setLocalBanner({
        tone: "error",
        message:
          connectionState === "connected"
            ? "Another browser tab currently holds the controller lock."
            : "Portal actions are disabled until the controller stream reconnects."
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
          message: dto.error ?? `Portal request failed with ${response.status}.`
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
    snapshot
  };
}

export function toSnapshotBanner(
  snapshot: InteractiveUiState | null
): LocalBannerState | null {
  const notice = snapshot?.lastError ?? snapshot?.notification;
  if (!notice) {
    return null;
  }

  return {
    message: formatNotification(notice),
    tone: notice.level === "error" ? "error" : "info"
  };
}

function formatNotification(notification: UiNotification): string {
  return notification.detail
    ? `${notification.message}\n${notification.detail}`
    : notification.message;
}

function toErrorBanner(error: unknown): LocalBannerState {
  return {
    tone: "error",
    message: error instanceof Error ? error.message : String(error)
  };
}
