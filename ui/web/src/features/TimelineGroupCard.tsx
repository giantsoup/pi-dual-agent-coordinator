import type { ReactElement } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import type { UiTimelineGroupItem } from "../../../../src/types/ui.js";
import { ActorMarker, Badge } from "../components/ui.js";
import {
  formatDuration,
  formatTime,
  timelineActorLabel,
  timelineStatusTone
} from "./format.js";

export function TimelineGroupCard(props: {
  item: UiTimelineGroupItem;
  onToggle(expanded: boolean): void;
}): ReactElement {
  const expandable = !props.item.inline;
  return (
    <article className="timeline-group-card" data-actor={props.item.actor} data-kind={props.item.activityKind}>
      <button
        aria-expanded={expandable ? props.item.expanded : undefined}
        className="timeline-group-card__header"
        type="button"
        onClick={() => {
          if (expandable) {
            props.onToggle(!props.item.expanded);
          }
        }}
      >
        <div className="timeline-group-card__lead">
          {expandable ? props.item.expanded ? <ChevronDown /> : <ChevronRight /> : <span className="timeline-group-card__spacer" />}
          <ActorMarker actor={timelineActorToActor(props.item.actor)} label={timelineActorLabel(props.item.actor)} />
          <Badge tone={timelineStatusTone(props.item.status)}>{props.item.sourceLabel}</Badge>
          <strong>{props.item.summary}</strong>
        </div>
        <div className="timeline-group-card__meta">
          <span>{formatTime(props.item.startedAt)}</span>
          {props.item.durationMs ? <span>{formatDuration(props.item.durationMs)}</span> : null}
          <Badge tone={timelineStatusTone(props.item.status)}>{props.item.status}</Badge>
        </div>
      </button>
      {props.item.inline || props.item.expanded ? (
        <div className="timeline-group-card__rows">
          {props.item.rows.map((row) => (
            <div key={row.id} className="timeline-row-item">
              <div className="timeline-row-item__summary">
                <span>{row.toolName ?? props.item.sourceLabel}</span>
                <strong>{row.summary}</strong>
              </div>
              <div className="timeline-row-item__details">
                {row.target ? <span>Target: {row.target}</span> : null}
                {row.argsPreview ? <span>Args: {row.argsPreview}</span> : null}
                {row.resultPreview ? <span>Result: {row.resultPreview}</span> : null}
                {row.errorPreview ? <span className="timeline-row-item__error">Error: {row.errorPreview}</span> : null}
                {row.detailPreview ? <span>{row.detailPreview}</span> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function timelineActorToActor(actor: UiTimelineGroupItem["actor"]): "coordinator" | "A" | "B" | "unknown" {
  if (actor === "A" || actor === "B") {
    return actor;
  }
  if (actor === "system") {
    return "coordinator";
  }
  return "unknown";
}
