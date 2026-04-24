import {
  useEffect,
  useRef,
  type ReactElement
} from "react";

import type { UiAction, UiTimelineItem } from "../../../../src/types/ui.js";
import { MessageCard } from "./MessageCard.js";
import { TimelineGroupCard } from "./TimelineGroupCard.js";

export function TimelineFeed(props: {
  onAction(action: UiAction): Promise<boolean>;
  timeline: UiTimelineItem[];
}): ReactElement {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowRef = useRef(true);
  const lastItem = props.timeline.at(-1);
  const liveRegionMode =
    lastItem?.kind === "message" && lastItem.streaming ? "polite" : "off";

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !shouldFollowRef.current) {
      return;
    }
    viewport.scrollTop = viewport.scrollHeight;
  }, [props.timeline]);

  return (
    <section
      ref={viewportRef}
      aria-live={liveRegionMode}
      className="timeline-feed"
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
      {props.timeline.length === 0 ? (
        <div className="workspace-empty">
          <h3>No events yet</h3>
          <p>Operator messages, agent thinking, MCP calls, harness activity, and final replies appear here in one feed.</p>
        </div>
      ) : null}
      {props.timeline.map((item) =>
        item.kind === "message" ? (
          <MessageCard key={item.id} item={item} />
        ) : (
          <TimelineGroupCard
            key={item.id}
            item={item}
            onToggle={(expanded) => {
              void props.onAction({
                type: "set_timeline_group_expanded",
                itemId: item.id,
                expanded
              });
            }}
          />
        )
      )}
    </section>
  );
}
