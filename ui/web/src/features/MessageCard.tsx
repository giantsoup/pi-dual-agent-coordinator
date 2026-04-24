import type { ReactElement } from "react";

import type { UiTimelineMessageItem } from "../../../../src/types/ui.js";
import { ActorMarker, Badge } from "../components/ui.js";
import { formatTime, timelineActorLabel } from "./format.js";

export function MessageCard(props: {
  item: UiTimelineMessageItem;
}): ReactElement {
  return (
    <article className="message-card" data-actor={props.item.actor}>
      <div className="message-card__meta">
        <ActorMarker actor={timelineActorToActor(props.item.actor)} label={timelineActorLabel(props.item.actor)} />
        <span>{props.item.sourceLabel}</span>
        <span>{formatTime(props.item.createdAt)}</span>
        {props.item.streaming ? <Badge tone="accent">Streaming</Badge> : null}
      </div>
      <pre className="message-card__body">{props.item.text}</pre>
    </article>
  );
}

function timelineActorToActor(actor: UiTimelineMessageItem["actor"]): "coordinator" | "A" | "B" | "unknown" {
  if (actor === "A" || actor === "B") {
    return actor;
  }
  if (actor === "system") {
    return "coordinator";
  }
  return "unknown";
}
