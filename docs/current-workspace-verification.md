# Current workspace and retained history verification

## Response narrative and tool totals, 2026-10-19

The previous renderer listed every tool and appended only the latest run's prose.
That hid earlier A/B responses when ownership changed. The request body now uses
ordered response blocks and collapsed tool totals. The live overlay is scoped by
run and message; completed bodies reload through the existing read-only archive
reader. Body-free message metadata preserves ordering on replay. Older logs without
that metadata use retained timestamps. New commentary, run changes, and check-ins
separate tool groups; consecutive tool-only turns roll into one row. B's role is
repeated when it resumes after A's check-in.

The transcript and inspector share validated, readable plan, execution-plan,
handoff, check-in, completion, and review summaries. Raw workflow JSON and thinking
content stay hidden. A response preview keeps the latest 24,000 characters; full
retained output remains available in the run inspector. Expanding a run exposes
its individual calls without hiding narrative responses.

Verification used Node 24.22.0, npm 12.2.0, and the installed Pi 1.3.0 packages:

- Dependency verification, strict TypeScript checking, and build passed.
- The final focused run passed 55 tests. The full suite passed 455 tests in 61 files.
- Isolation passed 341 dummy assertions and both security tests.
- The updated terminal verifier passed 889 assertions across TUI and readline.
  Captures at 80x24 and 120x40 were inspected for A/B prose, collapsed tools,
  check-in/resumption order and attribution, resize, retained selection,
  cancellation, live return, draft preservation, and run/tool inspection.
- A real-Pi integration fixture executed sandboxed write/read calls, retained
  intervening commentary, and restored the identical narrative after restart.
  Reading it left session identities and archive bytes unchanged.
- Regression cases cover repeated tool events, tool-only groups, failed/running
  totals, stale archive loads and runtime text, interrupted responses, long-output
  following, and exclusion of thinking and terminal control sequences.
- `git diff --check` and Markdown fence/local-link checks passed.

These are dummy-provider, sandbox, and PTY results. Live provider inference and
a physical terminal trial were not repeated for this fix. The broader reasoning
summary, animation, and range-cursor proposal remains separate. Existing calculator
changes and the untracked repository instructions were preserved.

## Request history pane refactor, 2026-10-19

The [approved plan](tui-history-pane-refactor-plan.md) replaces the persistent rail
and compact summary row with one temporary request chooser. This section records
the current implementation. The 2026-10-16 results below remain historical.

The checkout started on `main` at `d994140`, with only the untracked approved plan.
No applicable `AGENTS.md` existed at the initial inspection. An unrelated untracked
`AGENTS.md` appeared during implementation; it and its referenced
`CONTRIBUTING.md` were read, and that file was preserved.

The installed direct dependencies match `package.json` and `package-lock.json`.
All four Pi packages are 1.3.0, TypeScript is 7.0.2, and Vitest is 5.0.5.
Verification uses scoped Node 24.22.0 and npm 12.2.0. The ambient shell's
Node 24.10.0 and npm 11.6.0 were not used for acceptance checks. No application
dependencies, lockfile, global defaults, or launchers changed.

### Behavior and evidence

- Closed history reserves no body column, summary row, or focus-cycle target.
  Unit checks cover 80, 103, 104, 105, 120, and 180 columns with ANSI-aware sizing.
- Esc then r opens history from the editor, transcript, or activity pane. F4 opens
  and dismisses it directly. Esc on the base screen opens controls; Esc then e
  focuses the editor. Higher-priority views still close first.
- The workspace owns a provisional request target and chooser viewport.
  Navigation changes neither the displayed request nor execution ownership.
  Enter chooses; Esc/F4 cancels. Current includes a blank current conversation.
- Real Pi Editor tests prove multiline draft and insertion-cursor preservation,
  fragmented paste capture, help restoration, focus capture, contextual End/l,
  model-loading precedence, scroll anchors, folds, and deferred inspector rejection.
  Status fixtures cover every retained outcome and missing candidates.
- The real Pi integration creates a pending plan, chooses and inspects an earlier
  request, and compares the pending-plan object, current turn, runtime binding
  objects, session messages, session IDs, and all persisted JSONL bytes.
  Submit, approve, discard, and replacement spies remain untouched.
- PTYs exercise the built app with real Pi sessions, sandboxed tools, and dummy
  Responses/Chat Completions providers. They preserve the existing approval,
  supervision, cancellation, terminal-restoration, and plain-mode command checks.
  New flows compare pending-plan/session identity and archive hashes while idle,
  plus running request ownership during retained selection and cancellation.
