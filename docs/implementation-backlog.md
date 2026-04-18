# Implementation Backlog

## Repository Name

`pi-dual-agent-coordinator`

Why this name:

- It matches the recommended architecture: one coordinator over two isolated agent runtimes.
- It avoids overloading "split brain" as the package identity while preserving that behavior in the design docs.
- It leaves room for future expansion beyond exactly two agents without renaming the core control plane.

## Product Goal

Build a coordinator-owned, two-runtime orchestration layer on top of the Pi SDK with:

- strict role separation,
- durable handoff state,
- replayable recovery,
- explicit observability,
- safe write ownership,
- testable coordinator logic.

## Current Repository Status

This document is the implementation plan and backlog, not a literal statement of the repo's current unfinished phase.

As of the current repository state:

- phases 0 through 9 are represented in the source tree and covered by automated tests to varying depth,
- phase 11 is partially represented by `src/app/trust-policy.ts` and `src/app/prompt-provenance.ts`,
- phases 10 through 12 still contain planned items that are not fully implemented in the current tree.

The primary remaining gap is live end-to-end validation against real Pi SDK sessions and models. The existing integration tests use fake runtimes to exercise coordinator behavior deterministically.

## Non-Goals For V1

- Direct peer-to-peer agent messaging
- Multi-writer file mutation
- Dynamic agent counts
- Cross-language orchestration via RPC
- Production UI
- Pluggable arbitration strategies beyond the default lease-based coordinator

## Phase Plan

### Phase 0: Architecture Contract

Deliverables:

- Short architecture decision record
- Role contract for Agent A and Agent B
- Handoff state machine definition
- Trust and threat model
- Failure policy and retry boundaries

Files:

- `docs/architecture-decisions.md`
- `docs/security-model.md`
- `docs/handoff-state-machine.md`

Acceptance criteria:

- One-page answer exists for ownership, recovery, retries, and session durability.
- V1 constraints are written down before any runtime code is added.

### Phase 1: Runtime Scaffold

Deliverables:

- Bootstrappable TypeScript project
- Runtime factory for each role
- Role-based tool configuration
- Coordinator bootstrap and lifecycle wiring
- Central event subscription and rebind support

Files:

- `src/app/bootstrap.ts`
- `src/runtime/create-role-runtime.ts`
- `src/runtime/runtime-registry.ts`
- `src/tools/create-role-tools.ts`
- `src/coordinator/coordinator.ts`
- `src/coordinator/bind-runtime-events.ts`
- `src/types/role.ts`
- `src/index.ts`

Acceptance criteria:

- Both runtimes can be created independently.
- Coordinator can subscribe to both sessions.
- Runtime replacement triggers explicit event rebinding.

### Phase 2: Telemetry and Structured Logging

Deliverables:

- Structured event logger
- Correlation-id generation
- Event normalization from SDK events into internal telemetry events
- Minimal metrics adapter interface

Files:

- `src/telemetry/logger.ts`
- `src/telemetry/event-normalizer.ts`
- `src/telemetry/correlation.ts`
- `src/telemetry/metrics.ts`
- `src/types/telemetry.ts`

Acceptance criteria:

- Every significant event is emitted with `role`, `sessionId`, `sessionFile`, `leafId`, and `turnIndex` when available.
- Telemetry remains valid across session replacement.

### Phase 3: Handoff Envelope and Validation

Deliverables:

- Versioned handoff schema
- Envelope validation
- Model-visible rendering of handoff instructions
- Idempotency and lease fields

Files:

- `src/handoff/handoff-envelope.ts`
- `src/handoff/handoff-envelope-schema.ts`
- `src/handoff/render-handoff-message.ts`
- `src/handoff/handoff-id.ts`
- `src/types/handoff.ts`

Acceptance criteria:

- Invalid envelopes are rejected before persistence or delivery.
- Model-visible handoff content is deterministic and concise.

### Phase 4: Durable Persistence

Deliverables:

- Session-backed handoff ledger
- Checkpoint labeling support
- Recovery loader from session history
- Tool-result detail reconstruction contract

Files:

