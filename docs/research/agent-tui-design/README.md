# Agent TUI design recommendation

The selected direction is **option 3: current workspace with history rail**. See the [design decision and screenshot comparison](active-turn/README.md). This supersedes the original timeline layout recommendation below while retaining independent tool and agent-run inspection.

For implementation, use the [implementation prompt](active-turn/IMPLEMENTATION_PROMPT.md) and [QA findings](active-turn/QA_REPORT.md). The selected-layout README controls layout decisions; the current repository controls runtime and provider behavior. Earlier screenshots remain historical references.

Researched 16 October 2026. Deliverables are research, a browser interaction prototype, reference images, and screenshot concepts. Application code was not changed. The source audit used the existing working tree, which contains uncommitted implementation work. A source hash and capture timestamp are recorded in [baseline.json](baseline.json).

## Recommended experience

Give the active turn and current step the main workspace. Put independently folded historical turns and agent runs in a slim history rail at 120 × 40, with a compact history control at 80 × 24. Open selected current or historical records in a read-only inspector, preserving an explicit return to the active turn. Keep the active-agent label, live-work pointer, composer and help hint visible during inspection.

Use **cyan for A - Senior** and **amber for B - Junior**. The active label must read exactly `Active: A - Senior` or `Active: B - Junior`. Keep the inactive role visible with its role color and a textual waiting state. Repeat the active label above the composer so historical inspection never obscures who is working. Change the active badge only when the coordinator's actual active role changes, not when the user selects another agent's history. During cancellation, say cancelling until cleanup completes; waiting for approval is its own state, not active execution.

Use `Idle`, `Waiting for approval`, or the recorded terminal outcome when no role is working. A retained `status.activeRole` alone does not establish activity. Keep the last result visible without presenting the last role or tool as still running.

Keep the role letter and name on agent and tool rows, in the inspector breadcrumb, and on the live-work line. A tool inherits the color of the role that invoked it. Reserve error styling for a small `FAIL` label or marker, retaining the role identity beside it. Use bold/reverse or solid-fill active badges, textual status, and a visible selection marker in monochrome. Theme colors should be configurable; verify contrast separately for light backgrounds, 16-color terminals, and user themes. The prototype's two dark-palette role colors pass a 4.5:1 foreground/background contrast calculation. This is not a color-vision or terminal compatibility certification.

Provide a persistent `F1 help` footer hint. F1 opens a quick-reference popup from the editor, timeline, inspector, or another view; F1 or Esc closes it and restores the previous focus. Keep `/help` as the typed fallback for terminals or OS settings that intercept function keys. Group controls by context and mark the current context. Opening help must preserve the draft, selection, expansion state, and read position. At 80 × 24 the common controls fit within the body; longer command documentation can use the existing scrollable help view.

## Why this design

The strongest references answer different parts of this problem. Claude Code documents expansion of current and past tool output and separate agent transcript inspection. Crush implements selected-item expansion on Space. OpenCode demonstrates compact tool rows and explicit child-session navigation. Gemini CLI demonstrates readable tool cards but documents renderer-dependent expansion shortcuts. Official OpenAI documentation describes Codex agent selection, background-terminal inspection and configurable status fields. These are selected established projects with relevant primary evidence, not a claim of a measured market ranking. See [first-party findings and citations](../agent-tui-sources.md).

| Alternative | Strength | Limitation | Decision |
| --- | --- | --- | --- |
| [Timeline and inspector](screenshots/recommended-junior-120x40.png) | Current work stays visible while an older call is inspected | Narrow windows need a body overlay | Original proposal, superseded by the selected history-rail layout |
| [Inline folds](screenshots/inline-folds-120x40.png) | Short outputs retain their conversational context | Large output displaces other turns | Allow bounded previews; use inspector for long output |
| [Agent workbench](screenshots/agent-workbench-120x40.png) | Quick access to completed and current agent runs | Gives less space to the conversation | Optional activity/audit view |

Additional screenshots show [Senior active](screenshots/recommended-senior-120x40.png), [80 × 24 historical inspection](screenshots/history-inspector-80x24.png), and [the shortcut popup](screenshots/shortcut-help-80x24.png). These are captures of the synthetic browser prototype, not the shipped TUI.

## Detail without clutter

