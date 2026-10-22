# Empty tool requests and unsupported completions

For the current separate formatter that preserves live execution tools, see
[response formatting isolation verification](response-formatting-isolation-verification.md).

Date: 2026-10-21, with verification continuing into 2026-10-22 UTC.

## Observed failure

The saved B session `01a161df-cd52-73d7-bac7-e326aadf33fe` uses the same
workspace as A, `/Users/Taylor/pi-dual-agent-coordinator`. B created the original
reading-list app with successful native writes and ran its original 18 tests.
Later revision handoffs produced only this assistant text, without native calls:

```text
<tool_call>
[
]
[END_TOOL_REQUEST]
```

The coordinator classified this as completion formatting, disabled tools, and
requested a completion block. B then claimed edits and passing tests that never
happened. The transcript records tool declarations restored for each new handoff,
followed by removal for format repair. A's inspection of unchanged files was
correct. There is no evidence of a separate write destination or lost file sync.
The local model's initial malformed output remains a provider/model behavior;
the coordinator's response to it caused the repeated false-completion loop.

## Correction

At stable `turn_end`, the execution supervisor recognizes this malformed text
and returns coordinator guidance through Pi's awaited steering path. Tools stay
enabled. Printed arguments are never parsed into executable requests. Recovery
allows two redirects per handoff and three across the workflow, records each
redirect before steering, and stops immediately on unknown native results.

Completion admission requires a correlated successful native result for changed
paths, and an observed native result for verification. Failed checks can still
reach A's review as failures. Both use only the current handoff. This check also
covers tools-disabled format repair. An honest blocker can report empty arrays
and explain the problem in `openQuestions`. This is a minimum evidence check;
A still needs to check the actual artifacts and each substantive claim.

The event bridge waits for submission settlement and returns the last eligible
assistant turn, preserving errors after steering. Ordinary format repair still
disables tools and retains its existing ten-response limit. Approval, model,
credential, sandbox, cancellation, and restart boundaries are unchanged.

The reading-list helpers now resolve default storage inside protected blocks.
`loadBooksResult()` distinguishes inaccessible storage from absent or malformed
data. The UI reports initial storage failure and continues to work in memory.

## Reproducible checks

- `npm test -- test/integration/execution-tool-recovery.test.ts` exercises real Pi sessions, fixture providers, and sandboxed tools. Before the fix it reproduced the disabled-tools path and false completion admission. It now covers native write/read recovery, bounded exhaustion, unsupported direct/repaired claims, format-only repair without write replay, and cancellation.
- `test/unit/execution-supervisor.test.ts` covers cross-handoff limits, inert printed arguments, failed/missing tool results, and honest no-action blockers.
- `test/unit/runtime-event-bridge.test.ts` covers final-turn selection and provider failure after an earlier text turn.
- `node --test reading-list-test/book-list.test.mjs` reproduces a throwing global storage getter and distinguishes read failure from malformed data.

Verification used scoped Node 24.22.0 and npm 12.2.0. Strict check and dependency
verification passed. The full suite passed all 654 tests across 90 files; the
reading-list suite passed all 20 tests. Browser checks used the actual app module
with throwing getters, failing storage methods, missing data, and malformed
JSON. Each remained usable; only unavailable storage showed an initial warning.
Normal browser checks covered adding, blank-title rejection, safe text rendering,
status/filter changes, reload persistence, and deletion.

`npm run verify:isolation` passed 373 dummy-credential assertions plus 52 security
tests. The terminal failure-reporting fixture exposed the distinction between
an observed failed check and absent execution evidence; admission preserves that
distinction without treating a failed tool as a successful workspace change.

Fixture verification does not establish live model reliability. Installed-runtime,
isolation, terminal, and live local-provider results are separate gates.

`PI_TUI_SCREEN_CAPTURE=1 PYTHONPATH=/tmp/pi-terminal-screen-tools npm run verify:terminal`
passed 1,215 assertions across TUI and plain mode. Fresh captured terminal output
was visually inspected. Builds ran sequentially.

The trusted snapshot is
`/Users/Taylor/.local/share/pi-dual/runtime-execution-recovery-20261022T051122Z`.
Installation integrity verified 27,828 files. Its bounded live local executor
check passed with `lm-studio/qwen/qwen3.8-27b`, saved thinking `off`, observed
native `write` and `read` calls, and verified file contents in a disposable
workspace. This is live local tool evidence; the malformed-output recovery path
is proven by the real Pi fixture tests. No new live OpenAI or full live A/B
workflow was run.

