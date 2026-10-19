# Plan narrative history for both agents

The [request-history pane refactor](tui-history-pane-refactor-plan.md) supersedes
only this document's persistent history rail, drawer, and history-navigation
recommendations. The request chooser is implemented separately. The narrative
transcript was outside that refactor. The response transcript and collapsed tool
totals are now implemented. The reasoning-summary, animation, and range-cursor
designs below remain proposals.

Date: 2026-10-18. Status: partially implemented, updated 2026-10-19.

The shipped response view retains ordinary model text from both roles and uses
read-only Pi archives for completed runs. Consecutive tool-only messages roll into
one batch until readable output or a role/run boundary. Run disclosure expands
the calls for inspection. This deliberately differs from the proposed per-message
batch boundary and independently selectable batch rows below. It preserves the
existing controls and groups tool-only model turns into a useful compact row.

Replace the current request pane's run-and-tool list with a chronological narrative. Show each agent's readable output where it occurred, followed by a single compact row for each uninterrupted batch of tool activity. Keep Agent A's planning, check-ins, review, and repair visible alongside Agent B's execution.

This plan uses the attached screenshot as the visual reference. Its defining pattern is readable paragraphs, whitespace, and a subdued `Ran 9 commands` row between updates. Adapt that pattern to the existing terminal workspace, role labels, inspector, and keyboard controls.

Use the [implementation prompt](tui-narrative-history-implementation-prompt.md) to hand this plan to an LLM for execution.

## Establish the implementation baseline

The investigation used `main` at `8532d2d` plus the current working-tree changes. Many relevant files already contain uncommitted changes, including response repairs, model selection, scrolling, and check-ins. Other work was changing during the investigation. Re-read those files before implementation. Do not apply a patch against the commit alone or discard existing work.

The stack is Node.js ESM, strict TypeScript with `NodeNext` resolution, Zod, Vitest, and Pi. All four installed Pi packages inspected here, `pi-ai`, `pi-agent-core`, `pi-coding-agent`, and `pi-tui`, are version `0.67.68`. Use those installed interfaces. The separate [Pi upgrade plan](pi-upgrade-plan.md) is not a prerequisite for this feature. Revalidate the adapter if that upgrade lands first.

Follow [Contributing](../CONTRIBUTING.md), [architecture decisions](architecture-decisions.md), [security model](security-model.md), and [terminal behavior](terminal-experience.md). Preserve coordinator ownership of scheduling, approval, cancellation, and runtime replacement. Viewing history must remain read-only. The existing [Step 0 verification](step-0-verification.md) is historical evidence, not a new verification of this checkout.

Deliver this feature in source and tests before considering installation. Use dummy-provider fixtures for repeatable verification. Any credential-backed check must run from a trusted installation outside the writable agent workspace, through the established broker. This plan does not request an installation, dependency upgrade, credential change, commit, or push.

## Define the visible result

Use the following illustrative sequence as the acceptance example. These words demonstrate layout; the application must display actual retained model output.

```text
A - Senior · Planning
I will inspect the current implementation before proposing a change.

  > 4 tool calls · 3 reads · 1 search

The renderer currently appends only the latest run's prose.

B - Junior · Execution
I will add ordered transcript blocks and preserve the scroll anchor.

  > 6 tool calls · 2 reads · 1 edit · 3 commands

A - Senior · Check-in after B turn 10
The work remains on scope. Continue with the restart checks.

B - Junior · Execution resumed
The restart check exposed a missing archive reference. I am fixing it.

  > 2 tool calls · 2 commands · 1 failed

A - Senior · Review
The fixture confirms that earlier commentary survives the check-in.
```

While an agent reasons, show one stable, message-scoped line with `Thinking` as its activity text and the cycling dots specified below. Do not paint reasoning deltas, changing thought fragments, or an accumulating reasoning paragraph. When the completed provider summary is available, replace that placeholder in place with `Reasoning summary` and its finalized text. Show up to six wrapped summary lines by default, with an expansion action and full read-only detail for longer summaries. Ordinary response text continues to stream. Neither content kind requires opening the diagnostics pane.

Show the role and phase when ownership changes, and retain the attribution in each block's identity and inspector metadata. Consecutive blocks from the same role need no repeated large heading. Repeated reasoning updates must not add more `Thinking` rows or increase unread counts on each delta.

The existing current-request heading, live identity, operation state, B-turn/check-in counter, composer, and help hints remain outside the scrolling narrative. Reading an older block must not change the live agent indicator. Do not add a separate full-screen chat application or duplicate the full transcript in the History rail.

### Show the output that the provider supplies

