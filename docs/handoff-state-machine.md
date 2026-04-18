# Handoff State Machine

## States

- `prepared`: Agent A produced a valid handoff envelope and the coordinator persisted it.
- `delivered`: The coordinator rendered and submitted the handoff to Agent B.
- `acked`: Reserved for when B emits an explicit acceptance boundary. V1 keeps the state available even if most flows move directly to `completed`.
- `completed`: Agent B emitted a valid completion block for the handoff.
- `superseded`: A newer handoff or runtime change invalidated the active work item.

## Rules

- Transitions are monotonic and idempotent.
- The same `handoffId` may be observed multiple times, but only the first durable preparation is accepted.
- Stable-boundary parsing happens only on `turn_end`.
- `prepared` must exist before `delivered`.
- `delivered` must exist before `completed`.
- `superseded` is terminal for the affected active handoff.

## Allowed Transitions

- `prepared` -> `delivered`
- `delivered` -> `acked`
- `delivered` -> `completed`
- `acked` -> `completed`
- `prepared|delivered|acked` -> `superseded`

## Recovery

On restart, the coordinator replays the ledger in order and reconstructs the latest record per `handoffId`. If multiple active records exist, the most recent non-terminal record becomes the active handoff view until newer terminal evidence is found.
