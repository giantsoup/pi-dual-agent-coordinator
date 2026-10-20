# Agent A summaries and visible history compaction

Status: implemented in source. See [verification outcomes](agent-a-compaction-verification.md)
for current checks, operational limits, and trusted-install status. The sections
below retain the approved implementation plan and its original investigation.

Prepared on 2026-10-20 against `main` at
`5d3967c14a1c45ad59bdd6ab730fbe4fb200575a`, with installed Pi packages 1.3.0.
Recheck the public SDK contracts if that baseline changes.

## Intended behavior

The coordinator uses Agent A's currently selected approved model to summarize
both A's and B's histories. B's execution requests remain local to LM Studio.
Compaction visibly pauses the affected conversation, preserves completed work,
and resumes only after the rebuilt request fits its context budget. Failure
stops the submission with a clear outcome instead of continuing unchanged.

The TUI must make the pause obvious without opening diagnostics. For B, show
**Agent A is compacting Agent B's history**, the elapsed time, and the existing
cancel control. Show equivalent wording when A compacts its own history. Record
completion, cancellation, or failure in request history. Plain mode reports the
same transitions without repeatedly printing a timer.

## What the investigation established

- Both roles enable Pi automatic compaction in
  [create-role-runtime](../src/runtime/create-role-runtime.ts). Default summary
  generation uses the source role's model: B currently summarizes B locally.
  [local-executor.test.ts](../test/integration/local-executor.test.ts) explicitly
  tests that routing.
- B's descriptor has a 65,536-token window and 16,384-token maximum output in
  [models](../src/security/models.ts). LM Studio readiness verifies a loaded
  instance with at least that context. Larger advertised model capacity does
  not increase the application's selected budget.
- Pi's default reserve is 16,384 and its retained recent history target is
  20,000 tokens. The nominal B trigger is strictly above 49,152 tokens. Pi 1.3
  checks between tool turns as well as at prompt/run boundaries. This is already
  automatic; a missing between-tool-turn check is not the diagnosis.
- Pi estimates context size and clamps output allowance, but does not thereby
  prove that the final input fits. New input, steering, tools, and template
  overhead require admission after request assembly.
- Pi catches automatic compaction failures and can continue with the unchanged
  projection. [ManagedSession](../src/runtime/managed-session.ts) waits for
  settlement but does not propagate `compaction_end.errorMessage`.
- [The broker](../src/security/provider-broker.ts) replaces upstream error bodies
  with generic messages, removing recognizable LM Studio context-overflow errors.
- [Telemetry](../src/telemetry/event-normalizer.ts) currently retains compaction
  event names with empty details. The
  [current activity reducer](../src/app/interactive/current-activity.ts) does not
  handle them. Compaction has no dedicated visible state today.
- Compaction changes active context, while the raw Pi archive remains available
  through [read-only history](../src/runtime/session-history.ts).

The specific suspected long-session incident is unidentified. The five newest B
sessions under this repository's default state root recorded peak input below
29,000 tokens; that limited sample does not rule out another session or workspace.
The user's concern also includes compaction occurring without visible feedback.

Two temporary fixture tests reproduced current defects using real source/SDK
paths and dummy providers: the broker removes a recognizable overflow category;
and a B tool loop sends another generation request after its summary request
fails with HTTP 503. The latter uses synthetic usage to force the trigger; it
does not prove a real 65,536-token overflow.