- An expanded turn shows operator text, assistant prose and compact agent/tool rows in order. A folded turn still reports its outcome, tool count, agent-run count and failures. The prototype illustrates the hierarchy; complete count summaries are implementation work.
- Show each tool as one row with role, status, tool name, target or command, and elapsed/final duration. Repeated reads may fold into a group, but the group's children must remain independently accessible by stable call ID. Do not aggregate away failures or mixed outcomes.
- A tool inspector exposes summary, safe request, output, exit/error information and identity metadata. Long output scrolls independently. Offer search and explicit copy/export as follow-up controls. Never equate a short preview with full retained output.
- An agent-run inspector exposes its objective, originating turn/handoff, visible assistant transcript, own calls, outcome and verification. Finished runs stay under their originating turn. Looking at a historical run must not switch its live runtime session or resume execution.
- Pin only a compact reference to live work. Keep the full call in its chronological location. If future concurrency exceeds the live strip's budget, show the primary active role plus a running-count control that opens the complete list. Do not add a pane for each agent.
- Keep successful calls compact. Leave a visible failure count or marker on folded ancestors. Do not automatically open a large error log or collapse the record the reader is examining.
- Pause following when the reader moves away from the live edge. Anchor to record ID plus an intra-record line, rather than a global rendered-line count. Show unread activity and an explicit return-to-live action. Completion, resize, expansion and new output must preserve that anchor.

## Controls and focus contract

Preserve existing editor behavior and add record navigation only when history has focus. New printable shortcuts must never intercept typing in the editor.

| Context | Controls | Behavior |
| --- | --- | --- |
| Anywhere | F1 | Quick controls; Esc/F1 returns to the previous view and focus |
| Editor | `/help` | Typed fallback for quick controls |
| Anywhere | F6 / Shift+F6 | Cycle panes, retaining each pane's selection and scroll |
| Anywhere | F2 | Preserve access to the existing activity view |
| Editor | Enter, Shift+Enter, Tab, Alt+Up | Preserve submit, newline, completion and prompt history |
| History | Up/Down | Move between semantic records |
| History | Space or Right/Left | Toggle, expand or collapse one record; Left on a closed child can move to parent |
| History | Enter | Inspect the selected current or past record |
| Inspector | 1–4, Up/Down, PgUp/PgDn | Change detail tab and navigate its content |
| History | Home/End, PgUp/PgDn | Start, latest/follow, viewport navigation |
| Detail | Esc | Close one level; retain history selection; another Esc returns to editor |
| Anywhere | Ctrl+C | Preserve existing cancellation and idle-clear/exit behavior |

The earlier [interaction prototype](index.html) implements folds, inspection tabs, output paging, focus transitions, search filtering, role switching and quick help. The selected [layout mockup](active-turn/mockups.html) implements layout selection, role and size switches, monochrome preview, and help/history overlays. Its draft and history records are static examples. Neither prototype implements real submission, terminal completion, cancellation, streamed unread counters, persistent UI preferences or durable history. Help includes the proposed control contract so it can be evaluated before terminal implementation.

## Current local gaps

The existing application already has a useful foundation: a shared interactive service/store, Pi's Editor and Markdown components, F2 activity, F6 focus cycling, an alternate screen, session viewers, and a plain fallback. Retain those boundaries and controls. The source audit found:

| Source | Observed behavior | Required change |
| --- | --- | --- |
| [activity-history.ts](../../../src/app/activity-history.ts) | `MAX_RECENT_ACTIVITY_ITEMS = 8`; history is partitioned by A/B session and resets when bindings change | Keep `recent` as a bounded projection over durable run/call records |
| [event-normalizer.ts](../../../src/telemetry/event-normalizer.ts) | Tool output is flattened to a maximum 120-character preview | Resolve full detail through retained safe records; never expand this preview into invented output |
| [types/ui.ts](../../../src/types/ui.ts) | Activity records have call IDs and summary text but no full output reference or first-class agent-run hierarchy | Add stable associations between submission, model turn, role run, handoff and tool call |
| [tui/app.ts](../../../src/app/tui/app.ts) | Activity is initially hidden; it lists runtime metadata and recent summaries; pane navigation scrolls rendered lines | Add always-visible live status, record selection, independent expansion and inspection |
| [tui/app.ts](../../../src/app/tui/app.ts) | Activity switches to a stacked panel below 100 columns | Prefer a body overlay for detailed inspection at 80 columns rather than another permanent pane |

Pi role sessions already persist messages and context through `SessionManager`. Prefer indexing those existing records and attaching durable parent/run associations over duplicating all message bodies in a new event log. Verify reconstruction across Pi branches, compaction, session switching and restart before choosing the final storage format. Telemetry previews alone are insufficient. Missing historical content should display `Output unavailable` or `Not retained`, with its reason, rather than imply it can be recovered.

Use the existing read-only [session-history reader](../../../src/runtime/session-history.ts) as the starting point. Its current return value is the active context, not a complete branch-aware archive. Extend validated read-only parsing where needed. Pi's `SessionManager.open()` can repair files in place and must not be used to preview history. Keep the new record inspector separate from the existing session preview's explicit switch action; pressing Enter to inspect a tool or run must never switch a runtime.

## TypeScript and Pi implementation guidance

