# Agent B reliability verification

Date: 2026-10-22. Candidate qualification is incomplete. Runtime activation is outside this work.

## Implemented behavior

Verification handoffs use the existing execution plan, acceptance criteria, and
constraints. Their stop condition can be recording a failed check. That outcome
does not authorize repair or satisfy an implementation requirement that tests pass.
Normal implementation work has no universal tool-call limit.

The execution supervisor correlates calls and results within the current handoff.
It passes bounded native observations to Agent A separately from completion claims.
The completed ledger record retains those observations and archive references.
Records without this metadata remain unknown on read-only reconstruction.

Pi 1.3 exposes shell `structuredContent` during execution but does not archive it
in `ToolResultMessage`. The role tool adapter validates the shell exit and
truncation flag before retaining them in `details.piDualShell`. Review and history
can therefore show an observed shell exit without parsing B's prose. A pipeline's
exit belongs to the shell command; it does not certify each child process.
Output excerpts are redacted and bounded. Missing counts and unsupported formats
remain unknown. There is no production test-output parser or semantic keyword gate.
Agent A must compare assertion identities and explanations against actual evidence.

Provider diagnostics contain request IDs, phases, elapsed times, tool counts,
byte and chunk counts, and fixed outcome categories. Runtime settlement adds the
first native-result timing and measured request budget. Operation settlement
retains the applicable deadline. Probe cancellation, broker inactivity, broker
absolute deadline, printed markup, and native tool failure remain separate facts.
These additions do not change retries, timeouts, model defaults, sandbox grants,
formatter isolation, or compaction policy.

## Portable artifacts

- `test/fixtures/agent-b-reliability/` preserves a passing check and the deliberately
  failing 30-test snapshot independently of `reading-list-test/`.
- `scripts/verify-agent-b-expectations.mjs` audits all five assertions in the two
  failing cases. Four expectations are wrong; two are hidden behind an earlier failure.
- `scripts/verify-agent-b-reliability.mjs` runs a 20-trial fixture or local-model
  matrix, with five paired trials per context variant. Task order matches across
  baseline and candidate. Every result is retained.
- `scripts/snapshot-agent-b-qa.mjs` copies tracked and untracked source into a new
  QA checkout, verifies SHA-256 hashes, and preserves starting diff and status.
- `scripts/verify-agent-b-workflow.mjs` runs the separate live workflow gate through
  the interactive service's normal `/approve` command. It requires a private,
  disposable workspace with its own available project-scoped Keychain credential.

The benchmark creates seed read/check history through real sandboxed tools with
fixture inference. Public Pi projections operate on in-memory copies. Seed results
are historical context, never current verification. No real session archive,
personal path, secret, or private reasoning is used as a portable fixture.

The benchmark checks a pinned TAP format only. It scores commands, native exits,
totals, observed assertion differences, completion validity, call/result correlation,
extra actions, unchanged file hashes, recovery, and drain separately. A correct
total cannot conceal a reversed assertion direction. Causal explanations still
require independent review. Reports retain only settled text, safe diagnostics,
and whether an interrupted generation made progress, not hidden reasoning.

## Repeat the checks

Use the scoped toolchain from `CONTRIBUTING.md`. Build before running the scripts.
Keep reports outside the source and trusted installations.

```sh
node scripts/verify-agent-b-expectations.mjs
node scripts/verify-agent-b-reliability.mjs --output /new/external/self-test --self-test
node scripts/verify-agent-b-reliability.mjs --runtime-root /qa/checkout --output /new/external/fixture-results
```

For a live comparison, prepare separate fresh baseline and candidate trusted
installations with `secure:install`, then verify both installation manifests.
Run the candidate's script with its bundled Node:

```sh
bin/node scripts/verify-agent-b-reliability.mjs --live --baseline-root /trusted/baseline --output /new/external/live-results
```

The saved executor must already be loaded. The script does not load, download,
or save models. It pins model, reasoning, input hashes, runtime hashes, prompts,
tool catalogs, order, and limits. The primary trials have a 90-second bound and
seven-turn cap. At most two additional 150-second diagnostic trials follow
primary timeouts with observed generation progress. Those outcomes never replace
primary failures. Unexpected actions, writes, unknown outcomes, or failed cleanup
stop the batch. Failed workspaces remain available for inspection.

The ten candidate trials need at least nine accepted results and at least four
of five in each context variant. These thresholds do not prove statistical
reliability. B-only success cannot qualify the full workflow.

