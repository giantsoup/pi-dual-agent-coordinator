import type { ReactElement } from "react";
import { Check, X } from "lucide-react";

import type { PendingExecutionPlanSnapshot } from "../../../../src/types/workflow.js";
import { Button, SectionHeader } from "../components/ui.js";

export function PendingPlan(props: {
  canMutate: boolean;
  compact?: boolean | undefined;
  isSubmitting: boolean;
  nextActionHint?: string | undefined;
  onApprove(): void;
  onDiscard(): void;
  plan: PendingExecutionPlanSnapshot;
}): ReactElement {
  return (
    <section className="plan-panel" data-compact={props.compact ? "true" : "false"}>
      <SectionHeader
        kicker="Pending Plan"
        title={props.plan.objective}
        actions={
          <div className="inline-actions">
            <Button
              disabled={!props.canMutate || props.isSubmitting}
              icon={<Check />}
              onClick={props.onApprove}
              tone="success"
              variant="primary"
            >
              Approve
            </Button>
            <Button
              disabled={!props.canMutate || props.isSubmitting}
              icon={<X />}
              onClick={props.onDiscard}
              tone="warning"
            >
              Discard
            </Button>
          </div>
        }
      />
      <p className="plan-summary">{props.plan.summary}</p>
      <PlanList title="Acceptance" items={props.plan.acceptanceCriteria} />
      <PlanList title="Paths" items={props.plan.relevantPaths} />
      <PlanList title="Execution" items={props.plan.executionPlan} />
      {props.plan.constraints?.length ? (
        <PlanList title="Constraints" items={props.plan.constraints} />
      ) : null}
      <div className="plan-next">
        {props.nextActionHint ??
          "Approve to start execution, or discard to return to planning."}
      </div>
    </section>
  );
}

function PlanList(props: { title: string; items: string[] }): ReactElement | null {
  if (props.items.length === 0) {
    return null;
  }

  return (
    <section className="plan-list">
      <div className="section-kicker">{props.title}</div>
      <ul>
        {props.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