- Captured screens at 80x24 and 120x40 include closed/open history, provisional
  highlight, help return, resize while choosing, paste, dismissal, historical
  selection, return to live output, cancellation, and empty Current. Screen
  assertions verify row/cell budgets, terminal-default bodies, and role accents.

Pi 1.3's installed `matchesKey` recognizes legacy F4 but misses enhanced F4 forms.
The binding table normalizes unmodified enhanced press/repeat forms into `Key.f4`
matching. Release and modified events remain inactive. Encodings follow the
[Kitty keyboard specification](https://sw.kovidgoyal.net/kitty/keyboard-protocol/#functional-key-definitions).
No dependency patch or upgrade is involved.

### Verification results

Checks ran sequentially under Node 24.22.0 and npm 12.2.0:

- `npm run verify:dependencies`: passed, including pinned installed versions and
  strict compiler settings.
- `npm run check`: passed.
- Focused Vitest command below: 100 tests in five files passed.
- `npm run build`: passed, including the native helper.
- `npm test`: 445 tests in 58 files passed.
- `PI_TUI_SCREEN_CAPTURE=1 PYTHONPATH=/tmp/pi-terminal-screen-tools npm run verify:terminal`:
  passed all 883 PTY assertions with screen capture enabled. The actual 80x24 and
  120x40 captures were inspected, including resize, selection, cancellation, wheel
  routing, unread activity, and return to live output.
- Markdown validation: seven edited documents, 73 local link targets, and balanced
  code fences passed.
- `git diff --check`: passed. The complete final diff was reviewed. No commit,
  push, dependency upgrade, or launcher change was made.

A PTY rerun exposed a verifier timing assumption: the initial screen could be
captured before retained prose hydrated. The verifier now waits for visible prose
before comparing dismissal screens. The application keeps normal live updates.

### QA follow-up

A second QA pass reviewed the full uncommitted diff against repository standards
and the approved plan. Independent Standards and Spec reviewers found no hard
standards violations. The Spec review identified missing running-selection
coverage, which is now implemented with a real Pi request held at a provider gate.
The QA pass reproduced four interaction bugs with failing regression tests and
fixed their owning presentation paths:

- Idle Ctrl+C now dismisses contextual help before the covered history pane.
  Repeated dismissal preserves the draft and chooser until each visible view closes.
- Conversation reset synchronizes workspace state before app input, focus, footer,
  and editor rendering. The first frame restores the editor's IME cursor marker.
- Opening history retains the last visible read baseline. Activity that arrived
  under help remains unread when history opens before another live-body render.
- Opening history cancels visible and pending editor completion through Pi's
  public `setAutocompleteProvider()` API. At 80x24, a seven-line draft plus activity
  no longer lets completion hide the chooser or footer. The editor object, text,
  cursor, and prompt history remain mounted; completion works after dismissal.

The new real Pi integration selects, inspects, and dismisses retained history
while the current request is running. It verifies the current turn, run, operation,
runtime bindings, and mutating action counts remain unchanged. After normal
completion, an explicitly submitted prompt retains the current conversation's
messages. Archive byte equality remains covered separately in the idle fixture.
Fixed sleeps in that archive inspection test were replaced with content-based waits.
Captured output also exposed a readability issue at 80 columns: long active tool
labels could truncate the unread count and return-to-current shortcut. The live
pointer now places unread activity before elapsed time and tool detail. Its action
hint follows the visible view: `l current` in the chooser, `Esc back` for a modal
or inspector, and `Esc then l current` on the base screen. The 80-column regression
executes the displayed action and verifies draft cursor preservation.

Both independent reviewers re-read the fixes and reported no additional findings.
Their reviews were read-only; the automated and PTY checks were run against the actual
workspace and built application.

### Reproduce

Use the required project-scoped Node/npm toolchain. Run these checks sequentially:

```sh
npm run verify:dependencies
npm run check
npx vitest run test/unit/workspace-controls.test.ts test/unit/tui-app.test.ts test/unit/terminal-interaction.test.ts test/unit/retained-history.test.ts test/integration/retained-history.test.ts
npm run build
npm test
PI_TUI_SCREEN_CAPTURE=1 PYTHONPATH=/tmp/pi-terminal-screen-tools npm run verify:terminal
git diff --check
```

Screen capture uses the existing external verification-only Python setup shown
below. `test-results/terminal-evidence/chooser-80-*` and `chooser-120-*` contain the
new screen and color reports. `history-chooser-80.ansi` and
`history-chooser-120.ansi` contain actual PTY bytes. The generated `report.json`
records the current verifier result. Captures are ignored disposable artifacts.

### Limits

These checks use fixture providers, not live OpenAI or LM Studio inference.
No credential-backed trial, trusted installation, launcher activation, or physical
terminal test was performed. Injected PTY F4/wheel input does not establish that
an OS or terminal configuration delivers physical F4 presses or trackpad gestures.
The separate narrative transcript redesign and conversation resumption remain
outside this change. Existing bounded prose and archive-loading limits still apply.

## Original workspace implementation, 2026-10-16

Implementation date: 2026-10-16. This implements selected option 3 in the real Pi
terminal app. The HTML studies remain visual references. Both installed Pi
packages are 0.67.68. No dependencies, providers, role permissions, approval gates,
review limits or recovery policy were migrated.

The starting checkout contained extensive uncommitted local executor, terminal,
security and design work. Implementation stayed in that checkout and preserved
that baseline. No commit, push or pull request was created. No applicable
`AGENTS.md` was found in the checkout or its ancestors.

## Baseline and final checks

Before behavior changes, `npm run check`, all 174 tests in 39 files, and the
existing 44-assertion real PTY verifier passed. There were no observed baseline
failures in those checks.

Final commands and results are recorded below. The generated terminal report is
`test-results/terminal-evidence/report.json`; captures are ignored working files
and regenerate with the verifier.

- `npm run check`: strict NodeNext TypeScript passed.
- `npm test`: 200 tests in 42 files passed after the border-color update.
- `npm run build`: TypeScript and native helper build passed.
- `npm run verify:isolation`: 284 dummy assertions and both security tests passed.
- `npm run verify:terminal`: real Pi sessions, sandboxed tools, TUI and readline.
  All 178 assertions passed with real PTY screen capture enabled after the
  border-color update.
- `git diff --check`: passed.

An early extended PTY run exposed End arriving while inspector output was still
loading. End now waits for the retained line count and reaches the actual tail.
The verifier waits for observed content rather than assuming a fixed load delay.
Other intermediate failures were corrected test expectations for safe isolation
errors and updated controls, not pre-existing baseline failures.

## Observable acceptance evidence

| Requirement | Verification |
| --- | --- |
| Actual planning, execution, review and repair | PTY fixtures execute a real A plan, twelve B reads, A review, and an invalid A plan followed by protocol repair. Individual role runs and phases are indexed. Actual cyan/amber escape styles reach the TTY. |
| Honest idle, approval, cancellation, timeout and failure | Existing real cancellation/deadline/failure PTYs remain, plus state/role tests. Completed calls stay terminal; missing ends become interrupted. An unknown restart completion time stays unknown. No fixed step total is rendered. |
| More than eight calls and individual failed output | Twelve real B calls remain indexed, including the failed fifth call. Both interfaces inspect the first call's 302 retained source lines and the failed call's safe result. Recent activity remains a bounded eight-item projection. |
| Duplicate events and reused IDs | Unit checks replay duplicate starts/ends and reuse call IDs across distinct sessions/runs, with no double counts or reopened terminal records. |
| Restart, session changes, branches and compaction | A real Pi/service integration reloads history after a new session and process-style service/coordinator restart, with file hashes unchanged by reads. Validated archive fixtures retain separate branches and pre-compaction messages. Existing integration tests exercise real Pi compaction and cancellation. These are separate checks, not a claim of a single PTY exercising every branch/restart combination. |
| Read-only inspection and F1 return | The PTY verifier hashes all persisted JSONL files before/after tool inspection, help, and navigation. Hashes and runtime bindings remain identical. Screen comparison verifies the same inspector content and scroll return. Draft submission afterward proves preservation. |
| 80x24, 120x40 and resize | Real PTY captures cover B execution, A review/repair, historical output, failed output, history control and help. Unit checks include intermediate widths, multiline editor height and the compact fallback. All captured rows fit their display-cell budgets. |
| Unicode and unsafe terminal controls | Fixtures include CJK, combining accents and emoji. Pi's real Editor cursor marker is checked across focus changes. OSC clipboard and cursor-movement payloads in actual tool output never reach the PTY. Long retained output pages independently. |
| Plain mode and terminal restoration | Textual `/history` and `/inspect` share the same safe service. Existing PTYs check cancellation, busy drafts, SIGTERM/SIGHUP/SIGINT, double Ctrl+C, startup failure and restored input modes, cursor and main screen. |
| Color and monochrome | Unit tests exercise both roles through the workspace and inspector, plus standard accents on basic, 256-color and Ghostty terminal settings. Body colors remain terminal defaults regardless of `COLORFGBG`. Real PTY cells retain standard cyan/amber accents without colored fills. `NO_COLOR` and `TERM=dumb` preserve semantic labels. |

## Border-color readability update

The colored body fills made text difficult to read in Ghostty. Current-turn and
inspector frames now use role-colored borders and bold headings. Prose uses the
terminal's default foreground and background. Standard ANSI cyan identifies A;
standard ANSI yellow/amber identifies B. Nested role rows reset their own styles
without leaving a background or role foreground on subsequent prose.

Focused baseline checks passed all 15 workspace/control tests before this update.
The final full suite passed all 200 tests. An initial full-suite attempt overlapped
a clean build, temporarily removing isolated tool workers and causing two failures.
The complete suite passed when rerun after the build. No executor code was changed.

The PTY verifier now checks effective screen-cell colors, including A repair and
review, B execution, historical tools, help and resize at 80x24 and 120x40. All
eleven captured views have default backgrounds and readable foregrounds. Using
the installed Ghostty 1.3.1 default palette, prose has 14:1 contrast, cyan 6.75:1
and amber 8.69:1. These are palette calculations from actual rendered cell styles,
not measurements of physical displays or transparency over a desktop. Pi's blank
editor cursor can use inverse video; ordinary text does not.

Each screen capture has a matching `.colors.json` report. The verifier's initial
color assertions were corrected to allow that blank editor cursor and use a
4.5:1 minimum for role accents, with a separate 7:1 minimum for default prose.
The final run passed all 178 assertions. Ghostty settings were not changed by
this update. No physical Ghostty UI automation was available.

## Reproduce terminal evidence

The default verifier requires only the existing documented Python/macOS/runtime
prerequisites and dummy providers. It writes an ANSI recording and JSON report:

```sh
npm run verify:terminal
```

Optional screen capture decodes the actual PTY output with Pyte. Install these
verification-only Python packages outside the repository, then run:

```sh
python3 -m pip install --target /tmp/pi-terminal-screen-tools pyte==0.8.2 wcwidth==0.9.2
PI_TUI_SCREEN_CAPTURE=1 PYTHONPATH=/tmp/pi-terminal-screen-tools npm run verify:terminal
```

`PI_TUI_EVIDENCE_DIR` can select another output directory. Fixture terminal
processes explicitly use `xterm-256color` and remove inherited `NO_COLOR` so role
styles can be asserted. This does not change the user's app environment.

Captures include:

- `B-execution-120x40.screen.txt` and `B-execution-80x24.screen.txt`
- `A-review-120x40.screen.txt` and `A-repair-80x24.screen.txt`
- `historical-tool-120x40.screen.txt` and `historical-tool-80x24.screen.txt`
- `failed-tool-80x24.screen.txt`, `history-list-80x24.screen.txt` and
  `previous-A-run-80x24.screen.txt`
- `help-over-inspector-120x40.screen.txt` and `restored-inspector-120x40.screen.txt`
- `history-tui.ansi` and `history-repair.ansi`, captured from the real PTY

These files contain disposable fixture data. They are terminal evidence, not
browser mockups or credential-backed sessions. The fixtures perform no live
inference or real credential retrieval. A fresh trusted installation was separately
hash-checked against all 361 build files and passed `doctor`. That check verifies
the existing Keychain credential through the trusted private pipe without a live
provider request. The local `duala` launcher uses that new snapshot. Follow the
separate trusted installation workflow for a credential-backed smoke test.

## Limits

Archive range loading currently reads/parses the complete Pi file before returning
a bounded range. Retained metadata grows with history; rendering and prose caches
are bounded independently. Older unindexed calls cannot gain missing run/turn
associations retroactively. Replaced memory sessions and invalid/missing archives
report unavailable content. Pi output truncation and safe isolation error limits
remain explicit, and arbitrary external output files are not followed.

Physical IME candidate-window placement and every terminal/theme combination were
not manually tested. The existing Pi focus/cursor mechanism is preserved and its
marker is verified. Search, copy/export, UI preference persistence and future
spawned subagents remain outside this task.