The screenshot's explanatory paragraphs are ordinary visible assistant updates. Render those for both agents. Also render completed reasoning summaries that the provider actually exposes. These are distinct content kinds, not interchangeable names for a generic activity indicator. A provider's raw thinking stream is not a completed summary and must never be relabeled as one.

Installed Pi's OpenAI Responses adapter maps `response.reasoning_summary_text.delta` into `thinking_delta`. Its request builder requests a summary when reasoning options are used. This permits displaying a provider summary; it does not guarantee one for every response or expose private model internals. Never render `thinkingSignature`, encrypted reasoning payloads, or content marked `redacted: true`.

Agent B currently uses non-reasoning local model descriptors and the local broker forces `reasoning_effort: "none"`. Preserve that policy. B's commentary and response remain visible. When no readable summary exists, record that availability accurately in run details. Do not repeat an empty thinking placeholder before every response. While waiting, a neutral `Waiting for model output` status is sufficient.

Create `Thinking` only from a real reasoning lifecycle signal. Use authoritative assistant `message_end` content to publish a summary atomically after checking its provider provenance, completeness, and redaction state. An earlier `thinking_end` is a candidate completion signal, not permission to publish an unverified fragment. Keep `Thinking` until the finalized content is safe to show. If no final summary arrives, settle the row as `Reasoning complete · summary unavailable`; on cancellation or failure use the corresponding interrupted outcome. Never reveal buffered partial reasoning as a fallback or invoke another model to summarize it.

Require a completed eligible summary block and a non-error, non-aborted assistant message. A truncated or incomplete reasoning block stays unavailable. A fully retained text field in an error message does not make that reasoning a completed summary. Final-only summaries need the same completeness and provider checks before publication.

Keep coordinator-authored status separate from model text. Existing labels such as `gathering local context` and reasons inferred from tool names are status descriptions, not the model's explanation. Never fabricate a reasoning paragraph or ask another model to reconstruct missing reasoning.

While reasoning is active, any mirrored `Now:` activity text also uses `Thinking`. Suppress redundant phase-inferred reason paragraphs for that state. Planning/review headings and the live agent identity still identify who is working and why that phase exists.

### Animate the active label with cycling dots

Use a quiet four-frame cycle, with one frame every 500 ms:

```text
Thinking
Thinking.
Thinking..
Thinking...
Thinking
```

Repeat while that reasoning task is pending. Keep the word visible throughout; only the dots change. Use three ASCII periods, not a Unicode ellipsis, a cursor-blink escape, or a flashing whole line. Reserve three display cells after the label, padding unused dot positions with spaces, so the row never changes width, wraps, or shifts neighboring content.

Use the same treatment for an actual pending task's existing live label, such as `Waiting for model output` or `Running command`. Preserve the truthful activity name: Agent B's non-reasoning request must not acquire a `Thinking` label. Animate the active status, not every unfinished historical call or each tool category in the totals row. When the active narrative placeholder and mirrored live status are both visible, use the same animation phase.

The animation represents a pending operation, not a provider heartbeat or proof that a tool is making progress. Keep existing deadlines, errors, and cancellation signals authoritative. A dot tick must not reset inactivity/deadline accounting, invoke a tool, or imply verified work. Replace the animated label immediately when the final summary, next task, cancellation, failure, timeout, or completion arrives. Approval waiting and completed/retained history stay static. An interrupted reasoning placeholder settles into its static outcome notice.

Use the existing 500 ms `elapsedTimer` in `src/app/tui/bootstrap.ts`, which already requests renders during running operations and model loading and is cleared in `finally`. Reuse its repaint cadence instead of creating a timer per task, block, or component. Keep animation phase and start time ephemeral in the TUI, keyed by the active task identity. Derive dot count from elapsed monotonic time with a testable clock; repaint frequency and incoming tokens must not advance the phase or restart it. A new task begins at zero dots. `render()` reads the phase without scheduling timers or mutating domain state.

Keep animation out of telemetry, archives, transcript revisions, unread counts, conversation entries, and body-cache keys. Only the label's rendered cells change. Reuse cached Markdown for unchanged content. Paused/history views keep their anchored narrative static; the separate current-task indicator may continue animating. Overlay opening and resize must preserve the task's phase and the editor's draft. Losing visibility does not mean the underlying task finished.

Clear the shared timer through the existing teardown on normal exit, startup failure, and handled signals. Once work is idle, request no extra frames for this animation. In the plain readline interface and `TERM=dumb`, show a static label such as `Thinking...` without periodic output or cursor-control writes. `NO_COLOR` alone disables color, not dots, in an otherwise interactive TUI.

