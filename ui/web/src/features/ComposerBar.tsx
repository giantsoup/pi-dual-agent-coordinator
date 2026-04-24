import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement
} from "react";
import {
  Check,
  CircleHelp,
  Send,
  SquareTerminal,
  X
} from "lucide-react";

import type { UiAction } from "../../../../src/types/ui.js";
import { Button, Textarea } from "../components/ui.js";
import type { ConnectionState } from "../state/usePortalSession.js";

export function ComposerBar(props: {
  canOpenUtilities: boolean;
  canMutate: boolean;
  connectionState: ConnectionState;
  disabledReason: string;
  hasPendingPlan: boolean;
  isLiveThread: boolean;
  isSubmitting: boolean;
  onAction(action: UiAction): Promise<boolean>;
}): ReactElement {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const disabled =
    props.isSubmitting ||
    !props.canMutate ||
    !props.isLiveThread ||
    props.connectionState !== "connected";

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (
        event.key === "/" &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        event.target instanceof HTMLElement &&
        event.target.tagName !== "INPUT" &&
        event.target.tagName !== "TEXTAREA"
      ) {
        event.preventDefault();
        ref.current?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const submit = async () => {
    const input = value.trim();
    if (!input || disabled) {
      return;
    }
    const accepted = await props.onAction({
      type: "submit_input",
      input
    });
    if (accepted) {
      setValue("");
    }
  };

  return (
    <section className="composer-bar">
      <div className="composer-bar__utility">
        <div>
          <div className="workspace-eyebrow">Composer</div>
          <p>{disabled ? props.disabledReason : "Send a prompt or slash command to the live thread."}</p>
        </div>
        <div className="composer-bar__actions">
          <Button
            disabled={!props.canOpenUtilities}
            icon={<CircleHelp />}
            onClick={() => {
              void props.onAction({ type: "open_help" });
            }}
          >
            Help
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
        </div>
      </div>

      {props.hasPendingPlan ? (
        <div className="composer-bar__plan-actions">
          <Button
            disabled={disabled}
            icon={<Check />}
            tone="success"
            variant="primary"
            onClick={() => {
              void props.onAction({ type: "approve_pending_plan" });
            }}
          >
            Approve Plan
          </Button>
          <Button
            disabled={disabled}
            icon={<X />}
            onClick={() => {
              void props.onAction({ type: "discard_pending_plan" });
            }}
          >
            Discard Plan
          </Button>
        </div>
      ) : null}

      <div className="composer-bar__input">
        <Textarea
          aria-label="Prompt or slash command"
          ref={ref}
          disabled={disabled}
          placeholder="Ask PI Dual to inspect, edit, verify, or continue the live thread"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => handleComposerKeyDown(event, submit)}
        />
        <div className="composer-bar__submit">
          <Button
            disabled={!value.trim() || disabled}
            icon={<Send />}
            tone="accent"
            variant="primary"
            onClick={() => {
              void submit();
            }}
          >
            {props.isSubmitting ? "Sending" : "Send"}
          </Button>
        </div>
      </div>
    </section>
  );
}

function handleComposerKeyDown(
  event: KeyboardEvent<HTMLTextAreaElement>,
  submit: () => Promise<void>
): void {
  if (event.key !== "Enter" || event.shiftKey) {
    return;
  }
  event.preventDefault();
  void submit();
}
