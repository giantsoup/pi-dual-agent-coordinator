# Prominent current activity with chronological agent history

Status: proposed for review. The user accepted the visual direction, then requested
this implementation plan. Application implementation and runtime activation have
not started.

Source baseline: `main` at `5bdbd48`, inspected on 2026-10-19. The unrelated
untracked `unit-converter-test/` directory is outside this work.

## Accepted design and scope

Use the [accepted 120-column by 80-row mockup](research/current-activity-120x80.html)
as the visual reference. It contains fictional prose, timestamps, tool counts,
and verification results. Its browser controls illustrate different moments in
one workflow. They are not proposed terminal controls.

The product has three main regions: chronological narrative history, a prominent
**Current activity** panel immediately above the composer, and the existing
multiline composer. The current action is the strongest text in the lower region.
The narrative keeps both agents' earlier responses visible as work passes between
A and B. Tool batches start folded and remain inspectable after completion.

This refactor changes presentation and shared UI activity state. It preserves
coordinator approval, execution supervision, response repair, runtime ownership,
archive access, and sandbox policy. It introduces no dependencies, configuration
flags, synthetic narration, or new model requests.

The primary acceptance question is: can the operator immediately identify who is
active, what is happening, and whether anything is waiting for their action?

## Current implementation and gaps

The following source owns the behavior at the inspected baseline:

| Owner | Existing behavior | Required change |
| --- | --- | --- |
| [TUI app](../src/app/tui/app.ts) | Reserves one truncated live line. Optional diagnostics take up to eight rows. | Allocate a dedicated live panel and consolidate duplicate status text. |
| [Workspace](../src/app/tui/workspace.ts) | Renders chronological response blocks, folds, history, inspectors, unread activity, and scroll anchors. Its pointer falls back to `No tool currently running`. | Preserve navigation and narrative. Replace the pointer's activity selection with the shared activity view. |
| [Activity summaries](../src/app/activity-summary.ts) | Uses the same generic reasoning snapshot for `text_delta` and `thinking_delta`. Provides existing tool sanitizers. | Distinguish observed activity types and retain safe tool summaries. |
| [Service](../src/app/interactive/service.ts) and [store](../src/app/interactive/store.ts) | Consume telemetry, status, and runtime prose. Retain activity and recent calls. | Own one correlated live activity state for all renderers. |
| [History index](../src/app/interactive/history.ts) and [transcript](../src/app/interactive/transcript.ts) | Retain record metadata, event order, and archive-backed prose. | Project operator and coordinator milestones into the narrative without duplicating messages. |
| [Normalizer](../src/telemetry/event-normalizer.ts) | Retains assistant event types without raw thinking deltas. | Reuse safe metadata. Extend it only if a required identity or event boundary is missing. |
| [TUI bootstrap](../src/app/tui/bootstrap.ts) | Refreshes elapsed display every 500 ms during work and model loading. | Reuse the timer for the marker and elapsed values, including cancellation cleanup. |

The installed Pi 1.3.0 declarations distinguish thinking, text, and tool-call
start, delta, and end events. Preparing a call is therefore distinguishable from
executing it. Native tool execution events remain the evidence that a tool ran.

No dedicated blinking `Thinking` label was reproduced in this checkout or the
launcher snapshot inspected during the investigation. An already-running session
can use another installation. The implementation must verify the new rendered
behavior rather than assume an older screenshot identifies the current build.

## Layout contract

### Reserve the live panel before the transcript

Keep the full-width narrative above the live panel. Keep the mounted editor and
contextual footer below it. The live panel is visible by default and remains
visible when optional diagnostics are closed.

At normal sizes, show these fields in order:

1. **Current activity** heading and a textual live or terminal state.
2. Active role, current model, and workflow phase. Show `Coordinator` for operator
   waits, transitions, and cleanup that have no active model.
3. A bold current action on its own row. Only a small adjacent marker animates.
4. Sanitized tool target or command, when applicable. Wrap within the panel budget.
5. Action elapsed time and age of the last relevant event.
6. Existing execution or response-repair progress, when relevant.
7. Recent completed activity and the next available operator action.