Verify all four frames and the wrap to zero with a controlled clock rather than real-time sleeps. Also verify constant visible width, both roles' truthful labels, no phase reset on token updates or resize, no animation-induced scroll/unread/cache churn, immediate settlement, and timer cleanup. A prolonged dummy-provider reasoning fixture must visibly cycle before delivering one atomic final summary. Assert that no intermediate frame contains reasoning text.

### Make every activity row precise

A batch is a contiguous sequence of actual tool executions within one attributed stretch of the narrative. Close the batch at every assistant-message boundary, including a new `Thinking` placeholder, and when readable model content begins, ownership switches, or a run, check-in, repair, or operator-request boundary occurs. Completion updates an existing batch; it never moves its row to the bottom or merges batches across an Agent A check-in.

For completed command-only batches, use `Ran 6 commands`. For mixed batches, use `6 tool calls · 2 reads · 1 edit · 3 commands`. Omit zero categories. Keep one physical terminal row, including the disclosure marker. At narrow widths shorten categories or use `6 calls · 1 failed · details`, with full totals in the inspector. Preserve the total and adverse outcome before decorative details.

During execution show lifecycle counts, for example `6 calls · 4 done · 1 running · 1 failed`. On interruption retain `interrupted`, `cancelled`, or `timed out` for unfinished calls as appropriate. A failed command must remain visible even when collapsed. Zero calls produce no activity row. A tool-only response still produces a row with its role and phase.

Count unique execution identities, not emitted events, generated tool-call fragments, result chunks, model responses, or shell subcommands. One `bash` execution is one command even if its script invokes several programs. `read` counts reads; `grep` and `find` count searches; `ls` counts listings; edits, writes, MCP calls, and other tools have their existing categories. These describe invocations, not unique files changed or verified test success.

Use `(role, sessionId, runId, toolCallId)` as call identity. Start, update, end, and replay events for that identity contribute one call. Missing starts may yield a known terminal call with an explicit incomplete-history marker. Calls without trustworthy identity must not be invented or silently attached to the nearest run. MCP classification must survive restart through retained metadata rather than depending on the currently configured server list.

Keep protocol misuse and format-only repair violations as visible diagnostics, outside ordinary executed-tool totals. Consolidate protocol-name classification around the authoritative `PROTOCOL_TOOL_NAMES`, including `pi-check-in`, in a shared lower-level module if necessary. Do not introduce an application-to-coordinator import cycle. Separate attempted or blocked operations from calls known to have executed. Do not count a failed run as a second failed tool.

## Trace the current implementation

The investigation followed these paths in the working tree:

1. `RuntimeEventBridge.handleEvent()` in [bind-runtime-events.ts](../src/coordinator/bind-runtime-events.ts) receives Pi events. `normalizeEvent()` records metadata and safe tool previews through `TelemetryLogger`. A separate `RuntimeUiBridgeEvent` path forwards text deltas and text committed at `turn_end`.
2. [event-normalizer.ts](../src/telemetry/event-normalizer.ts) retains the assistant event type but drops text and thinking bodies. Tool previews are limited to 120 characters. The existing test explicitly protects the no-raw-thinking-in-telemetry contract.
3. [service.ts](../src/app/interactive/service.ts) updates `HistoryIndex`, activity, a single live text stream, and deduplicated conversation entries. [store.ts](../src/app/interactive/store.ts) keys that stream by role and session, without message or run identity.
4. [history.ts](../src/app/interactive/history.ts) indexes operator turns, role runs, and calls from coordinator JSONL. It retains metadata, not full message bodies. Run provenance distinguishes planning, execution, check-in, review, and repair.
5. `CurrentWorkspace.render()` in [workspace.ts](../src/app/tui/workspace.ts) renders metadata rows first. It appends only the latest run's live or cached prose, obtained through the formatted inspector API. The cache reads 60 source lines, then bounds presentation to 24,000 trailing characters and 80 trailing source lines. Earlier commentary is not an interleaved narrative.
6. `loadHistoryDetail()` calls coordinator `getRunArchive()`. [session-history.ts](../src/runtime/session-history.ts) reads Pi JSONL without opening or repairing a session. `archiveRunEntries()` uses ancestral `pi-dual-run` markers to scope entries, including inactive branches and messages before compaction.
7. [history-detail.ts](../src/app/interactive/history-detail.ts) concatenates assistant text, readable validated result fields, and a separate calls list. Its archive schema currently strips thinking fields. Its formatted strings are an inspector presentation, not a transcript API.

[session-ledger.ts](../src/persistence/session-ledger.ts) is the workflow/handoff ledger. It is not the source for scrolling message bodies. Keep those responsibilities separate.

The current activity totals in [activity-history.ts](../src/app/activity-history.ts) are cumulative for a role session, with eight recent display items. They are useful diagnostics but cannot serve as exact totals for a narrative batch. Reuse classification logic while deriving batch membership and counts from the retained unique calls.

