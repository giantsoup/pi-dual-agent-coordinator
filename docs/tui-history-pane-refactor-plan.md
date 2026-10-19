# Replace persistent history with an on-demand request chooser

Status: approved and implemented on 2026-10-19. Investigation baseline: `main` at `d994140`.
The investigation and design below record the approved scope. Current results are in
[current workspace verification](current-workspace-verification.md).

## Recommendation

Remove the permanent History column and the narrow-screen History row. Give the displayed request the full available body width. Open a temporary, full-width Request history pane with **Esc, then r**, and add **F4** as a direct alias. Up/Down highlights a request, **Enter** displays it and closes the pane, and **Esc** dismisses the pane without changing the displayed request.

Use the same pane at every terminal width. Keep the existing editor, live agent/status indicator, and footer mounted. Reserve no history column, row, or hidden focus target when the pane is closed. Put the shortcut in the existing footer and help.

For this plan, a "thread" means one retained operator request, including its A/B runs and tool calls, as shown in the supplied screenshot. Choosing it changes the active **displayed request**. It does not change the agents' conversation context or redirect a running workflow. The repository does not currently model those requests as independently resumable, paired-agent conversations. If "active thread" is intended to mean resuming an earlier conversation for future prompts, that requires a separate session-lifecycle design before implementation. This interpretation is part of the proposal for review.

## What the investigation established