The installed renderer is **`@mariozechner/pi-tui` 0.67.68**. Its local [README](../../../node_modules/@mariozechner/pi-tui/README.md) is the API reference for implementation. Upstream has moved to the `@earendil-works` namespace and documents newer layout/scrolling APIs. Do not paste those APIs into this version or migrate rendering frameworks as part of this UI work. The [current upstream TUI README](https://github.com/earendil-works/pi/blob/main/packages/tui/README.md) is background reading, not the pinned compatibility contract.

Use the existing `Component.render(width): string[]`, `TUI.showOverlay`, `Editor`, `Markdown`, `matchesKey`, `Key`, `visibleWidth`, `truncateToWidth` and `wrapTextWithAnsi`. A rendered line must fit the supplied display-cell width. JavaScript string length is not terminal width. Test wide CJK, combining marks and emoji. Keep focus propagation and IME cursor handling through Pi's Focusable/Editor support. The current app wraps its own modal state around overlays; extend that path rather than installing a second independent modal manager.

Keep history projection and safe detail loading in the service/store layer. The TUI should own presentation state such as focused record, fold set, active tab and scroll anchors. Plain mode should consume the same history/detail service through textual commands. Do not let selecting a row trigger model calls, switch sessions, approve plans or rerun tools.

Use discriminated unions for turn, agent-run and tool records, and for running, completed, failed, cancelled, timed-out and interrupted states. Completion data belongs to the completed variant; a running call must not have a fabricated final duration or exit status. Derive SDK event types where available. Validate external persisted records at the read boundary and use exhaustive switches internally. Scope call identity by role/session/run as well as the provider's tool-call ID. Correlate start/update/end idempotently so replay does not double-count calls. Missing end events after restart become interrupted/unknown outcomes, never successful calls. Preserve terminal cancellation outcomes.

For future nested subagents, use parent run IDs and child run references. The current project has two coordinator-controlled role runtimes with sequential planning, execution and review. Those runs are not a general-purpose spawn tree. Add runtime delegation support before showing nested live subagents. Preserve the A read-only/B mutation policy throughout.

Preserve the current provider split documented in the repository README: OpenAI Responses for A and the fixed local LM Studio catalog for B. Senior and Junior are role names, independent of model names. This UI change must retain broker, authentication, model and endpoint policies.

Bound rendering cost separately from retention. Keep visible rows and a small overscan window in memory, cache completed Markdown by identity/content/width, and load large outputs by range. Coalesce display updates without dropping persisted events. Use actual monotonic elapsed time during a running operation and recorded timestamps for history. Clear timers on shutdown. Do not promise a frame rate without measurement.

Expanded logs introduce a new display path for untrusted tool text. Reuse the application's credential redaction and safe request handling before display, persistence, copy and export. Strip unsafe terminal control sequences while retaining allowed text styling; do not replay tool-provided cursor movement, OSC clipboard commands or hyperlink controls. Preserve existing private session storage and trusted-install boundaries. Do not copy raw tool input, environment variables or credential-bearing outputs into a convenience UI cache.

## Verification and remaining implementation work

Completed for this research deliverable:

- Captured the actual current renderer using synthetic state at 80 × 24 and 120 × 40, with activity both hidden and shown. All four captures have the exact row count and fit their display-cell width. No credentials or provider were used.
- Ran the browser prototype verification, including historical failure inspection, completed run inspection, independent folds, output paging, preserved draft, role handoff, exact bounds for all three concepts at both sizes, F1 help open/close/focus restoration, reference-image loading and dark-palette contrast. See [verification.json](verification.json).
- Used the collaborative browser for real keyboard and text input checks, and visually inspected captured concepts. Screenshot capture waits for layout/paint to settle.
- Downloaded first-party reference images and verified their SHA-256 values against [the source manifest](../assets/sources.json). Gemini's older screenshot and the extracted Crush demo frame are explicitly labeled.

These checks validate the research artifacts and synthetic interactions. They do not establish live provider compatibility, new terminal expansion behavior, terminal throughput, accessibility across emulators, or production readiness. No full application suite or isolation suite was run for this documentation/prototype-only change.

Before shipping, extend the existing meaningful unit and real PTY checks to cover more than eight retained calls, duplicate/out-of-order events, identical call IDs in different sessions, missing ends, long output, failures under folded parents, historical run browsing without session mutation, restart/branch reconstruction, resize while inspecting streamed output, draft and IME preservation, and terminal-control sanitization. Run the repository checks in CONTRIBUTING.md for that product change.

## Reproduce

From the repository root, capture the current renderer and serve this study:

```sh
node docs/research/agent-tui-design/capture-local.mjs
python3 -m http.server 8769 --bind 127.0.0.1
```

Open `http://127.0.0.1:8769/docs/research/agent-tui-design/index.html`. In that page's developer console, run:

```js
await (0, eval)(await (await fetch('verify-browser.js')).text())
```

The capture script uses the repository's already-installed esbuild dependency to bundle current source into a temporary directory, checks actual Pi display widths, writes baseline.json and removes temporary files. It does not rebuild dist or access credentials. Generated screenshots retain synthetic examples, not live project contents.