## Use archive-backed blocks with a live overlay

Keep Pi session archives as the source of committed bodies. Extend the existing metadata history with ordered references to message blocks. Hold current safe display snapshots in memory until archive reconciliation. Expose one structured transcript API to both the TUI and read-only inspection; keep the existing metadata hierarchy for navigation.

This design hides Pi parsing, ownership checks, reconciliation, grouping, and text safety behind the service. The renderer consumes attributed blocks and handles layout. Do not make `workspace.ts` understand Pi wire events, read session files, parse machine JSON, or split inspector text at `Calls:`.

Keep these implementation responsibilities explicit:

- `src/coordinator/bind-runtime-events.ts`: adapt installed Pi events, assign run-scoped message identities, reserve ordered metadata references, and reconcile persistence.
- `src/telemetry/event-normalizer.ts` and `src/app/interactive/history.ts`: validate/index additive structural metadata while preserving existing call/run outcomes and body-free logging.
- Proposed `src/app/interactive/transcript.ts`: own the ordered projection, per-run live overlay, batch membership, archive hydration, range cursors, and bounded caches. Keep pure projection helpers alongside that policy until their size justifies a split.
- `src/types/history.ts` and `src/types/ui.ts`: define the shared view contracts and replace singleton workspace streaming state.
- `src/runtime/session-history.ts` and coordinator `getRunArchive()`: validate and resolve readable archive content within the existing ownership boundary.
- `src/app/interactive/service.ts`: own the transcript reader, route events, and expose bounded read-only loading and revision updates.
- `src/app/tui/workspace.ts`, `app.ts`, and `bindings.ts`: render blocks, preserve anchors/focus, and route disclosure, inspector, keyboard, and pointer input.
- `src/app/tui/bootstrap.ts`: reuse the shared 500 ms refresh lifecycle for active-label dots and retain its timer cleanup.
- `src/app/interactive/history-detail.ts` and `src/app/presentation/`: share readable protocol-result presentation with the transcript and inspector.

### Start with the caller's API

The following names are proposed interfaces, not existing exports. Derive their concrete identity and outcome types from the repository's types during implementation.

```ts
// service.ts: the UI requests a bounded window for the viewed operator request.
const page = await service.loadTranscript({ turnId, before: cursor, limit: 40 });

// workspace.ts: typed blocks replace metadata rows plus latest-run-only prose.
for (const block of page.blocks) {
	renderTranscriptBlock(block, bodyWidth);
}

// A tool group opens read-only details for its retained call IDs.
await service.loadHistoryDetail(callId, "output", sourceLine, 100);
```

Use opaque cursors validated by the service. A page limit counts blocks, with a separate byte limit for bodies. Large single messages need source-range loading too; limiting the number of blocks alone does not bound memory. History navigation chooses the operator request, and its narrative then pages back to the beginning.

The core view types can have this shape. Keep wire schemas and raw archive content private to the adapter.

```ts
type TextBody<
	State extends "streaming" | "committed" | "interrupted" =
		"streaming" | "committed" | "interrupted"
> =
	| { kind: "loading" }
	| { kind: "unavailable"; reason: string }
	| {
		kind: "text";
		text: string; // Safe display text for this source range.
		revision: number;
		sourceOffset: number;
		hasBefore: boolean;
		hasAfter: boolean;
		state: State;
	};

type TranscriptOwner = {
	turnId: string;
	runId: string;
	role: Role;
	sessionId: string;
};

type TranscriptBlock =
	| (TranscriptOwner & {
		id: string;
		kind: "response";
		messageId: string;
		contentIndex: number;
		body: TextBody;
	})
	| (TranscriptOwner & {
		id: string;
		kind: "reasoning_summary";
		messageId: string;
		contentIndices: readonly [number, ...number[]];
		body: { kind: "thinking" } | TextBody<"committed">;
	})
	| (TranscriptOwner & {
		id: string;
		kind: "tool_group";
		messageId: string;
		callIds: readonly [string, ...string[]];
	})
	| (TranscriptOwner & {
		id: string;
		kind: "notice";
		text: string;
	});
```

Arrays are in canonical display order. Resolve phase, response attempt, and call outcomes from indexed run/call metadata; do not synchronize another copy inside every block. A projector can derive the compact totals from each group's call IDs. Exhaustively handle block and body variants. Validate persisted metadata with Zod at the boundary and infer TypeScript types from those schemas. Retain strict optional-property checking, `.js` import specifiers, and the installed Pi event unions. Avoid `any`, unchecked casts, and a second hand-written Pi protocol.

