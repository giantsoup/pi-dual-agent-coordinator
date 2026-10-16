# Current workspace and retained history verification

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
