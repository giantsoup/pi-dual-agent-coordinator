# Implement the selected Pi TUI design

Implement option 3, **current workspace with history rail**, in the real terminal application in this repository. The user has selected this design. Deliver working TypeScript, meaningful tests, updated user controls documentation, and real terminal verification. The HTML mockups are visual references; completing another browser mockup does not complete this task.

## Establish the baseline

1. Read the repository's applicable instructions, `CONTRIBUTING.md`, `README.md`, and `docs/terminal-experience.md`. Inspect Git status and the existing diff before editing. This checkout contains substantial uncommitted work. Preserve that work, including the current local executor implementation. If you isolate your changes, carry the relevant working-tree baseline and design files into the isolated checkout explicitly; a checkout of HEAD alone is incomplete. Keep commits, pushes and pull requests outside this task unless requested.
2. Read `docs/research/agent-tui-design/active-turn/README.md`, `docs/research/agent-tui-design/README.md`, and `docs/research/agent-tui-design/active-turn/QA_REPORT.md`. The selected-layout README controls layout decisions. The parent report controls shared history and inspection behavior. Options 1 and 2 and the earlier timeline prototype are reference material, not additional modes to implement. Current source and runtime documentation control provider and security facts.
3. Inspect `rail-B-120x40.png`, `rail-A-120x40.png`, and `rail-B-80x24.png` in `docs/research/agent-tui-design/active-turn/screenshots/`. Read the installed Pi package documentation and the current code paths listed below. Establish focused baseline results before changing behavior; distinguish existing failures from regressions you introduce.

## Build the selected experience

Give the current operator turn most of the workspace. At 120 columns, place compact previous-turn navigation in a slim left rail. At 80 columns, replace the rail with a focusable history control that opens the same history list. Derive intermediate layouts from available display cells and rows, keeping the existing compact fallback below 80 × 24. Allow the Pi editor to retain its existing bounded multiline viewport.

Separate the current turn from history through a border, restrained background tint, spacing and a strong `CURRENT TURN` heading. Give the current step its own bold or underlined heading and an explicit state. Use terminal styles and display cells, not variable-size fonts or browser layout code. Keep detailed logs folded by default; retain visible tool names, targets, status, counts and a compact pointer to current activity.

Use cyan for **A - Senior** and amber for **B - Junior**. While a role is actually working, use exactly `Active: A - Senior` or `Active: B - Junior`. Carry that identity through the current-turn frame, agent/tool rows, inspector breadcrumb and live-work pointer. Keep role labels, selection markers and state text legible in monochrome. Give severity its own small label without replacing role identity. Use theme and terminal-color capabilities without introducing a framework migration.

Derive the active role and step from real operation and workflow events. Idle, approval waiting, cancelling, completed, failed, cancelled, timed-out and interrupted states must be honest. A cached `status.activeRole` is not evidence of running work. Display `Idle` or `Waiting for approval` when appropriate. Retain the last result until the next accepted request becomes current. The screenshots' turn numbers, timings, test results and three-step trail are fixtures. Do not hardcode them or invent progress totals for discussion or repair loops.

## Implement durable, read-only inspection

Model UI operator turns, individual role runs and tool calls separately. A Pi model turn can end at a tool boundary, so it is not the UI turn number. Use explicit associations among the operator turn, plan, approved execution, workflow/handoff, runtime session/branch, role run and tool-call identities. Link `/approve` to its originating plan even when it creates a new request ID. Keep A's planning and review runs individually inspectable within the correct task history.

Retain calls beyond the existing eight-item recent list. Keep a bounded recent projection for display and load full retained safe detail on demand. The existing 120-character telemetry preview is not full output. Prefer indexing existing persisted Pi records over duplicating every message body. Extend validated read-only parsing where needed to preserve branch identity and access before compaction. Show an explicit unavailable/truncated reason for data that was never retained or was already limited upstream.

Start with `src/runtime/session-history.ts`. Its reader currently returns built session context rather than a complete archive. `SessionManager.open()` can repair files in place; use read-only parsing for inspection. Correlate tool start/update/end events idempotently using scoped identities. Preserve failed and cancelled results; missing completion after restart becomes interrupted or unknown, never successful. Keep history accessible across more than eight calls, session changes and restart without resuming work.

Expand one turn, agent run or tool independently. A tool inspector exposes summary, safe request, retained output and identity/status metadata. An agent-run inspector exposes its objective, visible assistant prose, calls, result and verification. Keep internal workflow machine blocks and hidden reasoning out of normal prose. Large outputs scroll independently and load by range where practical. Render only a bounded viewport; avoid rebuilding all historical Markdown on every token.

Selection and inspection are read-only. They must not submit a prompt, approve a plan, rerun a tool, modify a session file or switch the bound runtime. The existing saved-session preview has an explicit session-switch action on Enter; keep the new record inspector separate from that action. Preserve explicit session/model commands and their idle requirements.

## Preserve navigation and help