The summary variant permits a `Thinking` placeholder or completed content, never a streaming/partial text body. Its identity is the owning message plus the summary kind. Reserve its position at the first reasoning event and collect eligible completed summary blocks in content-index order inside that one container. This is a per-message summary, not a replay of thought fragments. Keep individual source-index references for inspection. Response blocks retain their observed positions, and later tool activity never moves ahead of them.

### Establish stable identity and order before rendering

Assign an assistant message identity at `message_start`, scoped by role, session, run, and a run-local assistant-message ordinal. Assign response content identities using that message identity and Pi `contentIndex`; a message's single summary container references all of its eligible summary indices. Support final-only messages without streamed start events through the same adapter and a validated fallback ordinal. This identity is independent of the request, B's supervised turn count, and the optional provider `responseId`.

Persist metadata-only message/block references through the existing telemetry path. Include message ordinal, content index, content kind, run ownership, and any resolved archive-entry reference. Create records only once per structural boundary, not per token. The order in which the coordinator logs structural events is the canonical cross-role order. Build the same monotonic ordering from that log on live observation and replay. Do not sort by timestamps or group all of a run's children beneath its start event.

Version the new metadata payloads. Give each structural transition a stable identity derived from its block/message and transition kind, so duplicate reservation, commit, and reconciliation events converge without reserving a second display position. Recover order from the existing journal rather than maintaining a second independently persisted sequence counter.

Record a block boundary before emitting its first display snapshot. A batch keeps its position at its first execution start and uses its initiating message ID plus the first call's identity for a stable group ID. Resolve that message from tool-call provenance, not whichever role most recently rendered. Later tool results update that batch in place. A tool-call declaration carries initiator identity for correlation but does not itself increment executed-call totals. Legacy calls without this association retain explicit incomplete-history handling.

Pi `0.67.68` notifies `message_end` listeners before appending the message to the session manager. Therefore, `getLeafId()` inside that callback can identify the preceding entry. Reconcile assistant ordinals with actual assistant archive entries under the matching run marker after Pi has persisted them, for example at the subsequent stable turn boundary. Validate the association and persist the resolved entry reference. Do not match by text, nearest timestamp, or a callback-time leaf ID.

If a crash occurs between message persistence and reference finalization, recover the association by validated run ownership and assistant ordinal. If the association is ambiguous, show unavailable content. A started block without a retained body remains interrupted or unavailable. An archive message without new block metadata is legacy content, not permission to guess cross-role chronology.

One B prompt/run can surround several model responses and an A check-in. Preserve the event sequence `B text → B calls → A check-in → resumed B calls → B text`. Repairs have separate run IDs and share response identity/attempt metadata. They do not create extra operator requests or alter the execution supervisor's model-turn counter.

### Reconcile streamed and committed content once

Expand the bridge's display events to carry operator-turn, run, message, content-index, and content-kind identity. Replace the singleton stream as the workspace's source with a map of pending message blocks. Keep a temporary adapter for plain-mode behavior only while migrating its callers, then remove redundant stream plumbing in the same implementation wave.

For response text, use safe replacement snapshots with revisions rather than blindly concatenating independently sanitized deltas. For reasoning, send only lifecycle metadata to the UI until the completed summary is available. `thinking_delta` must not emit UI text, update a rendered body cache, or create per-delta notifications or unread changes. The SDK can retain its internal partial message; the display path needs no second partial-reasoning buffer.

`message_end` supplies authoritative assistant content, including multiple text/reasoning blocks and responses without deltas. Publish eligible completed summaries once, then reconcile archive references after persistence is stable. `turn_end` still owns its existing supervisor semantics; it is not a reason to duplicate the message.

For each identity, a newer authoritative snapshot replaces the streaming version in place. Archive hydration replaces that same block's body. Do not append the same output from the stream, operation result, conversation entry, and archive. Use identity, not equal text, for deduplication: repeated words in two real messages must remain two messages.

On cancellation, failure, timeout, reset, or runtime replacement, settle every affected pending block. Preserve useful partial response text with its outcome, and replace unfinished `Thinking` with an interrupted/unavailable-summary notice. Ignore stale events by operation/run generation as well as session. A late read or commit cannot populate a different request after navigation, reopen a terminal record, or restore cancelled work. Keep completed calls completed.

### Preserve text safety across chunks

Use the shared [display-text.ts](../src/security/display-text.ts) and credential-redaction rules for every output kind, before display caching, UI notifications, or terminal rendering. Extend the streaming adapter to retain incomplete escape sequences, workflow fences, and credential-like tokens across chunk boundaries. Re-sanitizing a full accumulated string alone cannot retract a secret prefix already painted on screen. Hold incomplete sensitive tokens/control sequences until they can be classified safely.