The launcher retains its existing workspace behavior. Existing processes must
exit with `/quit` and relaunch to load the new runtime. Use `/new B` to clear the
old fabricated completion history while keeping A's context, then ask A to
reinspect `reading-list-test/` and finish any remaining review. New execution
still requires the operator's `/approve`. No saved provider/model settings,
existing archives, unrelated project files, commits, or remote branches changed.

## Follow-up: recover a rejected no-execution completion

A completion claiming changes or verification with no native results now uses
the bounded execution recovery path before the handoff settles. Previously this
case was detected but immediately blocked. Printed tool markup and unsupported
completions share the existing redirect limits, so alternating failure types
cannot extend recovery indefinitely. Telemetry records `printed_tool_markup` or
`unsupported_completion` before steering B. Rejected responses do not advance the
successful-turn counter or enter A's completion review.

The new real Pi regressions first failed with `blocked` instead of `completed`.
They now cover a direct unsupported completion, empty tool markup followed by a
false completion, and a second handoff after successful execution and format
repair. The last case verifies restored tools, fresh per-handoff evidence, actual
revised file contents, and exactly one write per handoff. Format-only repair
still cannot restart execution; its unsupported claims remain terminal failures.

Follow-up verification passed all 657 tests across 90 files, including nine real
Pi recovery cases, plus strict TypeScript checking, the native build, dependency
verification, and whitespace checks. No sandbox, credential, model selection,
or terminal presentation code changed in this follow-up.

The follow-up trusted runtime is
`/Users/Taylor/.local/share/pi-dual/runtime-false-completion-recovery-20261022T051924Z`.
Its source, compiled supervisor, and regression test bytes match the checked
workspace. Installation integrity passed for 27,832 files before and after the
live local executor check. Qwen again called native `write` and `read` tools and
produced the verified file. The failure sequences themselves were injected by
fixture providers through real Pi sessions. Both launchers were switched with a
backup; saved configuration remained unchanged. Existing sessions need relaunch.

## Follow-up: bracketed tool calls during revision

The screenshot's later revision printed
`[TOOL_CALL]{"name":"read","path":"reading-list-test/README.md"}[END_TOOL_CALL]`.
The detector recognized XML `<tool_call>` and `[END_TOOL_REQUEST]` but missed
these bracketed CALL markers. The coordinator therefore requested format-only
repair and disabled tools before B could inspect or finish the approved work.

The detector now recognizes bracketed CALL and REQUEST opening or closing
markers, case-insensitively, through the same bounded execution recovery path.
Detection still applies only to invalid completions. Marker text inside a valid
completion remains ordinary text. No printed arguments are parsed or executed.

Before the fix, the screenshot regression returned `blocked` instead of
`completed`; four focused marker cases also failed to produce recovery guidance.
Afterward, the focused supervisor, real Pi recovery, response-repair lifecycle,
and event-bridge suites passed all 61 tests. The screenshot case verifies a
later handoff after format repair, enabled tools throughout recovery, fresh
native write/read evidence, actual revised bytes, two reviews, and one write
per handoff. Repetition and cancellation are covered for both marker formats.

Fresh verification on 2026-10-22 used Node 24.22.0 and npm 12.2.0. `npm ci`,
strict checking, dependency verification, and `git diff --check` passed. The
full suite passed all 696 tests across 90 files. `npm run verify:isolation`
rebuilt TypeScript and the native helper, then passed 373 dummy-credential
assertions and all 52 security tests. No terminal presentation code changed;
the standalone PTY verifier was not rerun for this detector correction.

The new trusted snapshot is `/Users/Taylor/.local/share/pi-dual/runtime-bracketed-tool-recovery-20261022T165914Z`.
Installation integrity passed for all 27,789 files before and after the live
check attempt. Its source supervisor and compiled detector match the verified
checkout. Both `/Users/Taylor/bin/pi-dual` and `/Users/Taylor/bin/pi-dua` now
point to it, with the prior scripts backed up alongside them. Shell syntax and
the launcher's credential-free `--help` check passed. Saved coordinator
settings remained byte-for-byte unchanged.

Live inference was unavailable. The bounded local executor verifier returned
`fetch failed` before inference; the loopback server had no listener on port
1234, and `lms server status` reported that the server was not running.
Loaded-model inspection did not settle and was terminated. No model was loaded
or downloaded. The exact malformed-output recovery is proven by fixture
providers through real Pi sessions; no new live local or OpenAI inference
success is claimed.

Existing coordinator processes retain the old code. Exit with `/quit` and
relaunch `pi-dual` or `pi-dua`. After starting LM Studio with the saved model
loaded, use `/new B` to clear the old repair conversation, ask A to reinspect
the unfinished task, and approve the new execution plan with `/approve`.
