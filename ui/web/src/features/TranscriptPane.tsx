import {
  useEffect,
  useRef,
  type ReactElement
} from "react";

import type {
  UiAction,
  UiConversationEntry,
  UiStreamingState
} from "../../../../src/types/ui.js";
import { Badge, SectionHeader, TimelineRow } from "../components/ui.js";
import {
  actorForConversation,
  actorForRole,
  conversationLabel,
  formatTime
} from "./format.js";
import { PendingPlan } from "./PendingPlan.js";

export function TranscriptPane(props: {
  canMutate: boolean;
  conversation: UiConversationEntry[];
  isSubmitting: boolean;
  liveStream?: UiStreamingState | undefined;
  onAction(action: UiAction): Promise<boolean>;
}): ReactElement {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowRef = useRef(true);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !shouldFollowRef.current) {
      return;
    }
    viewport.scrollTop = viewport.scrollHeight;
  }, [props.conversation, props.liveStream?.text]);

  return (
    <section className="pane transcript-pane">
      <SectionHeader
        kicker="Transcript"
        title="Conversation"
        actions={
          <>
            <Badge>{props.conversation.length || "No"} entries</Badge>
            {props.liveStream ? (
              <Badge tone="accent">Live Agent {props.liveStream.role}</Badge>
            ) : null}
          </>
        }
      />
      <div
        ref={viewportRef}
        aria-live="polite"
        className="transcript-viewport"
        onScroll={() => {
          const viewport = viewportRef.current;
          if (!viewport) {
            return;
          }
          const distanceFromBottom =
            viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
          shouldFollowRef.current = distanceFromBottom < 48;
        }}
      >
        {props.conversation.length === 0 && !props.liveStream ? (
          <div className="empty-state">
            <h3>No transcript yet</h3>
            <p>Send a prompt or run a slash command from the command dock.</p>
          </div>
        ) : null}
        {props.conversation.map((entry) => (
          <TranscriptEntry
            key={entry.id}
            canMutate={props.canMutate}
            entry={entry}
            isSubmitting={props.isSubmitting}
            onAction={props.onAction}
          />
        ))}
        {props.liveStream ? <LiveStreamEntry stream={props.liveStream} /> : null}
      </div>
    </section>
  );
}

export function TranscriptEntry(props: {
  canMutate: boolean;
  entry: UiConversationEntry;
  isSubmitting: boolean;
  onAction(action: UiAction): Promise<boolean>;
}): ReactElement {
  const { entry } = props;
  return (
    <TimelineRow
      actor={actorForConversation(entry)}
      meta={
        <>
          <span>{conversationLabel(entry)}</span>
          <span>{formatTime(entry.createdAt)}</span>
        </>
      }
    >
      {entry.kind === "plan_ready" ? (
        <PendingPlan
          canMutate={props.canMutate}
          compact={false}
          isSubmitting={props.isSubmitting}
          nextActionHint={entry.nextActionHint}
          plan={entry.plan}
          onApprove={() => void props.onAction({ type: "approve_pending_plan" })}
          onDiscard={() => void props.onAction({ type: "discard_pending_plan" })}
        />
      ) : (
        <pre className="entry-text">{entry.text}</pre>
      )}
    </TimelineRow>
  );
}

export function LiveStreamEntry(props: {
  stream: UiStreamingState;
}): ReactElement {
  return (
    <TimelineRow
      actor={actorForRole(props.stream.role)}
      meta={
        <>
          <span>Live Agent {props.stream.role}</span>
          <span>{formatTime(props.stream.startedAt)}</span>
        </>
      }
    >
      <pre className="entry-text live-entry">
        {props.stream.text || "Streaming response..."}
      </pre>
    </TimelineRow>
  );
}