Suppress partial and complete `pi-*` machine fences. Project validated plan, completion, final-review, and check-in fields through shared presentation helpers, with labels such as `Reported verification`. Do not expose raw protocol JSON, generated prompts, mutation bodies, environment values, arbitrary output-file paths, or malformed repair payloads. Keep ordinary Markdown code blocks visible.

Extend the archive schema narrowly for readable `thinking`, its redaction flag, and the provider/API provenance needed to recognize completed summaries. Ignore signatures and opaque fields. Only eligible completed provider summaries enter display caches or inspection. Raw or redacted reasoning remains unavailable even if the archive contains partial text. Retain the existing rule that coordinator telemetry contains no raw text or reasoning bodies. Sanitization is a display defense; the trusted broker and sandbox remain the credential-isolation boundary.

### Load a bounded window without dropping history

Add a structured projection beside the existing detail API. Share safe protocol-result presentation rather than reparsing its strings. Keep canonical role-directory containment, `.jsonl`, session ID, project cwd, branch ancestry, and memory-session checks in coordinator-owned archive access. Never call `SessionManager.open()` to inspect history or follow arbitrary `fullOutputPath` values.

Cache validated archive reads by session identity plus file version, with explicit invalidation after writes and replacement. Coalesce concurrent reads, reject stale completions, and bound cache entries and total bytes. The current archive reader parses a full file; paging the view does not remove that cost. Load once per changed archive on demand, outside render. If measured archive size makes that unacceptable, add a validated incremental index as a separate measured change, not a token-by-token full scan.

Render the viewport plus a small overscan window. Cache Markdown by block ID, content revision, source range, width, and display policy. Coalesce render requests through Pi's existing `requestRender()` behavior. A token update should invalidate the active block, not Markdown for every historical message.

Keep long bodies navigable through source ranges with explicit earlier/later-content affordances. Do not retain the current silent latest-run/tail-only behavior. Cache eviction removes a loaded body, not its stable block identity or access to the archive. For bounded live buffers, disclose any discarded prefix immediately and recover it from the archive after commitment. If upstream or memory-only retention has lost content, label the gap.

## Keep navigation and details dependable

Replace the singleton prose scroll anchor with `(blockId, source position)`, then map it to wrapped terminal rows. Preserve the reader's source position during streaming, commits, batch expansion, archive hydration, and resize. An anchor to a mutable active block must use a stable safe snapshot while paused or preserve its source position through revisions. Metadata updates must not pull the viewport to the tail.

Keep wheel/trackpad, PageUp/PageDown, Shift+Up/Down, Home, End, F6, F1, and Esc behavior. End resumes following. Maintain unread counts from new structural blocks/content revisions without counting the same delta and commit twice. The History rail/drawer selects past requests; their body uses the same transcript projection. Preserve draft text and inspector return position across help and overlays.

Use Space/Right to expand a tool group into its individual retained call rows, or a finalized summary beyond its six-line preview. Left collapses it. Enter on a group opens its read-only call list; Enter on a call opens the existing inspector. A response or finalized summary can open its source-range detail. `Thinking` has no partial-reasoning inspection action. Keep existing `/history` and `/inspect` IDs working. Update contextual hints and binding definitions together; printable inspector keys must not intercept editor input.

Use Pi `Markdown`, `visibleWidth`, `wrapTextWithAnsi`, and `truncateToWidth`. Enforce `visibleWidth(line) <= assignedWidth` for every rendered row, including CJK, emoji, combining characters, long paths, code, disclosure markers, and narrow batch summaries. Use terminal-default body colors, existing A cyan/B amber accents, and readable subdued summaries. Preserve `NO_COLOR`, `TERM=dumb`, the narrow-window fallback, mouse bounds, IME cursor handling, cancellation access, and terminal restoration.

## Implement in verifiable increments

