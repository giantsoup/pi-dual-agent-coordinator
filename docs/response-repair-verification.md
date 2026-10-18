# Bounded response repair verification

Implemented 2026-10-18 in the existing working tree. Existing uncommitted work
and the calculator directories were preserved. No dependency, provider, or model
changes were added by this task.

## Behavior

Every required response has ten total attempts. The original response is attempt
1, and at most nine format corrections follow. Attempt 10 can succeed. There is
no attempt 11. This covers planning prose and blocks, Agent A handoffs and
reviews, cap finals, Agent B completion reports, and periodic process check-ins.

A response retains its identity across model runs, compaction, and rebinds.
Only a typed format error for that response is repairable. Nested exhaustion
propagates once. Provider errors, cancellation, the overall deadline, and cleanup
failures keep their separate handling.

Corrections include the latest sanitized error, the required schema, and exact
identifiers. They stay in the same role and conversation. Tools are disabled
before dispatch, hallucinated tool calls fail the response, and the old tool set
returns only after agent work and compaction drain. Original tasks and handoffs
are delivered once. A broken proposal cannot gain execution approval through
format repair.

B remains paused through A's check-in repairs. Only successful B turns count
toward the ten-turn check-in interval. Failed or missing tool results, rejected
completion reports, provider errors, aborted or truncated responses, and format
repairs do not advance it. A turn with several successful tools counts once.
Completion formatting does not run B's execution supervisor.

The TUI, plain interface, and `/status` show response attempts and validation
reasons. Ledger repairs use the current iteration. Ten invalid responses create
nine repair requests. Exhaustion stops automatic stages, preserves the draft and
history, and leaves the TUI open. Restart restores error and attempt metadata
without dispatching either agent. Existing repair ledger records still replay.

## Regression evidence

Before the implementation, the new check-in recovery regression failed because
an invalid check-in stopped the paused execution instead of being corrected.
The initial shared-policy suite could not load its not-yet-created helper.

The later successful-turn regression also failed before its fix: a failed tool
turn triggered A's check-in after only nine successful B turns.

The regressions now cover success on attempts 1, 2, and 10, exhaustion with no
eleventh response, malformed response categories and identifiers, valid prose,
blocked decisions, approval preservation, all protocol tool labels, one misuse
per submission, tool denial and restoration, original-task delivery once,
paused execution, nested exhaustion, deadlines, cancellation, compaction,
cleanup failures, replay, current iteration, and both terminal interfaces.

## Checks

- `npm run check`: strict TypeScript checks passed.
- `npm test`: 54 files and 359 tests passed.
- `npm run verify:isolation`: 284 isolation assertions and both security tests passed.
- `npm run verify:terminal`: 154 PTY assertions passed across TUI and plain interfaces.
- `npm run build`: TypeScript and the macOS native credential helper built successfully.
- `git diff --check`: passed.
- Hash comparison confirmed that every pre-existing untracked file remained unchanged.

Builds ran separately from tests and terminal checks that consume `dist`.
Terminal screen capture was disabled because optional `pyte` is unavailable;
PTY interaction, state, output, shutdown, and terminal-restoration checks ran.
All inference verification used deterministic fixture providers and dummy
credentials. No paid live inference or real-model response-quality test ran.

## Trusted runtime delivery

The verified build is installed in a new directory outside the editable
workspace:

`/Users/Taylor/.local/share/pi-dual/runtime-response-repair-20261018T200415Z`

The delivery manifest records SHA-256 hashes and modes for the installed
application, native helper, dependencies, and documentation. The launcher is
backed up at `/Users/Taylor/bin/pi-dual.backup-20261018T200415Z` and atomically refreshed at `/Users/Taylor/bin/pi-dual`.
Application build caches are cleared. Sessions, history, configuration,
credentials, and downloaded models are preserved.

Run `/Users/Taylor/bin/pi-dual repl` to start the updated TUI. Doctor runs through
the refreshed launcher. Its recorded result and artifact manifest are stored
alongside the installed snapshot.
