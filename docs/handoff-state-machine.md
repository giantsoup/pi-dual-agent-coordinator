# Workflow State Machine

## States

- `prepared`: Agent A produced a valid `pi-handoff` envelope and the coordinator persisted the iteration.
- `delivered`: The coordinator rendered and submitted the handoff to Agent B.
- `completed`: Agent B emitted a valid `pi-completion` block for the iteration.
- `finalized`: Agent A emitted a terminal `pi-final` decision.
- `blocked`: The coordinator terminated the workflow after a failed repair or protocol violation.
- `capped`: The workflow hit the review-round cap without a valid terminal response.
- `repair_requested`: The coordinator issued a deterministic repair prompt for a malformed or missing machine block.
- `superseded`: Reserved for invalidation by runtime replacement or later coordinator control.

## Rules

- Records are append-only and replayed in order.
- Stable-boundary parsing happens only on `turn_end`.
- Each workflow has a stable `workflowId`; each execution round has its own `iteration`.
- `prepared` must exist before `delivered`.
- `delivered` must exist before `completed`.
- `finalized`, `blocked`, and `capped` are terminal workflow outcomes.

## Allowed Transitions

- `prepared` -> `delivered`
- `delivered` -> `completed`
- `completed` -> `prepared` for the next iteration
- `completed` -> `finalized`
- `prepared|delivered|completed` -> `repair_requested`
- `repair_requested` -> `prepared|completed|finalized|blocked`
- any non-terminal workflow -> `capped|blocked|superseded`

## Recovery

On restart, the coordinator replays the ledger in order and reconstructs the latest workflow snapshot per `workflowId`. If multiple workflows appear in the ledger, the most recent non-terminal workflow becomes the active workflow view until newer terminal evidence is found.