Upstream references:
[Pi 1.3 compaction](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/compaction.md)
documents the hook, persistence, and between-turn behavior.
[LM Studio tokenization](https://github.com/lmstudio-ai/docs/blob/main/2_typescript/5_tokenization/index.md)
documents template application and token counting. Installed declarations and
implementation were inspected alongside these references.

## Architecture and ownership

Use a coordinator-owned, stateless A-model summarizer. It has an independent
tools-disabled request lifetime and no planning conversation, AgentSession,
workspace tools, MCP connection, resource discovery, or workflow-block parser.
It uses the existing trusted broker and public `ModelRuntime` APIs, with the
same approved model selection as A. Keep its broker lifetime independent of A's
ordinary session so replacement cannot dispose a borrowed capability mid-summary.
Create it lazily; a B-only runtime must not eagerly retrieve a cloud credential.

Each role gets a trusted `session_before_compact` extension that delegates only
summary generation to this capability and returns a public `CompactionResult`.
Pi still owns checkpoint append, retained-entry boundaries, and context rebuild.
B receives a role-bound callback, never an OpenAI model runtime, credential,
endpoint override, selectable summarization tool, or general cloud capability.

Caller-first sketch, not implementation:

```ts
// Trusted coordinator construction; neither callback is model-configurable.
const summarizer = createAgentASummarizer(validatedAgentASelection);
const binding = await createRoleRuntime({
  ...roleOptions,
  summarizeCompaction: (request, signal) => summarizer.summarize(request, signal)
});

// Proposed runtime-private types. Derive SDK values from public exports.
type Preparation = SessionBeforeCompactEvent["preparation"];
type SummaryRequest = Readonly<{
  target: Readonly<{
    role: Role;
    sessionId: string;
    generation: number;
    leafId: string | null;
  }>;
  preparation: Preparation;
}>;

interface AgentASummarizer {
  summarize(request: SummaryRequest, signal: AbortSignal): Promise<CompactionResult>;
  dispose(): Promise<void>; // Abort and drain owned requests.
}
```

`CompactionPreparation` is not a package-root export in installed Pi 1.3.0;
derive it as shown instead of importing a private SDK path. The interface hides
model/broker selection, bounded prompts, validation, chunking, cancellation, and
usage accounting. Keep generation and leaf checks in the target runtime adapter.

Proposed owners:

- `src/runtime/agent-a-summarizer.ts`: independent A-only inference and summary
  validation. Separate summary output limits from compaction trigger reserves.
- `src/runtime/compaction.ts`: trusted hook, snapshot identity, failure latch,
  Pi result adaptation, and correlated compaction lifecycle.
- `src/runtime/context-budget.ts`: request admission policy and budget evidence.
  `create-role-runtime.ts` installs it at public request/payload boundaries;
  `managed-session.ts` owns settlement and failure propagation.
- `src/security/`: retain model/broker policy; classify bounded upstream errors
  and own any validated model-tokenization adapter.
- `src/coordinator/`: construct/dispose the summarizer and update it atomically
  with A model changes. Preserve workflow approval and execution decisions.
- `src/telemetry/`, `src/types/ui.ts`, and `src/app/interactive/`: correlate
  compaction and project shared UI state. TUI and plain renderers display it.

## Implementation sequence and acceptance gates

### 1. Prove the SDK integration and failure boundary

Promote the reproduced defects into repository regression tests. Add real Pi
fixtures for B-to-A summaries and A self-compaction before broad integration.

The hook must catch summary errors, latch a typed context-management failure,
call public `ctx.abort()` to stop the source loop, and explicitly return
`{ cancel: true }`. Do not await session idle inside the hook; the managed owner
drains after the hook returns. Pi's extension dispatcher catches thrown
handlers; throwing alone can fall through to default B summarization. A missing
summarizer also cancels and fails explicitly. Never silently use local summaries.
Handle public `session_compact_failed` as well, so persistence/rebuild failures
after a successful summary latch failure and abort before another turn. Keep the
original failure classification when an internal safety abort cancels Pi; it is
not an operator cancellation. Clear obsolete queued steering/follow-ups during
owned cleanup so they cannot leak into a later operator submission.

ManagedSession must propagate failed compaction after cleanup and refuse further
provider dispatch once failure is latched. Cancellation remains a distinct
outcome. Retain formatting repair's tools-disabled lifetime through compaction;
context errors must not enter response-format repair or redeliver a handoff.

Acceptance: an A summary failure produces no B summary fallback, no later B
request, no checkpoint, and no repeated workspace operation. A self-compaction
settles without a nested prompt or deadlock.

### 2. Enforce a budget for the complete outgoing request

For every conversation and summary request, require:

```text
input allowance + output allowance + safety margin <= effective context window
```

Count system/project instructions, the active tool schemas and loadout, chat
template overhead, previous summary, retained messages, new input, tool results,
steering, and supported image content. Treat output reasoning as part of the
provider's bounded output accounting. Recheck after all queued input is assembled,
including the first prompt, restored sessions, check-ins, and format repairs.
Use public `onPayload`/request APIs and validated narrowing at the boundary.
The last provider usage value and Pi's character estimates are trigger signals,
not independent proof that the next serialized request fits.

For B, retain the selected 65,536 budget unless a separate model-policy change
explicitly changes it; verify the actual loaded instance is sufficient. An
initial tuning candidate is a 20,480-token reserve: 16,384 output plus 4,096
safety, giving a 45,056 input threshold. Validate this with measured payloads
before adopting it. Start with Pi's 20,000 recent-token target; budget the final
summary separately, initially targeting at most 4,096 tokens including wrappers.
These are proposed settings, not observed guarantees.

First prove counting against the exact loaded model, template, tools, and image
path. LM Studio's documented SDK text-count example alone does not prove parity
with this OpenAI-compatible tool request. Prefer a supported matching tokenizer
adapter; if it needs a dependency, pin and audit it and synchronize the lockfile.
Do not invent a REST tokenization endpoint or relax the sandbox. A validated
conservative upper bound is acceptable where exact counting is unavailable;
otherwise reject unsupported admission rather than claim exact safety.
Revalidate counting when the loaded instance/template/model changes.

Preserve Pi's automatic preparation at supported boundaries. After acquiring
ManagedSession submission/abort ownership, precompact existing history if needed
as part of owned preflight, before provider dispatch. Do not compact externally
while ManagedSession is stopped: its current listener aborts that work. At the
final request boundary, reject a request that still cannot fit; do not call manual
`compact()` inside an active stream, because it aborts that operation. Bound any additional
reductions, require measurable progress, and recheck the rebuilt request.
An indivisible oversized input, tool group, or schema loadout gets an actionable
error. Never silently discard the newest operator instruction or orphan tool
calls/results. Lack of count evidence also stops dispatch.

Acceptance: capture actual outgoing payloads across multiple real Pi tool turns
and compactions. Demonstrate admission/refusal around the boundary and prove
rejected requests never reach either provider. Cancel during owned preflight and
prove there is no abort-on-start race, late dispatch, or orphaned promise.

### 3. Generate bounded summaries and preserve durable state

Use public Pi `compact(preparation, approvedAModel, ..., trustedToolFreeStream)`
for the normal hook path. The stream belongs to the independent A capability,
not B's provider-pinned stream. Preserve its split-turn, validation, and file-list
semantics. For repeated extension-produced checkpoints, explicitly carry forward
and version cumulative file-operation details; test inheritance rather than
assuming Pi treats custom details like built-in summaries. Serialization omits
thinking and bounds tool-result text; preserve references to omitted evidence rather than claiming
the summary contains complete output. Redact history before it reaches A.
Treat transcript contents as untrusted data, not instructions to execute.

Preserve the objective, operator constraints, completed actions with observed
results, outstanding work, relevant files, test outcomes, failures, and precise
continuation point. Coordinator approval, ledger facts, and execution evidence
remain authoritative outside the generated summary. Summary text cannot grant
approval, trigger a workflow block, or establish that a tool ran.

Large A histories require bounded chunk-and-reduce generation with a per-request
budget, total job deadline, finite request/reduction count, and progress check.
Use the remaining coordinator operation deadline rather than resetting it for
each chunk; retain broker request timeouts. Start with a maximum of eight summary
provider calls per job, shared across chunking and reduction, and test exhaustion.
Previous summaries and individual giant old messages need the same protection.
No recursive compaction or unbounded retry. A stop reason of error, aborted, or
length, an empty summary, or tool-call output is not a valid checkpoint.
Validate the final merged summary and retained tail against the target budget,
including helper-added wrappers/file lists. Retry reduction only within the
explicit job bound; otherwise stop with history intact.

Snapshot source role/session/generation/leaf and A model selection for each job.
Cancel/drain before replacement, reject stale output before returning it to Pi,
and rebind hooks/subscriptions for each new session. Preserve public Pi checkpoint
semantics and raw archive bytes. Record A summary usage separately from B
execution usage, even when Pi stores the compaction on B's session.
Restart restores valid checkpoints and marks unfinished operations interrupted;
it never resumes execution or an unfinished summary automatically.

Acceptance: repeated compaction and restart preserve task facts, file tracking,
valid tool pairs, archives, and completed edits. Cancellation/model replacement
during any summary stage leaves no late commit or provider request.

### 4. Make compaction visible in the TUI and plain REPL

Emit a correlated start event before waiting on summary inference, then a terminal
event on every path. Report success only after Pi's checkpoint/rebuild succeeds,
not when the helper returns text. Include job/operation identity, target
role/session/generation,
parent request/run where one exists, summarizer role/model, trigger, timestamps,
counting method, before/after budgets, and sanitized outcome. Never log broker
tokens, raw history, summary contents, or reasoning. A preflight compaction can
start before a role run exists; do not require or invent an A workflow run ID.

Add a discriminated compaction action to shared UI state. Keep workflow
`activeRole` and approval state authoritative; using A for a B summary does not
turn it into an A planning/review run. Validate job/session identity before
accepting events. A late event from an old session cannot change the display.

While running, the Current activity panel shows:

```text
Agent A is compacting Agent B's history
Execution paused · elapsed 12s · Cancel: Ctrl+C
```

Show the equivalent A-to-A state. Use the existing elapsed timer and controls.
Ctrl+C remains the cancel path while browsing history; show Esc then x only in
contexts where that sequence reaches the cancel control directly.
Do not invent percentage progress or label the pause as tool execution. Keep
the action visible with diagnostics hidden and while browsing earlier history.
Cancellation takes display precedence and stays visible until requests drain.
At small terminal heights, preserve the action and cancel hint before optional
budget/model detail. Avoid color-only distinctions.

On success, add a durable milestone such as `B history compacted by A; execution
resuming` when execution actually continues. A final-answer compaction instead
reports completion without claiming execution resumed. Then render the true next
activity. On failure, show `History compaction failed; execution stopped` with a
sanitized reason; do not claim the run is merely waiting or silently retry it.
Plain mode prints start and terminal milestones once. Historical compaction
events without new fields remain inspectable with unknown details.

Acceptance: inspect real rendered PTY captures in TUI and plain mode for slow
summaries, A-to-A/B-to-A, success, failure, cancellation, resize, history browsing,
hidden diagnostics, and stale/duplicate events. Fast compactions still leave a
history milestone; do not delay real work just to animate the pause.

### 5. Verify and deliver

Use the scoped Node 24.22.0/npm 12.2.0 toolchain and follow
[CONTRIBUTING](../CONTRIBUTING.md). Reuse existing fixtures and temporary
workspaces. Keep Vitest's fork pool and two-worker cap.

Required regression coverage includes:

- Both summary routes use A's selected model; every B execution request stays
  local, and B cannot retrieve cloud credentials or choose a provider.
- Long real Pi tool loops cross the threshold repeatedly. Cover zero/missing/stale
  usage, large first/restored inputs, steering/check-ins, Unicode/code, growing
  tools, images where supported, giant old summaries, and oversized retained tails.
- Summary provider errors, hook exceptions, truncation, empty output, ineffective
  reductions, timeout, and cancellation produce bounded terminal outcomes.
- Preserve an allowlisted overflow category after bounded upstream-error parsing;
  discard arbitrary provider body text. Pi's one compact-and-retry limit remains
  bounded, with no replay of completed tool side effects or execution handoffs.
  Ordinary authentication, rate-limit, transport, and server failures must remain
  distinct; an HTTP 400 alone is not evidence of context overflow.
- Format-only repair stays tools-disabled; model switch/reset/restart and late
  events preserve subscription, generation, approval, and archive invariants.

Extend `local-executor`, `terminal-qa`, `response-repair-lifecycle`, runtime-rebind,
retained-history, telemetry, current-activity, and security tests as appropriate.
Run strict check, focused tests, full `npm test`, and build. Run
`verify:dependencies` for changed imports/dependencies, plus `verify:isolation`
and `verify:terminal`; keep build-dependent gates sequential. Update README,
architecture/security/terminal documentation, and the dependency API audit to
describe the new trusted summary path. Finish with `git diff --check` and a
review of the exact changed-file list.

After fixture/isolation/PTY gates, prepare a verified trusted installation outside
the writable workspace. Separately prove real A summaries and real B continuation
with the saved, already-loaded LM Studio model, including at least two compactions
and actual file/tool evidence. Run `bin/node scripts/verify-local-executor.mjs`
there and a separately bounded A-backed compaction verifier. Capture actual
budgets, visible states, and persisted checkpoints. Workspace-modified code must
never use real credentials. Passing fixtures or PTY checks are not live-provider
proof, and an existing running session needs restart to use an activated build.
Verify the live LM Studio path does not silently truncate history. Where its
supported inference API exposes an overflow policy, validate a stop-at-limit
policy; do not copy an SDK-only option into an unsupported REST payload. Counting
parity and observable overflow handling must cover the actual selected backend.

## Alternatives and synthesis

Reusing ordinary A via `ManagedSession.prompt()` cannot handle A self-compaction:
that prompt is already pending. Waiting for A idle would deadlock, while manual
compaction aborts the active operation. Branch/snapshot/restore adds mutable
workflow state and crash recovery merely to issue a summary request.

A dedicated helper AgentSession would avoid reentrancy but adds unnecessary
session/resource/event ownership. Use the stateless A capability as the base;
retain the helper candidate's explicit abort/drain, generation, and budget rules.
Do not reuse `noTools` smoke mode: it disables compaction and has unrelated
single-request/output/time limits.

Independent candidate review selected this stateless design over ordinary A
session reuse. It contributed explicit hook abort, managed preflight ownership,
public `compact` reuse, and cancellation hints valid during history browsing.
Rejected suggestions include private/root-unexported SDK imports, a borrowed
broker lifetime, and treating UTF-8 byte counts alone as proven provider-token
counts. The final plan retains counting parity as an implementation release gate.

The accepted tradeoff is extra bounded A inference and summary lifecycle code in
exchange for independent cancellation and an unchanged planning conversation.
The first implementation unit is the real Pi fixture proving A-to-A and B-to-A
summarization with failure stopping dispatch. Counting parity is a release gate,
not an assumption to hide behind a larger context window.

## Verification performed for this plan

- Inspected branch, clean initial diff, repository guidance, current source,
  installed SDK declarations/implementation, and upstream primary documentation.
- Verified Node `v24.22.0` and scoped `corepack npm` `12.2.0`.
- Existing focused compaction fixtures: 2 passed, 20 skipped across
  `local-executor.test.ts` and `terminal-qa.test.ts`.
- Temporary current-gap fixtures: 2 passed. An initial tool-loop fixture had no
  compactable history and did not trigger; seeding a retained-history span fixed
  the fixture. The final result establishes the failure path, not exact token fit.
- Existing response-repair lifecycle fixtures: 2 passed, including compaction
  success and cancellation while formatting tools remain disabled.
- No live inference, credential-backed execution, activation, or application
  changes were performed. Full build/isolation/PTY gates belong to implementation.