1. Capture the exact current checkout, dirty-file list, installed Pi versions, and existing failures. Coordinate with concurrent changes before editing shared files. If using a worktree, start from an agreed snapshot containing the relevant work; a worktree from `HEAD` alone omits today's uncommitted behavior.
2. Add fixtures for ordered messages, readable provider summaries, duplicate calls, and A/B interleaving. Define Zod-backed structural metadata and the transcript view model. Prove stable IDs, replay order, exact group membership, and totals with pure projector tests before changing layout.
3. Extend the runtime bridge with message/block ownership, safe stream snapshots, and persistence reconciliation. Keep telemetry bodies absent. Wire pending blocks into the interactive service, including final-only messages, cancellation, and stale generations. Prove behavior before replacing the renderer.
4. Add archive-backed structured projection and range loading. Extend the archive schema for readable summaries and redaction state. Share result/check-in presentation and classification. Verify live/replay equivalence and read-only bytes before enabling retained narrative navigation.
5. Replace metadata-first/latest-run prose rendering with ordered blocks and compact activity rows. Implement block anchors, lazy hydration, disclosure, keyboard/mouse routing, and active-label dots using the existing refresh timer. Remove the old `runProse`/`Calls:` parsing path and redundant caches after callers migrate. Retain the metadata index and existing inspector contracts.
6. Update plain-mode handling for the changed bridge contract. Keep `/history` and `/inspect` available and avoid duplicate answers or escape-code output. Update [terminal behavior](terminal-experience.md), [verification record](terminal-verification.md), and relevant README text to describe provider summaries, unavailable content, grouping, and controls accurately.
7. Run the checks below, review the diff for scope and secret exposure, and record actual results. Any later installation or live-provider check is a separate delivery step; fixture output alone cannot establish live-provider behavior.

## Prove the narrative matches the event flow

Extend existing tests rather than introducing a replacement harness:

- `test/unit/runtime-event-bridge.test.ts` and `test/unit/event-normalizer.test.ts`: multiple content blocks, summary start/delta/end, final-only messages, optional provider IDs, persistence timing, aborted messages, stale generations, and no message bodies/signatures in telemetry. During arbitrarily many reasoning deltas assert one `Thinking` placeholder, zero partial-reasoning UI text, and one atomic completed-summary replacement.
- `test/unit/retained-history.test.ts` and a focused transcript-projector test: same text in distinct messages, exact call identity, repeated start/update/end/replay, reused call IDs across roles/sessions/runs, more than eight calls, missing starts, MCP categories after restart, tool-only output, zero calls, protocol attempts, and every lifecycle outcome.
- Assert one atomic summary container when a message has multiple eligible reasoning blocks. Assert distinct tool groups for adjacent same-role, same-run messages, including when the next message begins with `Thinking` rather than visible prose.
- `test/unit/interactive-service.test.ts` and `test/security/redaction.test.ts`: authoritative replacement once, multiple pending blocks, unavailable/redacted summaries, incomplete fences, secrets split at every response-text chunk boundary, split ANSI/OSC/C1/bidi controls, and safe partial response output after cancellation. Assert no unsafe prefix or partial reasoning appears in any intermediate UI snapshot, notification, inspector, or capture. Verify reasoning interruption never reveals its buffered content and ordinary response streaming still works.
- `test/unit/workspace-controls.test.ts`: every earlier paragraph remains reachable; A check-in precedes resumed B activity; grouping cannot cross attribution boundaries; source anchors survive resize, commit, expansion, hydration, and cache eviction; paused output does not jump; unread/End/help/draft/IME behavior remains correct. Assert visible cell width and one-row summaries at each target size.
- `test/unit/tui-app.test.ts`, workspace controls, and terminal bootstrap coverage: controlled-clock dot frames, constant-width active labels, phase continuity, settled/approval/history states, static plain/dumb behavior, no extra idle repaints, and timer cleanup on exit/startup failure/signals. Animation must leave transcript revisions, unread counts, and Markdown cache identities unchanged.
- `test/integration/retained-history.test.ts`: identical committed live/restarted narrative where structural metadata exists, inactive branches, pre-compaction content, run-marker ownership, crash before reference finalization, truncated JSONL, missing/replaced memory archives, symlink/path rejection, and byte-for-byte unchanged inspected files. Older archives expose available prose without pretending to have new cross-role ordering metadata.
- `test/integration/execution-check-in.test.ts` and response-repair integration tests: B remains paused during A's check-in and repairs, counters remain authoritative, attempts remain separate runs, blocked results stay visible, and UI changes do not enable tools or start a new workflow.
- `test/fixtures/terminal-app.mjs` and `scripts/verify-terminal.py`: deterministic actual-Pi fixtures for `A planning → B commentary/tools → A check-in commentary/tools → B resumed commentary/tools → A review`, including a failure, prolonged `Thinking`, atomic final-summary replacement, a long summary preview/expansion, final-only output, and cancellation. Make this sequence a named reusable fixture, not a collection of manually arranged screenshots.

Run focused tests while developing, then the repository gates:

```sh
npm run check
npm test
npm run build
npm run verify:isolation
npm run verify:terminal
git diff --check
```

The isolation gate is relevant because the new content path crosses display, caching, and archive boundaries. Use dummy secrets and existing isolated state. Reuse the existing terminal verifier's mutation workspaces; do not execute fixtures against this repository's real files.

