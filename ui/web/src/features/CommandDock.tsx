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
  DoorOpen,
  History,
  Send,
  Share2,
  SquareTerminal,
  X
} from "lucide-react";

import {
  INTERACTIVE_COMMAND_HINT,
  INTERACTIVE_RUNTIME_HINT
} from "../../../../src/app/interactive/compat.js";
import type { UiAction } from "../../../../src/types/ui.js";
import type { PortalControllerLockSnapshot } from "../portal-client.js";
import { Button, IconButton, SectionHeader, Textarea, Toolbar } from "../components/ui.js";
import { describeConnection } from "./format.js";
import type { ConnectionState } from "../state/usePortalSession.js";

export function CommandDock(props: {
  canMutate: boolean;
  connectionState: ConnectionState;
  controller: PortalControllerLockSnapshot;
  hasPendingPlan: boolean;
  isController: boolean;
  isSubmitting: boolean;
  onAction(action: UiAction): Promise<boolean>;
}): ReactElement {
  const [value, setValue] = useState("");
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const submit = async () => {
    const input = value.trim();
    if (!input) {
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

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      if (
        event.key === "/" &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        composerRef.current?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <section className="command-dock">
      <SectionHeader
        kicker="Command Dock"
        title="Prompt"
        actions={
          <Toolbar>
            <IconButton
              aria-label="Open help"
              icon={<CircleHelp />}
              tooltip="Help"
              disabled={!props.canMutate}
              onClick={() => void props.onAction({ type: "open_help" })}
            />
            <IconButton
              aria-label="Open status"
              icon={<SquareTerminal />}
              tooltip="Status"
              disabled={!props.canMutate}
              onClick={() => void props.onAction({ type: "open_status" })}
            />
            <IconButton
              aria-label="Open sessions"
              icon={<History />}
              tooltip="Sessions"
              disabled={!props.canMutate}
              onClick={() => void props.onAction({ type: "open_sessions" })}
            />
            <IconButton
              aria-label="Open handoff"
              icon={<Share2 />}
              tooltip="Handoff"
              disabled={!props.canMutate}
              onClick={() => void props.onAction({ type: "open_handoff" })}
            />
            <IconButton
              aria-label="Quit"
              icon={<DoorOpen />}
              tooltip="Quit"
              tone="danger"
              disabled={!props.canMutate}
              onClick={() => void props.onAction({ type: "quit" })}
            />
          </Toolbar>
        }
      />
      {props.hasPendingPlan ? (
        <div className="plan-actions-band">
          <Button
            disabled={!props.canMutate || props.isSubmitting}
            icon={<Check />}
            onClick={() => void props.onAction({ type: "approve_pending_plan" })}
            tone="success"
            variant="primary"
          >
            Approve Plan
          </Button>
          <Button
            disabled={!props.canMutate || props.isSubmitting}
            icon={<X />}
            onClick={() => void props.onAction({ type: "discard_pending_plan" })}
            tone="warning"
          >
            Discard Plan
          </Button>
        </div>
      ) : null}
      <div className="composer-grid">
        <label className="visually-hidden" htmlFor="portal-composer">
          Prompt or slash command
        </label>
        <Textarea
          id="portal-composer"
          ref={composerRef}
          value={value}
          disabled={!props.canMutate || props.isSubmitting}
          placeholder="Send a prompt, or type /status, /approve, /new A, /switch B /path/to/session.jsonl"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            handleComposerKeyDown(event, submit);
          }}
        />
        <div className="composer-footer">
          <div className="composer-hints">
            <span>{buildComposerHint(props)}</span>
            <span>{INTERACTIVE_COMMAND_HINT}</span>
            <span>{INTERACTIVE_RUNTIME_HINT}</span>
          </div>
          <Toolbar>
            <Button
              disabled={!value || props.isSubmitting}
              onClick={() => {
                setValue("");
                composerRef.current?.focus();
              }}
            >
              Clear
            </Button>
            <Button
              disabled={!value.trim() || !props.canMutate || props.isSubmitting}
              icon={<Send />}
              onClick={() => {
                void submit();
              }}
              tone="accent"
              variant="primary"
            >
              {props.isSubmitting ? "Sending" : "Send"}
            </Button>
          </Toolbar>
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

function buildComposerHint(props: {
  connectionState: ConnectionState;
  controller: PortalControllerLockSnapshot;
  isController: boolean;
}): string {
  if (props.connectionState !== "connected") {
    return `${describeConnection(props.connectionState)} to the local PI Dual event stream. Wait for the page to reconnect before sending changes.`;
  }
  if (props.controller.locked && !props.isController) {
    return "This tab is read-only because another browser tab controls the thread. Use that tab or reconnect with the launch link.";
  }
  return "Type a prompt or slash command. Enter sends it, Shift+Enter adds a newline, and / focuses this box.";
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}