Use actual content to choose optional rows. Omit unknown values. Do not fill gaps
with session IDs, health metadata, or a guessed description of the model's intent.
Those details remain available through diagnostics and inspection.

The following allocations are targets with a four-row editor and two footer rows:

| Terminal | Header | Narrative | Live panel | Editor | Footer | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 120 by 80 | 1 | 63 | 10 | 4 | 2 | 80 |
| 120 by 40 | 1 | 23 | 10 | 4 | 2 | 40 |
| 80 by 24 | 1 | 10 | 7 | 4 | 2 | 24 |

The accepted mockup uses one footer row and 64 narrative rows at 120 by 80.
The implementation reserves the existing second contextual footer row, reducing
the narrative by one row. This preserves notifications and control hints.

Measure the real Pi editor output. A multiline draft or completion menu changes
the available height. Take additional rows from the narrative first. Then drop
recent activity, next-step detail, and secondary metrics before reducing the
current action. Keep the editor's bounded viewport and IME cursor marker intact.
Bound the total rendered rows and visible terminal-cell width after every resize.

Below 80 by 24, retain compact-mode input, cancellation, and exit handling.
Show a short current-action summary when space permits, ahead of narrative detail.
At tiny sizes, editor and essential controls take priority over decorative frames.
Test 40 by 12 explicitly.

Use the terminal's font size and default prose colors. Keep cyan accents for A,
amber accents for B, and bold text rather than colored fills. Honor `NO_COLOR`
and `TERM=dumb`. State words and role labels carry meaning without color or motion.
Use the existing render cadence, not ANSI blink or whole-line visibility changes.

### Preserve visibility while browsing

Request history, the read-only inspector, help, and the controls menu replace the
body region. They do not replace the live panel or editor. Existing model-loading
and model-error modals remain authoritative for their own operation details.
The live panel reflects that loading or error state rather than showing a stale
model run beneath the modal.

Keep unread activity and the return-to-current hint visible in the live panel
when the current narrative is hidden or paused. Viewing that status does not mark
hidden narrative as read. Preserve the existing acknowledgement rules when the
operator returns to visible current output.

Optional **Activity** diagnostics remain controlled by Esc, then a, and F2.
Diagnostics use body space above the pinned panel. Their scroll position cannot
hide the current action. Remove the competing `Now:` line from diagnostics once
the pinned panel replaces it.

## Activity state and transition contract

Add a discriminated live activity model under [UI types](../src/types/ui.ts),
with reduction in a proposed `src/app/interactive/current-activity.ts` module.
Use distinct variants rather than flags that permit contradictory states.
Keep workflow phase separate from the observed action: final review can involve
thinking, response writing, or a read tool.

The reducer consumes existing status, lifecycle, normalized assistant events, and
correlated native tool events. It does not submit prompts or drive workflows.
The expected display mapping is:

| Evidence or condition | Current action | Exit condition |
| --- | --- | --- |
| Operation accepted, no active run yet | Preparing Agent A or preparing the next role | Run starts or operation terminates |
| Run starts, no content activity yet | Waiting for model response | Thinking, text, tool preparation, or terminal event |
| `thinking_start` or `thinking_delta` | Thinking | Thinking ends, another action starts, or operation terminates |
| `text_start` or `text_delta` | Writing a response | Text ends, another action starts, or operation terminates |
| Tool-call construction events | Preparing a tool call | Native execution starts or construction ends |
| Native tool execution start or update | Running a command, reading a file, or another sanitized tool action | Correlated tool result |
| Content ends, no running tool or next action | Waiting for the next model event | Next observed action or terminal event |
| Coordinator begins check-in, review, or format repair | Preparing the named phase, then the observed action | Existing coordinator lifecycle advances |
| Plan ready and no operation running | Waiting for your approval | Explicit operator action |
| Model inventory, loading, or switch progress | Existing safe setup-progress label | Setup settles or cancels |
| Cancellation requested | Cancelling; waiting for runtime cleanup | Existing service operation leaves cancellation |
| Completed, failed, cancelled, timed out, or restored interrupted work | Explicit terminal outcome | Next accepted operation |

Operation terminal state and cancellation take precedence over late model events.
Within a running operation, native running calls take precedence over partial
model prose. Display one call plus an additional-call count when several calls are
active. Ending one call must not clear another running call.