For the separate live workflow gate:

```sh
bin/node scripts/verify-agent-b-workflow.mjs --output /new/external/workflow-results
```

If the report identifies missing Keychain access, use private setup from the
verified installation for the reported disposable workspace. Repeat with a new
output directory and `--workspace /reported/disposable/workspace`. Keep the
workspace marker and benchmark files. Never paste or copy credentials into reports.
The script exercises passing verification, failed verification, scoped repair,
and compaction followed by continuation and review. Each scenario has a five-minute
bound across planning and execution. Live Agent A explanations still need review.

## Evidence from this implementation

The initial unchanged-runtime fixture matrix completed 20 of 20 trials with
correlated native read/check results, accurate reports, unchanged files, and drain.
Classifier self-checks distinguish absent execution, failed checks, truncated
counts, pipeline masking, probe deadlines, and swapped assertion directions.
The assertion audit verifies all five assertions, including unreachable ones.

The first QA installation caught a development schema mismatch and failed its
build. That failure was retained. After correction, a repeated `npm ci` and strict
check passed. Focused tests passed 42 unit cases and 90 integration cases. The
integration evidence includes real Pi sessions and sandboxed tools with fixture
providers, failed-check stop behavior, a separately authorized repair, misleading
reports, masked pipeline exit, persisted reconstruction, read-only history, and
write-once/native-read continuation across compaction. It does not establish live
provider reliability.

Final source gates passed under Node 24.22.0 and npm 12.2.0: strict checking,
724 tests in 91 files, build, dependency validation across 249 source files,
373 dummy isolation assertions, 52 security tests, and 1,338 PTY assertions.
Rendered success, failed-check/native-exit history, and compaction cancellation
captures were inspected. Two PTY driver failures were retained and corrected:
shutdown while the inspector held focus, and applying TUI capture requirements
to plain mode. Neither required a product behavior change.

The final controlled fixture matrix passed 20 of 20 trials, using one identical
hashed seed history across cells. It observed 40 current native results, including
12 deliberately failed checks. Every workspace remained unchanged and drained.
The final classifier has nine self-checks, including command/report disagreement.

Fresh baseline and candidate trusted snapshots passed complete manifest checks
for 27,589 and 27,824 files respectively, plus their bound provider-stream checks.
The candidate passed live local write/read, separate formatting, and read
continuation with Qwen3.8 27B, thinking off. The tools-disabled GPT-6 Luna smoke
passed with high reasoning, and its real input-counting endpoint passed. These
checks establish readiness; none exercises live Agent A review of B's work.

The live comparison stopped after its first baseline trial. Instead of the
prescribed command, B executed:

```sh
node --test --test-reporter=tap passing.test.mjs; echo "EXIT_CODE=$?"
```

The native shell exit was 0 and the one test passed. Files stayed unchanged and
cleanup drained. The completion omitted the status-printing suffix when reporting
the command. The command deviation triggered the batch stop rule because such a
suffix can mask the upstream test exit. The remaining 19 primary trials, including
all ten candidate trials, were not run. No 150-second diagnostic trial was needed,
and no failure was replaced by a rerun.

This observation also exposed a classifier bug. Its command-accuracy score checked
B's report against the requested command without comparing the native call. That
score is now false for this trial. The original result remains intact externally,
with a separate classification audit. A meaningful self-check and a fresh 20-trial
fixture matrix verify the correction. The original live trial was not repeated.

The full live workflow verifier reported missing Keychain setup for its fresh
disposable workspace. All four scenarios remain unrun. The operator confirmed
that no existing disposable workspace has that setup. No credential was copied,
and no model-generated approval was used.

[Portable result summary](agent-b-reliability-results.json) retains every fixture
outcome and the observed live outcome without session archives, personal paths,
secrets, or private reasoning. Raw logs, trial results, classification audit, QA
manifests, and scoped diff are retained outside the checkout and linked in the
implementation delivery. Historical seed experiments remain separate evidence.

## Retention and activation decision

Production retention remains unchanged. The historical six-trial batches in the
plan are seed evidence. The fixture matrix proves mechanics, not a model benefit.
The live comparison stopped before any candidate trial, so its retention result is
inconclusive. Lifecycle coverage alone cannot justify a retention change.

This candidate is unqualified. The live comparison is incomplete, and full Agent A
workflow verification still needs a disposable workspace with private Keychain setup. Preparing a trusted snapshot does not activate it. Neither `pi-dual`
nor `pi-dua` is switched by these scripts.
