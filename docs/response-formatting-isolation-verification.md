# Separate response formatting verification

Date: 2026-10-22. This replaces the live-session tool disabling described in the
original [response repair report](response-repair-verification.md).

## Behavior

Normal role sessions retain their authorized tools during execution recovery and
report formatting. The runtime no longer empties or restores their active tool
registries. B responses that end with unfinished prose, printed tool markup, or
unsupported completion claims use bounded execution recovery with tools enabled.
The existing two-per-handoff and three-per-workflow redirect limits still apply.
Unknown native outcomes still stop without replaying a possible action.

Malformed fenced completion reports after native execution, and other workflow
format corrections, run in a fresh Pi Agent with no executable tools. It uses
the same role's selected model and validated broker stream. Source conversation
records are inert text, private reasoning is omitted, tool images become explicit
notices, and native calls are rejected before execution. Each formatting job
permits one request; the shared response policy still permits ten total attempts
including the original response. Provider and admission failures remain separate
from repairable output-format errors.

The source conversation is unchanged. Formatter messages persist as custom
archive records and become messages only in read-only request-history projection.
They are excluded from model replay. Formatting does not compact the original
session or update its compaction budget. Ordinary formatter failures drain without
aborting idle execution resources. Operator cancellation still aborts and drains
the owned job and cleans up role resources.

No approval, sandbox, credential, model-selection, or cloud-fallback boundary
changed. B's formatter remains on B's validated local model. The compaction
summarizer and authentication smoke check remain separate tool-free operations.

## Regression evidence

Before the change, the new real Pi lifecycle cases observed an empty active tool
list while a repair request was pending. Afterward they verify an unchanged live
registry and conversation during formatting, successful settlement, cancellation,
provider failure, attempted native writes, and serialized-budget rejection. A
subsequent normal prompt still executes native tools. Saved archive inspection
shows formatted reports while reconstructed execution context excludes them.

The workflow regressions cover later handoffs after formatting, plain unfinished
prose without recognized markup, unsupported claims, shared recovery limits,
blocked decisions, exactly one successful write, and successful report correction
on attempts 2 and 10. Repeated formatting cannot restart execution supervision.

## Checks

Verification used scoped Node 24.22.0 and npm 12.2.0.

- `npm ci`: passed with the normal TypeScript/native prepare build.
- `npm run check`: passed with strict settings unchanged.
- `npm run verify:dependencies`: passed for 240 source files; no dependency or lockfile changes.
- `npm test`: all 705 tests across 90 files passed again in the isolated QA worktree.
- A final focused run of the three real Pi repair/recovery suites passed all 23 tests.
- `npm run verify:isolation`: fresh build, 373 dummy-credential assertions, and all 52 security tests passed.
- `node --check scripts/verify-local-executor.mjs` and `git diff --check`: passed.

The live local executor verifier now accepts `--with-format-repair`. From a
verified trusted installation, it checks native write/read execution, separate
completion formatting, unchanged source context and tools, a subsequent native
read, and exactly one write. It uses the saved already-loaded model, never loads
or downloads a model, and retains its two-minute total bound. Live-provider,
compiled terminal, and installation results are recorded separately below.

## Verification environment

Concurrent builds in the working checkout replaced `dist` during an initial
terminal run, causing a missing compiled module. Final verification therefore
uses a detached QA worktree with separately installed dependencies and compiled
output. Copied source bytes were compared with the working checkout. Concurrent
presentation edits and their five transcript tests were preserved in that copy.

The activity UI scenario also reached its artificial 15-second workflow deadline.
It performs fourteen native tool calls, a check-in, reviews, and repeated resize
captures; an isolated successful run took about thirteen seconds. That scenario
now explicitly selects a 30-second workflow budget for capture overhead. Its
assertions, existing wait limits, production defaults, and dedicated 200-millisecond
deadline regression are unchanged.

Final compiled terminal verification passed all 1,281 assertions in TUI and
plain mode with screen capture enabled. Snapshot capture now waits for the
existing footer controls to repaint after resize, using the existing bounded
wait, before applying the unchanged visibility assertion. Fresh repair,
continuation, final approval, history, and cancellation screens were inspected.
The evidence directory is `/tmp/pi-independent-formatter-qa-terminal-verified`.

## Installation and live local verification

The trusted runtime is `/Users/Taylor/.local/share/pi-dual/runtime-independent-formatter-20261022T175002Z`.
Its source and compiled JavaScript were compared with the tested QA copy and
the working source. Installation integrity passed for all 27,794 files before
and after the live check. Both `pi-dual` and `pi-dua` launchers now point to it;
their prior scripts are backed up alongside them. Shell syntax and both
credential-free `--help` invocations passed. Saved coordinator settings remained
byte-for-byte unchanged.

From that verified installation,
`bin/node scripts/verify-local-executor.mjs --with-format-repair` passed with
`lm-studio/qwen/qwen3.8-27b` and the saved thinking setting `off`. Observed
native calls were exactly `write`, `read`, `read`. The file bytes matched
`LOCAL_EXECUTOR_OK`, the separate formatter produced a valid completion, the
source conversation and registry stayed unchanged during formatting, and the
subsequent normal prompt invoked the native read tool. There was exactly one
write. No model was loaded or downloaded, and no saved setting changed.

These are separate fixture, isolation, PTY, installed-artifact, and live local
gates. No new live OpenAI request or full live A/B workflow was run. Existing
processes must exit with `/quit` and relaunch to load the update. Use `/new B`
to clear old repair conversation context, request a fresh plan, and use
`/approve` before execution. Existing archives and unrelated working changes
were preserved. No commit or push was made.