Scope model activity to the current operator request, current role binding,
session, and run. Scope calls by their existing composite identity. Preserve B's
run identity when execution resumes after an A check-in. Choose the active role
from current coordinator state and matching events, not the last unfinished run
in an array. Missing correlation produces a conservative waiting state rather
than borrowing another request's activity.

Retain a stable start time for each action. Deltas update last-event time without
resetting action duration. A new call receives its own start time. Timer ticks,
key presses, resize, and archive hydration are not model activity. Use an injectable
monotonic clock for live elapsed values and existing timestamps for retained work.
Do not invent durations when retained timestamps are missing or invalid.

Last-event age reports silence directly. A long gap does not prove a hang and
must not trigger automatic retries, new prompts, or a failure label.

Recent activity contains at most three safe entries from the current request,
with fewer at small sizes. Reuse indexed tool outcomes and current lifecycle
events. Do not copy the session-wide recent list without filtering its ownership.
Deduplicate repeated events by identity, and retain failed or cancelled outcomes.

## Narrative history contract

Retain the existing `HistoryIndex`, `RequestTranscript`, Pi archive readers, and
bounded Markdown rendering. Extend the chronological projection instead of adding
a second transcript store. The visible sequence can contain:

1. The accepted operator request and A's planning prose.
2. A validated plan and an operator approval or discard milestone.
3. B's implementation prose and folded tool batches.
4. A's check-in and B's continued execution.
5. A's revision request, B's revision, and subsequent review.
6. The validated final decision or another terminal result.

These entries appear only when evidence exists. Models are not required to
narrate every tool call. Show an honest activity state when no prose arrives.
Never generate prose to make a sparse session resemble the fictional example.

Run headings show role, phase, execution outcome, and available start/end times.
When B continues the same run after A speaks, show a continuation heading rather
than imply another operator request or fabricate a new run. Follow indexed event
sequence across roles. Archive hydration must preserve the same ordering.

Keep execution outcome and review disposition separate. `runtime.run_finished`
means the run settled. It does not mean A approved the work. Show `Revision
requested` or `Approved` only from validated review or workflow evidence associated
with that run or request. Use existing protocol schemas and retained records.
Do not infer decisions from prose, a zero exit status, or a completed tool group.

Project approval, discard, and check-in milestones from existing correlated
planning and workflow events. Add a narrow typed presentation block if needed.
Preserve reconstruction from telemetry and archives, including older records that
lack these fields. Unknown historical decisions remain unknown. New presentation
metadata must be optional for old records and must not require an archive rewrite.

Assistant claims about changes or tests remain reported claims. Native tool
results provide execution evidence. A completed command is not automatically a
passing test suite. The mockup's sample test results must not become product defaults.

Keep raw workflow blocks, hidden reasoning, partial reasoning, signatures, and
opaque payloads out of the narrative and live panel. `Thinking` describes observed
event type only. Reuse existing redaction, terminal-control stripping, safe command
previews, and validated readable workflow fields. Adding reasoning summaries is
outside this implementation scope.

Milestones belong to a request and have their own stable event identity. Model
responses and tool groups retain their existing run ownership. Represent those
different owners explicitly in the presentation union. Do not invent a model run
to fit an approval event into the current run-owned `TranscriptBlock` shape.

### Preserve tools, reading position, and replay

Tool groups start folded. Preserve the existing run-level Right, Space, and Left
controls to expose or hide individual calls. Folding tools keeps prose visible.
Enter on a selected run or call opens read-only inspection. Long response previews
remain bounded at the existing 24,000-character limit, with a path to retained
output. Failed, running, cancelled, timed-out, and interrupted calls remain visible
in group totals. Do not merge groups across prose or A's check-in boundaries.

Following mode tracks the latest narrative. Manual scrolling pauses following
and anchors to record identity. New events, panel resizing, and archive completion
must preserve that reading position. Esc, then l, returns to the current request
and resumes following. History choice remains presentation-only. New submissions
continue the current conversation regardless of the displayed request.