- Keep `F1 help` visible. F1 opens contextual shortcuts from any pane or overlay. F1 or Esc returns to the previous view, focus, selection and scroll position. `/help` is the typed editor fallback. Drive help entries and footer hints from the actual bindings.
- Preserve F6 and Shift+F6 for focus cycling. Include the editor, workspace, history rail or compact history control, and the activity pane when shown. Focus an open inspector explicitly. At 80 columns, Enter on the focused history control opens history.
- In history or the workspace's record list, arrows select records, Space toggles one fold, Right expands, Left collapses or moves to the parent, and Enter inspects. Use PageUp/PageDown for viewport navigation, Home for the beginning, and End for the latest record and resumed following. Scope inspector tab keys and printable shortcuts to that focused view.
- Preserve F2 activity, editor Tab completion, Enter submission, Shift+Enter newline, bracketed paste, prompt history, and existing Ctrl+C cancellation/idle-clear/exit behavior. Help, inspection, resize and focus changes must preserve the draft. Busy submissions remain rejected with their draft intact.
- Browsing older records pauses following and retains an ID-based read anchor. Show unread activity and a return-to-current action. Incoming output, completion and resize must not move the reader to a different record. Inspecting another role's history must not change the Active label.

At 80 columns, inspector/history content may replace the body. Keep the active-state pointer, composer and help hint visible. Closing inspection restores the originating history selection; closing help over inspection restores inspection first.

## Use the existing stack and boundaries

Inspect these paths before choosing the change structure:

- `src/app/tui/app.ts`, `src/app/tui/bootstrap.ts` for rendering, focus, overlays and terminal lifecycle.
- `src/types/ui.ts`, `src/app/interactive/service.ts`, `src/app/interactive/store.ts`, and `src/app/interactive/presentation.ts` for shared state and actions.
- `src/app/activity-history.ts`, `src/telemetry/event-normalizer.ts`, and `src/coordinator/bind-runtime-events.ts` for activity identity and events.
- `src/runtime/session-history.ts` and existing persistence/recovery code for read-only history and restart semantics.
- `src/app/plain-repl.ts`, `src/app/cli.ts`, and the existing terminal test helpers and fixtures for fallback behavior and verification.

The installed Pi packages at handoff are `@mariozechner/pi-tui` and `@mariozechner/pi-coding-agent` 0.67.68. Verify that version locally. Use its `Component`, `Focusable`, `Editor`, `Markdown`, `TUI.showOverlay`, `matchesKey`, `Key`, `visibleWidth`, `truncateToWidth` and ANSI-aware wrapping APIs. Latest upstream `@earendil-works` APIs are not the installed compatibility contract. Preserve IME cursor handling and terminal restoration. Follow the repository's strict NodeNext TypeScript settings and use discriminated unions, SDK-derived types and boundary validation rather than unchecked casts.

Keep history loading/projection in the shared service layer and presentation state in the TUI. Give plain mode a textual route to the same safe history/detail behavior and updated help. Preserve Agent A's read-only permissions, Agent B's mutation permissions, approval gates, review limits, cancellation/deadlines, recovery policy and explicit settings persistence. Preserve OpenAI Responses for A, the fixed local LM Studio catalog for B, and broker isolation. Model/provider changes are outside this UI task.

Reuse redaction and trusted storage boundaries for every expanded output path. Sanitize untrusted terminal controls, including cursor movement and clipboard sequences, before rendering. Retain safe text and deliberately allowed styling. Keep credential values and raw environment data out of UI caches and verification artifacts. Actual future spawned-subagent support is outside scope; represent the existing A/B role runs honestly.

## Prove the implementation

Implement in verifiable units: typed identity/history flow, selected layout, inspection, then controls/help. Each unit must exercise its actual service-to-render path before the next. Extend the existing Vitest and real PTY fixtures instead of relying on HTML screenshots or mocked render output alone.

Required acceptance cases:

| Case | Observable result |
| --- | --- |
| A planning, B execution, A review, repair | Correct role color, actual phase, and Active label; no fabricated fixed step count |
| Idle, approval wait, cancellation, timeout and failure | Accurate state; no stale running tool; completed changes and drafts preserved |
| More than eight calls and multiple turns/runs | Earlier calls remain individually inspectable, including full retained output and failures |
| Duplicate events, reused call IDs, restart and session/branch changes | No double counts or cross-session identity mixups; terminal outcomes and unavailable-data reasons preserved |
| Inspect historical tool/run and open/close F1 over it | Same active role, draft, selection and scroll return; zero runtime/session/file mutations |
| 80 × 24, 120 × 40 and resize during streaming/inspection | No display-cell overflow; reachable history control; preserved read anchor and editor |
| CJK, combining marks, emoji, long paths/logs and unsafe ANSI | Bounded, readable, sanitized output and correct cursor behavior |
| Plain fallback, cancellation and shutdown | Usable shared history/help behavior and restored terminal screen, cursor and input modes |

Run the repository checks required by `CONTRIBUTING.md`, including `npm run check`, `npm test`, `npm run build`, `npm run verify:isolation`, `npm run verify:terminal`, and `git diff --check`. Use existing dummy-provider fixtures for automated terminal checks. Report unavailable prerequisites or pre-existing failures precisely. Keep credential-backed smoke testing in the documented trusted installation workflow; it is separate from fixture verification.

Update `docs/terminal-experience.md` and relevant README/help text to match delivered behavior. Finish with a concise change summary, commands and results, actual terminal evidence, and remaining limitations. Mark a requirement complete only when implemented and verified; a screenshot or a passing typecheck alone is insufficient.
