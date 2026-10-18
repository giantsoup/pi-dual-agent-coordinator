# Execution process check-ins

Agent B can make many model requests inside one handoff. The normal Agent A
review happens after completion, which leaves repeated attempts and scope drift
unchecked during a long run. A process check-in adds a review after 10 successful B turns and each later
multiple of 10 while B still has tool work underway. Failed turns do not advance
that counter.

`WorkflowOrchestrator` creates one `createExecutionSupervisor` callback per
handoff and passes it through the original execution submission. Completion
formatting does not use this callback.
`RuntimeEventBridge` forwards the callback as the `onTurnEnd` prompt option.
`ManagedSession` installs it on the raw Pi agent for that submission. Pi awaits
that listener after tools finish and before polling steering or requesting the
next model response. Ordinary session notifications cannot enforce this pause.

A receives the approved handoff and facts from at most 10 recent successful turns. Facts
include tool names, sanitized targets, and success or error outcomes, with
redaction before truncation. Assistant prose, raw arguments, and tool output are
excluded. A can use its existing read-only tools
for targeted inspection. It returns one `pi-check-in` block containing the exact
workflow, handoff, iteration, and turn count, plus a `continue`, `redirect`, or
`blocked` decision, a brief reason, and at most five next steps.

The coordinator validates the response and constructs B's steering message from
the accepted fields. A redirect needs at least one next step. An invalid response
keeps B paused while Agent A corrects its format. Provider
failures, exhausted repairs, and blocked decisions stop B before another model
request. Routine check-ins preserve B's active run and do not abort or resubmit
its handoff. A terminal response at a threshold goes to normal completion
validation and review instead.

Check-ins emit correlated started, completed, and failed telemetry. An intentional
block is a completed check-in with decision `blocked`. Every required response uses one ten-attempt budget: the original response and
at most nine format corrections. A valid tenth response succeeds. Ten invalid
responses stop the operation without another request. Check-ins do not
consume a workflow review round or add a handoff-state transition. The overall
operation deadline includes check-in time. Cancellation aborts both sessions;
the supervisor checks cancellation before accepting guidance, and the runtime
checks again before steering. Listener cleanup belongs to the submission.
Restart recovery keeps the existing policy for unfinished workflows rather
than attempting to resume a paused check-in.

The terminal shows a readable progress check with the decision, reason, and next
steps. Raw protocol blocks are hidden from streaming text and ordinary output,
including incomplete or malformed responses. The metadata inspector retains
the validated check-in fields for diagnosis. Old archived check-ins use the same
presentation without rewriting their session files.

The supervisor also emits `workflow.execution_progress` before execution, after
each successful B model turn, and when a check starts, resumes, or stops. The
request history retains this counter and check state, so the terminal can show
successful B turns and the next check without counting operator requests or tool
calls. A response with multiple successful tools counts once. A failed or missing
tool result, rejected completion, provider error, aborted response, or formatting
repair does not count. Completion repairs disable tools and do not use the execution supervisor. They
cannot trigger nested process checks. A new handoff starts at zero. The activity line follows the tool list, and resumed B
tools appear after the A check-in that preceded them.

## Design choice

Two designs were compared: a handoff-scoped callback using the existing prompt
lifecycle, and a separate runtime supervisor with explicit subscription and
steering controls. The callback design preserves delivery preflight and cancellation ownership.
Completion formatting has its own submission lifecycle. It uses the
other design's scoped listener cleanup, bounded evidence, and same-run steering.
Independent review favored the callback design and identified the need to keep
evidence structural and to distinguish a deliberate block from a failed check-in.

Polling session notifications cannot pause the next model request. Aborting and
resubmitting at each threshold risks repeating tools and complicates run
settlement. Both alternatives were rejected.

## Verification

Run `npm test -- test/unit/execution-supervisor.test.ts test/integration/execution-check-in.test.ts`.
The integration uses real Pi sessions, provider brokers, and sandboxed write
tools with deterministic provider responses. It checks request ordering at
turns 10 and 20, guidance in B's next request, normal review on a terminal tenth
turn, malformed responses, and cancellation while paused. Unit checks cover
stale identities, redirect requirements, blockers, redaction, and evidence bounds.
This verifies coordinator behavior without claiming that a live model always
follows guidance correctly.

## Bounded response repair

The coordinator owns `response-repair.ts`. Planning, handoffs, reviews, cap
finals, completion reports, and periodic check-ins all use its ten-attempt
policy. Domain validators and JSON schemas remain with their existing owners.
Valid planning prose and intentional blocked decisions succeed immediately.
Wrong identifiers, wrong block types, invalid fields, duplicate blocks, empty
responses, and truncation consume the same response budget.

A response gets one stable `responseId`. Model run IDs, runtime rebinds, and
compaction cannot replace that identity or reset its budget. Typed format errors
must belong to that response. Nested exhaustion propagates to the workflow
without an outer repair loop. Provider failures, cancellation, the overall
deadline, and cleanup failures keep their separate handling.

A correction contains the latest sanitized validation error, schema, and exact
identifiers. It stays in the same role and conversation. `ManagedSession`
disables the active tools before dispatch and rejects hallucinated tool calls
before execution. It restores the previous tool set after agent work and
compaction drain. Corrections never redeliver the original handoff. A broken
plan proposal cannot gain execution approval through a format correction.
Protocol labels used as tools fail one response attempt without removing runtime
subscriptions.

Telemetry emits `response.attempt_started`, `response.rejected`,
`response.succeeded`, `response.exhausted`, and `response.stopping`, correlated
with the response, request, workflow, handoff, and operator turn. Existing
`workflow.repair_requested` events and `repair_requested` ledger records remain
supported. The ledger records the current workflow iteration, even when a
review permits a handoff for the next iteration. Planning repair records retain
their history without creating a running workflow.

The terminal, plain interface, and `/status` show labels such as
`Agent A check-in response attempt 4/10`. Response attempt counts are local to
one response. Workflow `repairCount` accumulates repair requests across its
responses. Ten failed responses produce nine repair requests. The last
validation error remains in history and the terminal ledger record. Exhaustion
leaves the TUI open, preserves the editor draft and history, and requires an
explicit new submission before more work can start.

Run `npx vitest run test/unit/response-repair.test.ts test/unit/review-cycle.test.ts test/integration/response-repair-*.test.ts test/integration/execution-check-in.test.ts test/integration/terminal-cancellation.test.ts`.
The fixture providers exercise real Pi sessions, tool denial, one completed
write, compaction cleanup, paused execution, and exact attempt counts without
paid inference. Run `npm run verify:terminal` separately to check both terminal
interfaces in real PTYs. Builds remove `dist`; do not run them concurrently
with tests or terminal verification.