Capture and inspect real TUI output at 80×24 and 120×40, plus a wider size and a below-minimum resize. Verify both color and no-color modes. Inspect screenshots for narrative spacing, readable summaries, visible failure state, the live A/B pointer, and composer space. Assertions should inspect content order and source identity, not rely solely on exact row numbers. A screenshot demonstrates layout; it does not prove replay, secret isolation, or cancellation.

The work is complete when both agents' prose appears in order, active reasoning shows only `Thinking` with cycling dots, and completed provider summaries replace their placeholders once. Tool batches occupy one row by default with exact counts, eligible retained details remain inspectable after restart, and navigation remains stable under response streaming, animation ticks, and summary replacement. No partial stream-of-consciousness reasoning may appear in any UI surface. The workflow and security gates must retain their existing behavior.

## Handle older history explicitly

Do not rewrite existing Pi sessions or coordinator logs. New structural metadata is additive and versioned. Old records still support `/history` and `/inspect`. Project archive-local content order when it is provable, but label missing cross-role boundaries as `Detailed ordering unavailable for this older run`. Never infer interleaving from timestamps alone.

Malformed or partially written structural records follow the existing loader's warning behavior. Unknown structural variants in a recognized event envelope produce an unavailable/unsupported notice, not a cast to a known block type. A completed run whose body cannot be loaded remains completed with unavailable content. History viewing must never approve, rerun, resume, replace a runtime, or repair persistence.

## Record the design choice and accepted costs

The preferred design uses ordered metadata references plus Pi archive bodies and a live overlay. It preserves the existing source of truth for committed content, avoids adding token-content records to JSONL, and gives one service ownership of live/archive reconciliation. It adds structural correlation and range loading because the current metadata-only records cannot reproduce the screenshot.

The second sketch used an explicit event-backed metadata reducer with block-opened, block-sealed, body-reference, and call-attachment events. Both sketches keep bodies in Pi archives and converge on the need for durable cross-role ordering metadata. Use the archive-backed sketch as the base and adopt the second sketch's versioned lifecycle transitions and crash-reconciliation checks. Derive batches from retained call identities instead of duplicating totals or coupling every prose block to a calls array. Use existing journal order rather than a second sequence counter or journal.

Persisting sanitized content snapshots is a further alternative. It adds a second body store and new retention, schema, and crash-consistency obligations. Reject that additional persistence layer for this feature.

Independent review preferred the archive-backed base and identified two clarifications now included above: summary identity is message-scoped, and tool-group identity/boundaries include the initiating message. The later `Thinking` requirement supersedes both initial sketches' incremental-reasoning display ideas.

A renderer-only change was rejected. Hiding tool rows and appending more strings cannot recover dropped thinking events, identify messages across restarts, or interleave archived A/B content. Concatenating complete runs was also rejected because B can resume inside the same run after A's check-in.

Accept an on-demand archive-read cost and explicit legacy gaps in exchange for avoiding a second transcript body store. Accept a small bounded delay in streamed text where safety requires holding incomplete tokens. Do not trade away readable earlier messages for a faster latest-run preview.

## Record investigation verification

This was a planning task. The initial investigation created this plan without changing application behavior. Findings were checked against the current source and installed Pi declarations/implementation, with independent history/UI and runtime/persistence investigations and competing design sketches. A later documentation-only revision added the cycling-dot requirement and a companion implementation prompt, after checking the existing bootstrap timer and cleanup path. The proposed animation has not been implemented or exercised in the application.

The following baseline checks passed during the investigation:

- `npm run check`.
- `npx vitest run test/unit/event-normalizer.test.ts test/unit/runtime-event-bridge.test.ts test/unit/retained-history.test.ts test/unit/workspace-controls.test.ts test/unit/terminal-interaction.test.ts test/integration/retained-history.test.ts`: 6 files, 50 tests passed.
- The proposed core type sketch passed a standalone strict TypeScript check with exact optional properties and unchecked-index access enabled. Local Markdown links resolve, code fences are balanced, and the added file has no whitespace errors.

These checks describe the investigated baseline. They do not verify the proposed implementation. No full-suite, build, PTY, isolation, or live-provider run was performed for this planning task. Record the later implementation's results separately.

Upstream references were checked on 2026-10-18. The current upstream Pi README now describes different package names and newer layout APIs; it must not override the installed `0.67.68` contract:

- [Pi TUI source documentation](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/tui/README.md) for component/terminal context. Verify feature-specific APIs in `node_modules/@mariozechner/pi-tui/README.md` before use.
- [Pi AI event types](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/ai/src/types.ts) for upstream context. The inspected local `dist/types.d.ts` and `dist/providers/openai-responses-shared.js` establish this plan's installed event/summary behavior.
- [TypeScript narrowing and discriminated unions](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) for exhaustive handling of the new variants.