Preserve provisional history selection, focus restoration, bracketed-paste
isolation, draft text, draft cursor, folds, and delayed-inspector generation checks.
The live panel is informational and adds no focus target or shortcut. Mouse bounds
must use the same computed rectangles as rendering, so wheel events cannot scroll
a covered transcript or treat the pinned panel as narrative.

Restart reconstructs history read-only and marks unfinished work interrupted.
It does not restart prompts, tool calls, execution, or a pending approval. Missing
archives keep explicit unavailable reasons. Inspection must not repair or mutate
session files.

## Implementation ownership and sequence

Proposed new paths below do not exist at this baseline. Keep their interfaces
small and derive types from existing status, history, and SDK declarations.

| Area | Proposed change |
| --- | --- |
| Shared activity | Add `src/app/interactive/current-activity.ts`; wire reduction through the existing service and store. Use exhaustive variants in `src/types/ui.ts`. |
| TUI panel | Add `src/app/tui/current-activity.ts` for safe wrapping, row priorities, role accents, and marker rendering. Pass state and time into a pure renderer. |
| App geometry | In `src/app/tui/app.ts`, compute panel, body, editor, and footer rectangles together. Replace the old pointer line and diagnostics `Now:` rendering. |
| Workspace | Preserve narrative rendering and navigation. Expose one read-only view-status snapshot for unread count and return hints rather than selecting activity inside `pointer()`. |
| Narrative projection | Extend existing history and transcript owners for evidenced milestones and review labels. Reuse archive hydration and stable block IDs. |
| Plain REPL | Consume the shared activity semantics through existing progress presentation. Keep line-oriented output and avoid animation-only output or per-delta noise. |
| Event boundary | Reuse current normalized event types. If necessary, add only safe correlation or lifecycle metadata in existing telemetry and runtime bridge owners. |

Implement and verify these units in order:

1. Add the activity reducer and transition regressions. Confirm correlation,
   cancellation precedence, parallel calls, and stable timing before changing layout.
2. Add the panel renderer and shared geometry. Replace duplicate live selection
   rather than leave a compatibility pointer that can disagree with the panel.
3. Complete narrative milestones and heading labels. Prove chronological replay,
   continuation behavior, and the distinction between run completion and approval.
4. Integrate browsing, diagnostics, input, and resize behavior. Reuse the bootstrap
   timer and clear it through the existing shutdown path.
5. Extend real Pi fixtures and PTY captures, then update README and the terminal
   guide to describe only implemented behavior. Record current evidence separately
   from historical verification reports.

Keep strict NodeNext TypeScript, `.js` relative imports, `import type`, and existing
schema libraries. Validate external data at existing boundaries. Avoid unchecked
casts, new parsing layers, dependencies, and workflow transitions in renderers.

## Verification and acceptance

Use [CONTRIBUTING](../CONTRIBUTING.md), [terminal controls](terminal-experience.md),
and [the security model](security-model.md) as the implementation constraints.
Read [secure setup](secure-setup.md) before any credential-backed check. Select
Node 24.22.0 and npm 12.2.0 locally, without changing global defaults. Run `npm ci`
when preparing a fresh implementation checkout.

Extend the existing unit and integration coverage rather than replace it:

- [Activity summaries](../test/unit/activity-summary.test.ts),
  [activity history](../test/unit/activity-history.test.ts), and
  [event normalization](../test/unit/event-normalizer.test.ts) cover safe events.
- [Narrative workspace](../test/unit/narrative-workspace.test.ts),
  [request transcript](../test/unit/request-transcript.test.ts),
  [workspace controls](../test/unit/workspace-controls.test.ts), and
  [terminal interaction](../test/unit/terminal-interaction.test.ts) cover reading
  position, controls, and chronological projection.
- [Real Pi narrative integration](../test/integration/narrative-transcript.test.ts)
  covers actual tools, archive reconstruction, and unchanged session files.
  Extend fixtures through A planning, explicit approval, B tools, A check-in,
  B continuation, A revision request, B revision, and final A review.
- [The PTY verifier](../scripts/verify-terminal.py) and
  [terminal fixture](../test/fixtures/terminal-app.mjs) cover the rendered product.

The implementation acceptance matrix is:

| Scenario | Required observation |
| --- | --- |
| Thinking, writing, tool preparation, execution, and waiting | Correct action appears from observed events. Primary text remains steady. |
| Tool completion and concurrent calls | Result matches the call identity. Another running call stays visible. |
| Role handoff and late events | A and B change at actual boundaries. Old runs cannot replace live status. |
| Plan approval and final review | B starts only after explicit approval. Completion and sign-off labels remain distinct. |
| Check-in and revision loop | Narrative order survives live rendering, archive hydration, and restart. |
| Hidden history, help, and inspector | Current activity stays visible. Hidden narrative remains unread. No runtime mutation occurs. |
| Long command, Unicode, and multiline draft | Action, controls, cursor, and draft remain usable without row or cell overflow. |
| Cancellation and provider failure | Cleanup stays visible until settlement. Completed changes survive. No automatic retry occurs. |
| Compact terminal and resize | Test 40 by 12, 80 by 24, 120 by 40, and 120 by 80, including repeated resize. |
| Color and motion independence | Role and state remain understandable without color or animated text. `TERM=dumb` uses a static marker. |
| Missing archive and interrupted restart | Explicit unavailable or interrupted status. No invented success, approval, or duration. |
| Secret-like values and control sequences | Existing redaction and safe display boundaries hold in folded and expanded views. |

Run the required checks from `package.json`:

```sh
node --version
npm --version
npm run check
npm test -- test/unit/activity-summary.test.ts test/unit/activity-history.test.ts test/unit/event-normalizer.test.ts test/unit/narrative-workspace.test.ts test/unit/request-transcript.test.ts test/unit/workspace-controls.test.ts test/unit/terminal-interaction.test.ts test/unit/tui-app.test.ts
npm test -- test/integration/narrative-transcript.test.ts
npm test
npm run build
npm run verify:dependencies
npm run verify:terminal
git diff --check
```

Add any new reducer and renderer test files to the focused run. Keep the Vitest
fork pool and two-worker cap. Run build-dependent checks sequentially because
they replace `dist`. If implementation changes runtime construction, isolation,
security, tools, or MCP boundaries, also run `npm run verify:isolation`.

Inspect actual rendered interactions and retain PTY captures for all target sizes,
including the full 120 by 80 narrative. Screen capture mode uses
`PI_TUI_SCREEN_CAPTURE=1` and requires the Python packages documented by the verifier,
including `pyte` and `wcwidth`. A browser mockup is design evidence, not terminal proof.

Live inference remains a separate gate. After fixture and PTY checks pass, prepare
a new trusted installation outside the writable workspace. Verify that installation
before any credential-backed session. For local inference, run
`bin/node scripts/verify-local-executor.mjs` from that trusted installation, using
the saved, already-loaded LM Studio model. Follow secure setup for bounded live
OpenAI verification. Restart into the verified snapshot for live UI observation.
Building source alone does not update an existing running session.

Report fixture, PTY, isolation, and live-provider results separately. A live model
does not have to reproduce the fictional wording or number of revisions. The
coordinator must still display the events that actually occur.

## Review boundary and evidence so far

This document and its reference HTML are the only intended repository additions.
Do not modify application code, install a runtime, redirect the launcher, or start
live inference as part of preparing this plan. Implementation begins after the
user reviews the proposal and requests it.

During the preceding investigation at the same source commit, Node 24.22.0 and
npm 12.2.0 were verified. `npm run check` and 104 tests across six focused files
passed. Those files were `tui-app`, `workspace-controls`, `terminal-interaction`,
`activity-summary`, `activity-history`, and `event-normalizer` under `test/unit/`.
The mockup's three selectable moments passed 120-column and 80-row assertions and
were visually previewed at 728 and 1000 CSS pixels. These checks establish the
baseline and design artifact, not an implemented refactor. Full-suite, new PTY,
isolation, and live-provider results are not claimed by this plan.

Plan preparation checked all 25 local links, referenced npm scripts, focused test
paths, and row-budget totals against the checkout. The saved HTML matches the
accepted example. Its three moments still satisfy the 120-column by 80-row
assertions when rendered from the saved file. Both additions passed whitespace
checks. Application tests were not rerun for these documentation-only additions.
