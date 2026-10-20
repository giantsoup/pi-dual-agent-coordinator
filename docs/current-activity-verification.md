# Current activity implementation verification

Source: `main` at `5bdbd48`, with the uncommitted implementation in this checkout.
The approved plan and HTML reference remain unchanged. The unrelated
`unit-converter-test/` directory remains outside this work.

## Implemented behavior

The interactive service owns the correlated Current activity state. Observed
thinking, writing, tool preparation, native execution, waiting, model setup,
cancellation cleanup, and terminal outcomes remain separate from workflow phase.
Native calls retain individual identities and clocks. Stale owners, duplicate
starts, and late terminal events cannot replace the current action. B retains
its run identity through an A check-in. Recent entries belong to the current
request and contain at most three safe tool outcomes or lifecycle milestones.

The panel stays above the measured Pi editor. Help, history, controls, inspectors,
and diagnostics use the body region. Hidden narrative keeps its unread count.
Compact mode keeps input, the action, cancellation, and exit controls. The editor
viewport follows Pi's actual cursor even while a body view has focus. The two-row
footer remains mounted. Only the activity marker animates; `TERM=dumb` is static.

HistoryIndex and RequestTranscript project request-owned milestones alongside
run-owned responses and folded tools. Run settlement and validated review
approval remain different facts. Revision, approval, discard, and check-in labels
come from coordinator events. Archive hydration and restart preserve event order
without writing session files or resuming an unfinished request or approval.
The plain REPL reads the same activity and progress state without per-delta noise.

## Verification

The scoped toolchain is Node `v24.22.0` and npm `12.2.0`. Global defaults, package
versions, lockfile, compiler settings, and Vitest's two-worker fork limit are unchanged.

- `npm run check`: passed.
- Focused unit and real Pi integration checks: 160 tests across 14 files passed.
- `npm test`: 557 tests across 76 files passed.
- `npm run build`: passed, including the native macOS helper.
- `npm run verify:dependencies`: passed for 208 source files and the pinned Pi 1.3.0 toolchain.
- Capture-enabled `npm run verify:terminal`: 1,036 assertions passed across TUI and plain mode.
- `npm run verify:isolation`: 371 dummy assertions and 36 security tests across three files passed.
- `git diff --check`: passed. Local documentation links and whitespace in the new files also passed.

The real Pi narrative integration executes planning, explicit operator approval,
B tools, an A check-in, B continuation, an A revision request, B revision, and final
A review. It checks B's original run identity, actual file contents, chronological
blocks, validated review labels, replay equality, and unchanged archive bytes.
Unit regressions also cover overlapping calls, stale requests and bindings,
duplicate milestones, stable elapsed time, hidden unread output, cursor and draft
preservation, resize, safe display, and static dumb-terminal output.

The PTY verifier retains ANSI streams, decoded screens, color reports, and HTML
rendered from actual terminal cells in `test-results/current-activity/`. Important
captures include:

- `activity-live-120x80`, `activity-live-120x40`, `activity-live-80x24`, and `activity-live-40x12`
- `activity-approval-120x80`, `activity-check-in-120x80`, and `activity-continuation-120x80`
- `activity-revision-120x80`, `activity-final-120x80`, `activity-history-120x80`, and `activity-help-120x80`
- `activity-narrative.ansi` and `report.json`

Each screen has `.screen.txt`, `.colors.json`, and `.html` forms. Reproduce them with:

```sh
PI_TUI_SCREEN_CAPTURE=1 PYTHONPATH=/tmp/pi-terminal-screen-tools \
PI_TUI_EVIDENCE_DIR="$PWD/test-results/current-activity" npm run verify:terminal
```

The optional Python screen tools are documented in
[current workspace verification](current-workspace-verification.md). These are
fixture-provider results, separate from live-provider evidence.

## Implementation adjustments

Pi renders a one-line editor in three rows. The narrative therefore receives one
more row than the plan's illustrative four-row editor budgets. Taller drafts and
completion menus use their measured output. Body views render inline inside the
shared geometry instead of using independent overlays. Compact model choices and
a two-column controls menu keep existing actions available alongside the panel.

The PTY harness now waits for actual rendered drafts and completed session resets.
It scrolls to earlier prose before comparing history restoration, reads inspector
tails explicitly, and compares changing elapsed fields separately from stable
view content. The 120x80 captures prove chronology across check-ins; smaller
captures prove the corresponding viewport and navigation behavior. No assertions
were removed to conceal a missing narrative or state transition.

## Trusted installation and remaining gates

A fresh snapshot is prepared only after implementation checks pass. Its final
path and manifest-verification result are recorded below. The active launcher
and running installation remain unchanged. Activation, restart into the candidate,
local LM Studio inference, and OpenAI inference require separate authorization.
No credential-backed inference, commit, or push is part of this implementation.

Snapshot destination: `/Users/Taylor/.local/share/pi-dual/runtime-current-activity-20261020T055546Z`.
The copy and manifest checks run after all implementation gates. Their machine-readable
result is retained at `test-results/current-activity/trusted-installation.json`.
