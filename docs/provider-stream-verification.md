# Provider stream verification

The 20 October 2026 change separates Agent B's 120-second upstream idle limit
from its 30-minute absolute request cap. It retains specific safe failure reasons
and B's attribution after A check-ins, without replaying tools or handoffs.

The original failure and implementation contract are in the
[investigation and prevention plan](provider-stream-failure-prevention-plan.md).

## Source verification

Checks use scoped Node 24.22.0 and npm 12.2.0. Unrelated compaction and TUI work
was present at the start and remains intact.

- `npm ci` passed, including the native build, with zero reported vulnerabilities.
- The restored timeout tests failed before the fix: eight failures in ten tests.
- The current-activity regression reproduced the incorrect check-in attribution.
- `npm run verify:dependencies` and `npm run check` passed.
- `npm test` passed: 84 files and 614 tests.
- `npm run build` passed.
- Both compiled-broker diagnostics passed. The prepared-artifact check covers
  active-stream survival, idle failure, and absolute-deadline failure using
  injected streams. The original diagnostic now survives 150 simulated seconds.
  A differential run against the previous faulty compiled broker failed as
  expected, proving that the new artifact check rejects the original defect.
- `npm run verify:isolation` passed: 373 dummy-secret assertions and 42 security
  tests across four files. No real provider credential was used for that gate.

The real Pi fixture tests verify a completed native write once, a continuation
beyond two simulated minutes, safe interruption, and an unexecuted later streamed
write. Separate broker tests cover cancellation, cleanup, and partial SSE data.

## Terminal and installed-runtime verification

The focused real PTY scenario passed 56 assertions in TUI and plain mode with
screen capture enabled. It runs ten successful B tool turns, a successful A
check-in, then an interrupted streamed B write. It verifies preserved file bytes,
the unexecuted partial write, safe attribution, and the displayed cause at
120x80, 80x24, and 40x12. The captured HTML was rendered and visually inspected.

Run that scenario alone with `python3 scripts/verify-terminal.py --provider-stream-only`
after building. Full terminal verification still uses `npm run verify:terminal`.
Screen capture requires `PI_TUI_SCREEN_CAPTURE=1` and Python `pyte` and `wcwidth`.

Two initial full PTY attempts reached the new assertions but failed during its
test teardown because history retained keyboard focus. The fixture now uses the
verifier's existing signal-based shutdown from history. The focused rerun passed,
including terminal restoration. No product keyboard behavior was changed.

The complete `npm run verify:terminal` rerun passed 1,215 PTY assertions with
screen capture enabled across both interfaces. Captures and the machine-readable
report are under `test-results/provider-stream/terminal/`.

Prepared installation `runtime-provider-stream-20261020T201946Z` passed its fresh
build, copied-artifact stream gate, and integrity verification across 27,766 files.
Its manifest binds the passing stream checks to broker SHA-256
`7ff3149c07bbb02a858d03029031ecb71709decaa62c47d95d212d43b3b07bf0`.
The installed timeout, attribution, renderer, and verification code matches the
source. The runtime remains outside the agent workspace.

The installed `bin/node scripts/verify-local-executor.mjs` passed with the saved,
already-loaded Qwen3.8 27B model and thinking off. It observed native write and
read calls and independently verified the file. No model setting was changed.

The installed `bin/node scripts/verify-local-stream.mjs` also passed. A successful
native write response lasted 303,379 milliseconds and emitted 3,610 streamed
updates. Both writes and all four reads returned correlated non-error results.
The verifier independently checked both files and exact equality of all 600
numbered lines. The final assistant response stopped normally within the
seven-minute verifier bound. Its JSON result is retained at
`test-results/provider-stream/live-report.json`. No live OpenAI inference was run
for this local-provider change.

Integrity verification passed again after live testing. The launcher was then
atomically switched to `runtime-provider-stream-20261020T201946Z`. Its previous
contents were backed up under the matching directory in
`~/.local/share/pi-dual/launcher-backups/`. `pdual` continues to invoke `pi-dual`.
Existing processes retain their old code until the operator quits and relaunches
them. Activation does not resume the failed workflow.

The activated launcher's `doctor` command passed the environment, OS isolation,
credential-helper, model-readiness, and configuration checks. Doctor made no live
OpenAI request. Saved model and browser defaults remained unchanged, and Qwen3.8
remained the loaded model. Dependency files and the existing coordinator and
compaction implementation were preserved byte-for-byte against the starting
working tree. Source changes remain uncommitted for review.
