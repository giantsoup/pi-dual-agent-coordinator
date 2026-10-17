# Execution process check-ins

Agent B can make many model requests inside one handoff. The normal Agent A
review happens after completion, which leaves repeated attempts and scope drift
unchecked during a long run. A process check-in adds a review at turns 10, 20,
and later multiples of 10 while B still has tool work underway.

`WorkflowOrchestrator` creates one `createExecutionSupervisor` callback per
handoff and passes it through delivery and any completion-protocol repair.
`RuntimeEventBridge` forwards the callback as the `onTurnEnd` prompt option.
`ManagedSession` installs it on the raw Pi agent for that submission. Pi awaits
that listener after tools finish and before polling steering or requesting the
next model response. Ordinary session notifications cannot enforce this pause.

A receives the approved handoff and facts from at most 10 recent turns. Facts
include tool names, sanitized targets, and success or error outcomes, with
redaction before truncation. Assistant prose, raw arguments, and tool output are
excluded. A can use its existing read-only tools
for targeted inspection. It returns one `pi-check-in` block containing the exact
workflow, handoff, iteration, and turn count, plus a `continue`, `redirect`, or
`blocked` decision, a brief reason, and at most five next steps.

The coordinator validates the response and constructs B's steering message from
the accepted fields. A redirect needs at least one next step. An invalid
response, provider failure, or blocked decision stops B before another model
request. Routine check-ins preserve B's active run and do not abort or resubmit
its handoff. A terminal response at a threshold goes to normal completion
validation and review instead.

Check-ins emit correlated started, completed, and failed telemetry. An intentional
block is a completed check-in with decision `blocked`. Invalid guidance fails
immediately, without the protocol-repair retry used for completion blocks, so a
required process check cannot turn into a new retry loop. Check-ins do not
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
completed B turns and the next check without counting operator requests or tool
calls. A response with multiple tools counts once. Provider errors and aborted
responses do not count. Completion repair shares the handoff's supervisor; a new
handoff starts at zero. The activity line follows the tool list, and resumed B
tools appear after the A check-in that preceded them.

## Design choice

Two designs were compared: a handoff-scoped callback using the existing prompt
lifecycle, and a separate runtime supervisor with explicit subscription and
steering controls. The callback design keeps fewer public controls and preserves
delivery preflight, completion repair, and cancellation ownership. It uses the
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