- `src/persistence/session-ledger.ts`
- `src/persistence/checkpoints.ts`
- `src/persistence/recovery-loader.ts`
- `src/persistence/reconstruct-branch-state.ts`
- `src/types/session-ledger.ts`

Acceptance criteria:

- Prepared and completed handoffs can be rediscovered after process restart.
- Recovery does not depend on coordinator memory.

### Phase 5: Single Safe Handoff Flow

Deliverables:

- Happy-path A-to-B handoff flow
- Delivery adapter for injected agent-visible handoff messages
- Completion capture at stable turn boundaries

Files:

- `src/coordinator/prepare-handoff.ts`
- `src/coordinator/deliver-handoff.ts`
- `src/coordinator/complete-handoff.ts`
- `src/coordinator/handoff-orchestrator.ts`

Acceptance criteria:

- A can analyze and hand work to B.
- B can execute and report a completion record.
- Handoff is triggered only on stable boundaries such as `turn_end`.

### Phase 6: Ownership and Mutation Safety

Deliverables:

- Read-only capability profile for Agent A
- Write-authoritative capability profile for Agent B
- Custom mutation tool wrapper using Pi file-mutation conventions
- Reservation guardrails for any future shared-write experiments

Files:

- `src/tools/role-capability-policy.ts`
- `src/tools/with-safe-mutation.ts`
- `src/tools/path-reservations.ts`

Acceptance criteria:

- Agent A cannot mutate repository files.
- Any custom mutation path uses canonical absolute paths and mutation queue participation.

### Phase 7: Coordinator State Machine and Idempotency

Deliverables:

- Explicit handoff state machine
- Idempotent transition application
- Duplicate suppression
- Supersession handling

Files:

- `src/coordinator/handoff-state-machine.ts`
- `src/coordinator/apply-transition.ts`
- `src/coordinator/duplicate-suppression.ts`
- `src/types/handoff-state.ts`

Acceptance criteria:

- Duplicate deliveries do not create duplicate work.
- State transitions are monotonic and auditable.

### Phase 8: Runtime Replacement and Resume

Deliverables:

- Centralized session rebind manager
- Resume, fork, and switch orchestration support
- Health checks for active runtime bindings

Files:

- `src/runtime/rebind-runtime.ts`
- `src/runtime/runtime-health.ts`
- `src/runtime/runtime-operations.ts`

Acceptance criteria:

- No telemetry or coordinator listeners are lost after runtime replacement.

### Phase 9: Recovery and Replay

Deliverables:

- Replay engine for active branch state
- Restart recovery sequence
- Consistency assertions between live state and replayed state

Files:

- `src/persistence/replay-engine.ts`
- `src/persistence/restart-recovery.ts`
- `src/persistence/assert-consistency.ts`

Acceptance criteria:

- Restarted coordinator reaches the same handoff conclusions from persisted state.

### Phase 10: Reliability Controls

Deliverables:

- Timeout and cancellation boundaries
- Transport retry integration
- Handoff retry policy
- Backoff and dead-letter handling for coordinator-level failures

Files:

- `src/coordinator/retry-policy.ts`
- `src/coordinator/timeouts.ts`
- `src/coordinator/cancellation.ts`
- `src/types/retry.ts`

Acceptance criteria:

- Provider retries and handoff retries are separated cleanly.
- Abort propagation is enforced for nested work.

### Phase 11: Security and Trust Boundaries

Deliverables:

- Prompt provenance policy
- Trust gating for project-local configuration
- Safe defaults for runtime capabilities and extension loading

Files:

- `src/app/trust-policy.ts`
- `src/app/prompt-provenance.ts`
- `docs/trust-boundaries.md`

Acceptance criteria:

- Any prompt injection surface is documented and bounded by policy.

### Phase 12: Full Test Matrix

Deliverables:

- Unit tests for schema and coordinator rules
- Integration tests for dual-runtime orchestration
- Replay tests for recovery correctness
- Regression tests for rebinding and duplicate suppression

Files:

- `test/unit/handoff-envelope.test.ts`
- `test/unit/handoff-state-machine.test.ts`
- `test/unit/duplicate-suppression.test.ts`
- `test/unit/event-normalizer.test.ts`
- `test/integration/runtime-bootstrap.test.ts`
- `test/integration/handoff-flow.test.ts`
- `test/integration/runtime-rebind.test.ts`
- `test/replay/recovery-loader.test.ts`
- `test/replay/restart-recovery.test.ts`
- `test/fixtures/sample-session-a.jsonl`
- `test/fixtures/sample-session-b.jsonl`

Acceptance criteria:

- CI verifies schema correctness, orchestration flow, replay correctness, and runtime rebinding.

## Initial Package Layout

```text
src/
  app/
    bootstrap.ts
    prompt-provenance.ts
    trust-policy.ts
  coordinator/
    apply-transition.ts
    bind-runtime-events.ts
    complete-handoff.ts
    coordinator.ts
    deliver-handoff.ts
    duplicate-suppression.ts
    handoff-orchestrator.ts
    handoff-state-machine.ts
    prepare-handoff.ts
    retry-policy.ts
    timeouts.ts
  handoff/
    handoff-envelope-schema.ts
    handoff-envelope.ts
    handoff-id.ts
    render-handoff-message.ts
  persistence/
    assert-consistency.ts
    checkpoints.ts
    reconstruct-branch-state.ts
    recovery-loader.ts
    replay-engine.ts
    restart-recovery.ts
    session-ledger.ts
  runtime/
    create-role-runtime.ts
    rebind-runtime.ts
    runtime-health.ts
    runtime-operations.ts
    runtime-registry.ts
  telemetry/
    correlation.ts
    event-normalizer.ts
    logger.ts
    metrics.ts
  tools/
    create-role-tools.ts
    path-reservations.ts
    role-capability-policy.ts
    with-safe-mutation.ts
  types/
    handoff-state.ts
    handoff.ts
    retry.ts
    role.ts
    session-ledger.ts
    telemetry.ts
  index.ts
```

## Core Interfaces

### `Role`

```ts
export type Role = "A" | "B";
```

### `HandoffEnvelope`

```ts
export interface HandoffEnvelope {
  schemaVersion: 1;
  handoffId: string;
  parentHandoffId?: string;
  fromRole: Role;
  toRole: Role;
  sourceLeafId: string;
  createdAt: string;
  leaseEpoch: number;
  summary: string;
  objective: string;
  acceptanceCriteria: string[];
  relevantPaths: string[];
  touchedPaths?: string[];
  requiredTools?: string[];
  stateSnapshot?: Record<string, unknown>;
}
```

### `HandoffRecord`

```ts
export interface HandoffRecord {
  handoffId: string;
  state: "prepared" | "delivered" | "acked" | "completed" | "superseded";
  envelope: HandoffEnvelope;
  createdAt: string;
  updatedAt: string;
}
```

### `RuntimeBinding`

```ts
export interface RuntimeBinding {
  role: Role;
  sessionId: string;
  sessionFile?: string;
  rebind(): Promise<void>;
  dispose(): Promise<void>;
}
```

### `CoordinatorDependencies`

```ts
export interface CoordinatorDependencies {
  logger: CoordinatorLogger;
  ledger: SessionLedger;
  metrics: MetricsSink;
  clock: () => Date;
  createHandoffId: () => string;
}
```

## Immediate Build Order

1. `src/types/role.ts`
2. `src/handoff/handoff-envelope.ts`
3. `src/coordinator/handoff-state-machine.ts`
4. `src/runtime/create-role-runtime.ts`
5. `src/tools/create-role-tools.ts`
6. `src/coordinator/coordinator.ts`
7. `src/coordinator/bind-runtime-events.ts`
8. `src/persistence/session-ledger.ts`
9. `src/telemetry/logger.ts`
10. `test/unit/handoff-envelope.test.ts`
11. `test/integration/runtime-bootstrap.test.ts`

## Recommended First Implementation Slice

Build only enough to prove these four conditions:

- both runtimes can boot,
- roles get different capabilities,
- coordinator subscriptions survive runtime replacement,
- a validated handoff envelope can be prepared and persisted.

That slice is the correct stopping point before adding delivery, retries, or replay complexity.