- [CurrentWorkspace](../src/app/tui/workspace.ts#L41) already owns history selection, the displayed turn, scrolling, following, folds, and the read-only inspector. This is the appropriate owner for the chooser.
- [Workspace rendering](../src/app/tui/workspace.ts#L262) always reserves a rail at 104 or more columns and 14 or more body rows. Below that threshold it reserves a history summary row. [App rendering](../src/app/tui/app.ts#L260) independently repeats the geometry for mouse bounds. Removing the rail requires updating both places.
- [History input](../src/app/tui/workspace.ts#L148) currently changes `viewedTurnId` during arrow navigation. Enter opens inspection. [historyRows()](../src/app/tui/workspace.ts#L366) excludes the current turn and can include runs and calls. A request chooser needs different selection semantics and a turn-only list.
- [Focus and closing](../src/app/tui/workspace.ts#L73) assume history is always reachable. Closing the narrow pane leaves focus on `history`; the normal F6 cycle also includes history when closed. Both assumptions must be removed.
- [HistorySnapshot](../src/types/history.ts#L20) identifies the executing/current turn separately from the workspace's viewed turn. [HistoryIndex](../src/app/interactive/history.ts#L37) retains metadata from coordinator events. Bodies remain in Pi archives, accessed through [loadHistoryDetail()](../src/app/interactive/service.ts#L689).
- [Archive access](../src/coordinator/coordinator.ts#L512) enforces role directory, project, session identity, and run ownership. [Session-history readers](../src/runtime/session-history.ts#L4) explicitly avoid opening sessions for inspection because opening can repair files. The chooser needs no persistence changes.
- [bindings.ts](../src/app/tui/bindings.ts#L28) already provides the portable `Esc`, then `r` action. [The portable-controls commit](https://github.com/giantsoup/pi-dual-agent-coordinator/commit/40f5fbc2a65726e42b464d6d586a7a68dfd92508) and [terminal guide](terminal-experience.md#keyboard-controls) establish that convention. The earlier [history implementation](https://github.com/giantsoup/pi-dual-agent-coordinator/commit/b61f7c275746bb59e60757ae7be84da9bc035433) established read-only inspection and border-only role accents; those remain useful constraints.

The screenshot establishes the layout problem, not the identity of the running build. These findings were checked against this checkout and installed dependencies, rather than assuming the screenshot came from this exact commit. No issue tracker, team chat, observability, or analytics connector was available for additional design history. The source, repository documentation, commit messages, and primary library documentation supplied the evidence used here.

## Intended interaction

### Open and choose a request

1. Start with a full-width request body and the existing composer. The existing footer advertises `Esc r history` and the optional F4 alias.
2. Open Request history from the editor, transcript, or activity pane. Preserve the editor object, text, cursor, prompt-history state, and underlying request view.
3. Show retained requests in their existing chronological order, followed by a stable **Current request** entry. Exclude the current turn from the retained list to avoid duplication. If the current conversation has no request yet, label the entry **Current conversation · empty**.
4. Initially highlight the displayed retained request, or the Current entry when viewing current work. Each retained row shows its request number, outcome, safe title, and compact run/call summary. Show a readable selection marker as well as status text.
5. Move the provisional highlight without changing the underlying displayed request. Enter on a retained request commits its ID, closes history, pauses following, resets the previous request's viewport anchors, and focuses the transcript. Enter on Current uses the existing return-to-current behavior and resumes following.
6. Esc or F4 while the chooser is open cancels it and restores the valid origin focus. Preserve the underlying request, folds, scroll anchor, and following mode. Returning to visible live output may acknowledge activity normally; returning to a paused view must retain unread activity.

The chooser lists requests only. After choosing one, use the transcript's existing fold controls and Enter inspector to inspect its runs and calls. This removes two competing record trees and keeps Enter's meaning clear in each context.

At this refactor's baseline, the workspace displayed run/call metadata and only
the latest run's prose preview. The subsequent response-view fix now retains both
agents' output with collapsed tool totals. See [terminal controls](terminal-experience.md)
for shipped behavior and the separate [narrative-history plan](tui-narrative-history-plan.md)
for remaining proposals.

### Keep shortcuts contextual

- `Esc`, then `r` remains the portable primary path. F4 opens the chooser directly from the base screen and dismisses it when already open. Verify both legacy F4 encodings and enhanced keyboard input with Pi's `Key.f4` and `matchesKey`.
- Up/Down moves one request and clamps at the edges. PageUp/PageDown, or `u`/`d`, moves by the visible request count. Home, or `g`, highlights the first entry. End highlights the final Current entry. Enter is still required to choose it.
- In the chooser, `l` explicitly chooses Current and resumes following, preserving the existing "latest" action. Handle this before `browsingInput()` translates `l` into End. Outside the chooser, retain current End/latest behavior.
- F1 or `h` opens contextual help and restores the same chooser highlight and viewport when closed. While the chooser is open, consume Tab and F6 rather than focusing the covered transcript or hidden editor. Normal focus cycling excludes closed history entirely.
- Keep service modals and the inspector above the chooser entry point. Close those views before opening history. Do not open a chooser through a model-loading screen or stack another model picker over it. While choosing, consume F2/F3; show the available actions in contextual help.
- Running-work Ctrl+C still cancels work through the existing coordinator path and preserves the draft. Idle Ctrl+C dismisses the chooser first; it must not clear the hidden draft or trigger the editor's double-press exit path.
- Consume printable input and complete bracketed-paste sequences while choosing. Add an app-owned paste latch, analogous to `controlsPaste`, that captures start/content/end chunks before global shortcut handling and releases only after the end marker. Pasted letters, Enter, and shortcut-looking bytes must neither select a request nor reach the editor. Preserve ordinary typing, Backspace, Tab completion, and paste behavior when history is closed.
- Wheel/trackpad events inside the history body move the chooser viewport/highlight without committing. Never scroll the covered transcript. Click-to-select and search/filtering can be added later if needed; neither is required for this refactor.

Avoid Ctrl+H. Installed Pi key matching accepts raw `0x08` as both Backspace and Ctrl+H. F4 is unused by the coordinator's existing binding table and fits the F1/F2/F3 convention. Keep the portable path because a terminal or OS may intercept function keys.

## Proposed ownership and typed shape

Use the existing app-to-workspace boundary. The callers stay small:

```ts
	// CoordinatorTuiApp.runControl(), also used by the direct F4 action.
	case "history":
		this.workspace.openHistory(this.service.getState());
		break;

	// Chooser-specific raw input precedes generic browsing-key translation.
	if (this.workspace.historyVisible) {
		this.workspace.handleInput(data, state);
		return;
	}

	// Existing Esc handling keeps one presentation-close boundary.
	if (this.workspace.close()) this.tui.requestRender(true);
```

The input example describes the chooser branch after paste, cancellation, help, and higher-priority view handling. It must not bypass those checks.

Suggested private presentation types and signatures, not an implementation:

```ts
	type HistoryTurn = Extract<HistoryRecord, { kind: "turn" }>;
	type HistoryTarget =
		| { kind: "live" }
		| { kind: "turn"; id: HistoryTurn["id"] };
	type HistoryOrigin = "editor" | "transcript" | "activity";
	type HistoryPane =
		| { kind: "closed" }
		| { kind: "open"; candidate: HistoryTarget; origin: HistoryOrigin };

	// CurrentWorkspace: proposed additions/replacements.
	public get historyVisible(): boolean;
	public openHistory(state: InteractiveUiState): void;
	private historyInput(data: string, state: InteractiveUiState): boolean;
	private chooseHistory(state: InteractiveUiState): void;
	private renderHistoryPane(
		state: InteractiveUiState, width: number, height: number
	): string[];
```

Keep the candidate separate from the committed `viewedTurnId`. The live target is an explicit variant, so a blank current conversation remains selectable without inventing a history record. Resolve retained IDs against the latest snapshot when choosing; the target must still be a turn. If it disappeared, keep the pane open, explain that the request is unavailable, and reconcile to a visible candidate. Require another explicit confirmation rather than choosing a different request silently.

Opening is idempotent and does not call `browse()` or mutate committed viewport state. Keep origin data and the candidate in the open variant rather than unrelated booleans. Reset closes the chooser through the existing `resetId` boundary. Ordinary event updates preserve the candidate by ID, not by array index. The live target continues to represent current work if a new turn starts while history is open.

Keep these details inside `CurrentWorkspace`; the app owns input priority and its mounted editor. Avoid a separate controller that only forwards workspace methods. Follow the existing strict NodeNext TypeScript settings, `.js` import suffixes, `import type`, discriminated unions, and safe handling of optional indexed values. Derive record types with `Extract`; no duplicate persistence schema, `any`, or unvalidated cast is needed.

### Preserve live state while its body is covered

Opening history must not mark hidden output read. Today `render()` advances `readRevision` whenever `following` is true, before its history return path. Gate acknowledgment on the request body being visible, and capture the existing revision/stream baseline when history first covers it. Reuse current unread semantics rather than treating this estimate as an exact message count.

Updates may refresh outcome labels, counts, and the separate live pointer. They must not move the candidate or change the selected historical request. Cancel restores the previous following/paused policy. Choosing a retained request starts a new viewport for that request; choosing Current deliberately clears unread state through the existing follow action.

Keep existing asynchronous detail generation checks. Invalidate the prior inspector generation when closing it, opening history, committing a different request, or resetting the conversation. Late inspector results must not reopen an inspector, change the chooser candidate, or replace a newer displayed selection. Verify this with a deferred detail promise that settles after navigation. Do not load every archive to populate history. Project metadata from the snapshot, render only visible rows, and hydrate retained prose/details through the existing bounded APIs after selection.

When an older request is displayed, use `HISTORY REQUEST` plus a concise footer/status explanation that new prompts continue the current conversation. Showing old output must not make the composer appear to resume that request. Approval still refers to the coordinator's pending plan, never the viewed history item.

## Files and implementation sequence

1. Add focused interaction coverage in [workspace-controls.test.ts](../test/unit/workspace-controls.test.ts) for staged selection, cancellation, current/empty targets, and full-width closed rendering. Reproduce the old rail and arrow-preview behavior before replacing it.
2. Refactor [workspace.ts](../src/app/tui/workspace.ts) around the chooser state. Remove `focusHistory(state, wide)`, `historyOpen`'s width-dependent behavior, the permanent rail, compact history row, and the historical run/tool tree. Retain transcript fold sets and inspection. Add chooser navigation, explicit choose/cancel, live/read baselines, and reset reconciliation together.
3. Update [app.ts](../src/app/tui/app.ts) in the same implementation change. Remove `historyRailVisible` and duplicated rail offsets. The request body always spans the available width; route its bounds to the visible history body or transcript as appropriate. Retain the existing header/editor/footer/activity height budgets. Route chooser input before transcript scrolling and generic pane cycling, with the precedence described above.
4. Update [bindings.ts](../src/app/tui/bindings.ts) as the single source for the history action, F4 alias, contextual Enter/End meanings, footer, and help. Update control-menu descriptions from "browse earlier requests" to choosing a displayed request. Keep `/history` and `/inspect` compatible.
5. Extend [tui-app.test.ts](../test/unit/tui-app.test.ts), [terminal-interaction.test.ts](../test/unit/terminal-interaction.test.ts), [retained-history integration coverage](../test/integration/retained-history.test.ts), and [the PTY verifier](../scripts/verify-terminal.py). Replace old always-visible-rail assertions with closed/open/select/cancel assertions. Preserve unrelated workflow, archive, and safety assertions.
6. Update [README.md](../README.md), [terminal-experience.md](terminal-experience.md), and the current verification record when implementation is actually verified. Mark this plan as superseding only the persistent-rail/navigation recommendations in the existing narrative-history plan and its implementation prompt. Do not silently merge that unimplemented transcript redesign into this work.

Keep the first implementation confined to the existing TUI and its tests/docs. No dependency, renderer, telemetry, archive format, runtime replacement, or coordinator scheduling change is required. Plain mode's `/history` remains the existing textual retained-record view and `/inspect` remains the detail path. Its service currently opens a `records` modal, not this presentation-local chooser; document the distinction rather than silently breaking command behavior.

## Alternatives and synthesis

Two independent designs were compared against explicit selection/cancel behavior, runtime separation, focus/draft/live correctness, maintenance cost, and terminal verification.

The base recommendation is the uniform body-replacement pane. It removes width-dependent history behavior and lets the existing workspace own navigation without another service API. The responsive-drawer design contributed an explicit live target, stable-ID reconciliation, and careful mouse-bound ownership. An independent cross-review also preferred this base and identified the paste-latch, idle Ctrl+C, asynchronous detail, and hidden-output acknowledgment requirements incorporated above.

An on-demand docked drawer on wide terminals would preserve side-by-side request context. It also retains two layouts, breakpoint transitions, hidden-pane focus rules, and mouse geometry that changes when the editor or activity consumes height. That cost is not justified for a chooser that closes immediately after selection.

A native Pi overlay is supported, but the app already uses overlays for service modals and has an existing body-replacement history path. Adding another overlay would introduce stacking, focus restoration, and available-height coordination. A simple visibility toggle on the old rail is smaller in lines changed, but preserves arrow-triggered view changes, Enter-inspects behavior, and invisible focus targets. It does not satisfy the proposed chooser contract.

The accepted tradeoff is temporarily covering the transcript while choosing. The editor and live pointer remain visible, the pane closes in one action, and narrow/wide terminals behave identically. Search, cross-project history, conversation resumption, and richer historical transcript rendering remain separate work.

## Primary library research

The pinned stack is `@earendil-works/pi-tui` 1.3.0, TypeScript 7.0.2, and Vitest 5.0.5. `package.json` requires Node `>=24.22.0 <25` and npm `>=12.2.0 <13`. Older research mentioning `@mariozechner/pi-tui` 0.67.68 is historical and must not determine this implementation.

- The installed [Pi TUI README](../node_modules/@earendil-works/pi-tui/README.md) and declarations are the API authority for this checkout. The [official upstream README](https://github.com/earendil-works/pi/blob/main/packages/tui/README.md) was checked for context. It documents components, keyboard matching, ANSI-aware sizing, overlays, and focus. Upstream `main` can move beyond the pinned package.
- Installed `dist/keys.js` supports `Key.f4` and legacy F4 sequences `ESC O S` and `ESC [14~`. It also documents ambiguous raw Backspace/Ctrl+H behavior. The [Kitty keyboard specification](https://sw.kovidgoyal.net/kitty/keyboard-protocol/#legacy-key-event-encoding) explains the underlying legacy control-key collisions.
- Installed `SelectList` exposes selection/highlight callbacks and selected-index access, but its `handleInput()` implements Up/Down, Enter, and cancel, not PageUp/PageDown or Home/End. Filtering support is not a complete input/search UI. Reuse the current app-owned list rendering/navigation; if `SelectList` is chosen during implementation, supply the missing navigation explicitly and preserve stable IDs when rebuilding its items.
- [bootstrap.ts](../src/app/tui/bootstrap.ts#L29) constructs `TuiMainScreen` and manually enters the terminal's alternate buffer. That is not `TuiAltScreen`. Native SelectList mouse handling is documented for the latter; implement wheel routing through the current app path instead of assuming those APIs apply. No renderer migration is needed.

## Verification required for implementation

Use the real Pi editor and existing MemoryTerminal fixtures, plus actual PTY input. Verify these behaviors:

- At 80×24, 103/104/105 columns, 120×40, and a wider size, closed history reserves no column or summary row. The request uses full width. Every screen fits the terminal's row count and ANSI-aware cell width.
- Open/choose/cancel with no retained turns, one retained turn, many turns, blank current conversation, long Unicode titles, warnings, missing archives, and every existing outcome. Test first/last entries, repeated opens, page navigation, and context-specific End versus latest behavior.
- Highlighting does not change the committed view. Esc restores the previous view, focus, scroll anchor, folds, and follow policy. Enter selects exactly the highlighted retained ID. Current resumes following. Reopening initially highlights the displayed request.
- During streaming, check-ins, completion/failure, and cancellation, the candidate stays stable and hidden output is not acknowledged as read. Opening/closing help and resizing preserve the chooser. Conversation reset closes it. Late detail completion cannot overwrite a newer view.
- Preserve a multiline editor draft and insertion cursor across choose/cancel/help/resize. Confirm input at the restored cursor, rather than checking text alone. Test fragmented bracketed paste, fast combined Esc-letter input, F4 variants, editor autocomplete, and prompt history.
- Ctrl+C cancels running work from history while preserving the draft. Idle Ctrl+C closes history without clearing the draft or exiting. Closed history is absent from F6/Tab cycling; open history cannot send keys to covered panes. Models/loading/inspector precedence behaves as specified.
- Wheel routing targets the visible body after resize and activity/editor height changes. Preserve default body colors, cyan/amber role accents, `NO_COLOR`, `TERM=dumb`, readable selection markers, and the below-80×24 compact fallback.
- In an idle fixture, choosing/inspecting history leaves `currentTurnId`, pending-plan identity, both runtime/session IDs, and persisted archive bytes unchanged. Assert no submit, approve, discard, runtime-replacement, or rerun action. In a running fixture, allow normal execution progress and assert chooser actions introduce no such mutation.
- `/history` and `/inspect` still work in plain mode. Existing read-only archive integration tests and explicit session-switch tests continue to pass.

Run checks sequentially, under the package's required Node/npm versions, because builds clean `dist` and must not overlap tests:

```sh
	npm run check
	npx vitest run test/unit/workspace-controls.test.ts test/unit/tui-app.test.ts test/unit/terminal-interaction.test.ts test/unit/retained-history.test.ts test/integration/retained-history.test.ts
	npm run build
	npm test
	PI_TUI_SCREEN_CAPTURE=1 npm run verify:terminal
	git diff --check
```

The PTY capture mode requires `pyte` and `wcwidth`; follow the existing verifier setup. Capture closed, chooser-open, selected historical, and returned-live states at 80×24 and 120×40, including resize while choosing. Update the verifier's old wide-layout assertion near line 427 and narrow-history flow near line 504. Inspect actual screen output for usable titles, visible actions, live status, and composer space. A screenshot alone does not prove state isolation.

Before a user-facing runtime trial, build and install to a fresh trusted directory using the [existing installation workflow](terminal-experience.md#test-locally-from-this-checkout). Verify the installed artifact and launch that exact build. Do not assume a launcher or existing process uses this checkout. Exercise F4 delivery and wheel behavior in the user's terminal; fixture PTYs alone cannot establish OS key interception. Do not activate a different launcher as part of this planning task.

## Checks completed for this plan

- Inspected the source paths above, current branch/commit, existing tests/verifier, prior design documents, installed Pi 1.3.0 implementation/declarations, and primary upstream documentation. The initial working tree was clean; no applicable `AGENTS.md` was found in this repository or its ancestor paths.
- `npm run check`: passed using Node 24.22.0 and npm 12.2.0.
- `npx vitest run test/unit/workspace-controls.test.ts test/unit/terminal-interaction.test.ts test/unit/retained-history.test.ts test/integration/retained-history.test.ts`: 4 files, 55 tests passed using Node 24.22.0 and npm 12.2.0.
- The ambient shell has Node 24.10.0/npm 11.6.0. Final checks used the existing trusted runtime's `bin` directory at `/Users/Taylor/.local/share/pi-dual/runtime-stream-deadline-20261019T035045Z-ready/bin`, verified as Node 24.22.0/npm 12.2.0, prepended to the check command's PATH only. An initial pass also succeeded under Node 24.22.0/npm 11.19.1; the exact-toolchain rerun above is the reported acceptance baseline. No dependency installation, launcher change, or lockfile change was performed.
- Checked all 27 local Markdown link targets, code-fence balance, and document whitespace. Direct installed-library checks confirmed both F4 encodings match and raw `0x08` matches both Backspace and Ctrl+H.
- These were baseline source checks. At investigation time, the proposed interaction had not been implemented, captured in a PTY, exercised with live agents, or installed. Full-suite and new-behavior verification were left for implementation.

The approved implementation uses the request-only, full-width chooser with Enter-to-select and presentation-only history selection. The baseline checks above describe the original investigation, not the final implementation verification.
