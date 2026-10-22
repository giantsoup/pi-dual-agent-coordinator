# Agent B reliability plan

Date: 2026-10-22.
Status: phases 1-4 implemented and fixture-verified. Live qualification is incomplete; retention remains unchanged. See [current verification](agent-b-reliability-verification.md). No activation occurred.

## Recommended sequence

First make verification handoffs precise about scope, failure handling, and when
to stop. Then give Agent A independently observed verification facts to review.
Add diagnostics for unfinished generations before changing timeout policy.
Treat recent-history retention as a separate candidate that must earn its place
through comparison tests.

The aim is to reduce failed execution and prevent inaccurate success claims.
A valid completion block alone is not evidence that the task succeeded.

## Evidence behind the plan

The latest investigated workflow stopped after Agent B printed tool requests
and supposed results as assistant text. The coordinator correctly refused to
execute those strings and exhausted its bounded recovery budget. LM Studio
request logs showed that all 14 tools were still declared. Tools were available.

Both transitions into printed calls in that session followed compaction that
removed all native call/result history. This makes compaction a candidate
contributor, but does not prove that compaction caused the model behavior.

Two local experiments used the saved Qwen3.8 27B model with thinking set to `off`.
Each experiment ran three trials per context variant with a 90-second trial
deadline and the same model-turn cap.

- Without an explicit two-call stop rule, summary-only context completed 1 of
  3 trials. Context retaining two genuine native tool turns completed 2 of 3.
  One summary-only response printed tool markup before recovery restored native
  execution.
- With the explicit stop rule, summary-only context completed 2 of 3 trials.
  Retained history completed 3 of 3. Every completed trial made exactly one
  native read and one native test call, then returned a valid completion.
- The remaining stop-rule trial was still generating when the probe cancelled
  it at 90 seconds. No native call completed in that trial. Its unfinished
  output does not establish a tool-protocol failure.
- Completed trials correctly reported 30 tests, 28 passing and 2 failing.
  Some explanations were still wrong. One report mislabeled an ascending
  assertion as descending. Another incorrectly blamed sort stability.

These were separate experiment batches with only three trials per variant.
Sampling and prompt-cache effects remain possible. They used seven native
tools, disposable copies, and B-only continuations. They did not reproduce the
full Agent A review loop or the original browser and external MCP catalog.

Additional checks established the following facts:

- A real Pi fixture session wrote once, compacted, and performed a native read
  of the same 40,022 bytes. Compaction does not inherently disable execution.
- Five focused suites passed all 68 tests. Strict TypeScript checking passed.
- The trusted installation passed integrity verification for 27,794 files.
- Local tokenization measured 12,127 input tokens for the compacted request and
  14,386 with two retained native turns. Both fit the 32,768-token soft target.
  This proves that retention fits this example, not that every tool result fits.
- The B sandbox independently reproduced child-process `kill EPERM` and
  `/private` metadata denials. Coordinator tests running inside B's sandbox are
  a separate verification-environment problem.

The historical verification above describes the investigated snapshot. Repeat
the relevant checks against each implementation candidate.

## Preserve these boundaries

Follow the [security model](security-model.md),
[review loop](review-loop.md), and
[handoff state machine](handoff-state-machine.md).

- Keep Agent A responsible for planning and review. Keep Agent B on the
  validated local provider. Only operator `/approve` starts workflow execution.
- Count correlated native calls and results as execution evidence. Never parse
  printed tool arguments into actions or replay an unknown native outcome.
- Preserve the two redirects per handoff, three per workflow, and ten total
  response-format attempts. Do not increase limits to hide a regression.
- Keep report formatting in its separate tool-free agent. It must not rerun
  execution, remove live tools, or pollute the execution context.
- Preserve archives, cancellation, abort-and-drain ownership, and completed
  writes. Restart must not resume unfinished execution automatically.
- Use verified trusted installations for credential-backed work. Use dummy
  credentials for fixture and isolation tests. Keep secrets and private
  reasoning out of new reports and diagnostics.
- Keep the 90-second experiment limit separate from production policy. The
  broker currently has a 120-second inactivity limit and a 30-minute absolute
  limit. This plan does not propose increasing those limits.

## Phase 1: preserve a repeatable benchmark

Build a small verification script outside the live workflow before changing
behavior. A proposed name is `scripts/verify-agent-b-reliability.mjs`; the
implementation now includes this script.

The script must pin the input files, prompt, model, reasoning setting, runtime
hashes, active tools, trial order, deadlines, and comparison variant. Record
every trial, including timeouts and failed recovery. Never replace a failed
trial with a favorable rerun.

Create portable minimal fixtures rather than committing real session archives
or personal paths. Generate native seed history through real fixture tools.
Keep historical seed evidence distinct from results observed in the current
handoff. Use public Pi projection APIs and in-memory session copies.

Keep two benchmark tasks:

1. A passing check that must be reported accurately and terminated promptly.
2. A deliberately failing check that must be reported accurately without repair.

The current reading-list snapshot is useful for the second task. Separately
review corrections to the app's incorrect test expectations. Audit all
assertions in the two failing cases, including assertions hidden behind the
first failure. Preserve the failing benchmark when correcting app tests.

Measure native call/result correlation, exact command execution and exit code,
completion validity, factual accuracy, extra actions, printed markup, recovery,
elapsed time, file hashes, and cleanup. Capture the last settled response and
whether an aborted generation had partial progress. Do not store reasoning or
execute partial arguments.

Exit criterion: the script reproduces the observed distinctions and can verify
its own result classification. It must not count a failed test as absent
execution or count an accurate test total as a correct diagnosis.

## Phase 2: implement precise handoff and reporting guidance

Start with the existing handoff fields. Avoid adding a protocol field or
inferring execution permissions from prose.

Review these owners together:

- [Role guidance](../src/app/trust-policy.ts).
- [Handoff rendering](../src/handoff/render-handoff-message.ts).
- [Review rendering](../src/workflow/render-review-message.ts).

Define verification-only acceptance criteria as recording the observed result.
For such a task, a nonzero test exit ends the requested verification step. It
does not authorize debugging or repair, and it does not satisfy an overall
implementation requirement that tests pass. Agent A decides the next action.
Agent A may approve completion of an accurate diagnostic task while explicitly
reporting failed checks. That decision must not claim that the application is
fixed or that those checks passed.

Use this pattern for the measured diagnostic task:

```text
Read the specified test file once. Run the specified test command once.
Report the observed command, exit code, totals, and assertion differences.
After that command returns, emit pi-completion and stop, including on failure.
Do not inspect other files, rerun checks, diagnose, or repair in this handoff.
Use changedPaths: [] and leave unverified causes unresolved.
```

Do not impose a universal two-tool-call limit. A repair task may need many
actions. Define a concrete end state and a bounded verification phase for each
task. Keep generic guidance short and remove conflicting instructions.

In particular, the current renderer asks every completion summary to describe
code changes. Update that guidance to support observed verification results
when no files changed. Do not encourage B to invent changes or causal analysis
to fill a generic completion template.

Add meaningful coverage in
[handoff rendering tests](../test/unit/render-handoff-message.test.ts),
[review rendering tests](../test/unit/render-review-message.test.ts), and
[real Pi recovery tests](../test/integration/execution-tool-recovery.test.ts).
The integration case must execute an actual failing check, report it, and stop
without writes or another command. Cover a passing check and an explicitly
authorized repair separately.

Exit criterion: fixture execution follows the intended scope, and a valid B
report of failed verification cannot become an unsupported final approval.

## Phase 3: ground verification reports in native facts

The current evidence gate proves that some native results exist in the handoff.
It does not certify every completion claim. Keep that distinction visible.

Inspect the evidence already owned by
[execution supervision](../src/coordinator/execution-supervisor.ts) and
[runtime event binding](../src/coordinator/bind-runtime-events.ts). Add only the
smallest missing path needed to make observed verification facts available to
Agent A's review. Keep workflow decisions out of TUI code.

Use validated native fields where present: tool call ID, tool name, result
status, and structured exit code. Preserve references to the archived result
for inspection. Bound and redact any displayed output. Unknown, truncated, or
unsupported output must remain explicit.

Reconstruct observations from persisted records when available. Treat missing
historical metadata as unknown. Test read-only history and replay compatibility;
do not backfill evidence by rerunning actions or rewriting old sessions.

Do not add a universal test-output parser. If a supported output format exposes
totals, validate that format and preserve its source. Never derive test counts
or execution facts from B's prose. Keep diagnosis separate from observations.

Test misleading cases: a tool succeeds while the test fails, the shell masks a
test exit through a pipeline, counts are missing or truncated, a report swaps
ascending and descending, and a report claims success without a matching
result. Avoid keyword-based rejection of legitimate explanations.

For factual contradictions, use read-only review or isolated report correction.
Do not rerun tools solely to fix wording. Do not require arbitrary semantic
proof from the formatter or pretend a schema can validate a root cause.

Exit criterion: the reviewer can distinguish native facts from model claims,
and known contradictory reports do not receive unsupported approval.

## Phase 4: distinguish unfinished generation from execution failure

Extend the benchmark's diagnostics before changing timeouts. Record request
start, first upstream body chunk, first completed native call, final settlement,
the applicable deadline, and cancellation completion. Record the measured
request budget and active tool count. Distinguish a completed text response
containing printed markup from an unfinished generation.

Use structured telemetry under the existing correlation IDs. Capture counters,
timings, and safe categories rather than prompts, reasoning, tool arguments, or
raw upstream errors. Preserve the existing broker cancellation and SSE behavior.

If another trial is still producing useful output at 90 seconds, run at most
two explicitly labeled 150-second diagnostic trials with the same input.
Compare the outcomes without changing production defaults or enabling retries.
If there is no progress, investigate provider/model behavior instead of adding
execution recovery attempts. Do not treat a probe cancellation as a broker
inactivity timeout.

Exit criterion: each timeout has an evidence-backed category, or is explicitly
unknown. Keep model and reasoning comparisons as later experiments with one
variable changed at a time. Do not load another model, save defaults, or add a
cloud fallback as part of this work.

## Phase 5: evaluate bounded history retention conditionally

Proceed only after the handoff and reporting changes have a stable benchmark.
Compare those changes with and without recent native history. Otherwise the
effects of prompting and compaction remain mixed.

The relevant owners are
[runtime construction](../src/runtime/create-role-runtime.ts) and
[compaction](../src/runtime/compaction.ts). Preserve complete call/result groups
when they fit a defined budget. Never retain an orphan call or orphan result.
Recount the final serialized request, including tools and pending instructions.

Preserve the latest response and original archive. Do not restore the earlier
omission bug to retain a tail. Handle oversized tool results, images, reasoning
payloads, and summaries without exceeding admission or replaying a write.
If complete recent groups do not fit, compact safely and report that decision.

Promote the standalone write-once, compact, native-read check into
[compaction integration tests](../test/integration/compaction.test.ts).
Add check-in, cancellation, formatter isolation, persisted reload, and unknown
result cases where the change affects those paths.

Exit criterion: retention shows a repeatable benefit against the same prompt
candidate, passes budget and lifecycle checks, and introduces no replay or
archive regression. Leave retention unchanged if the comparison is inconclusive.

## Qualify each candidate before activation

Use a separate QA checkout or snapshot containing the exact intended source,
including required untracked files. This checkout has substantial unrelated
changes. A worktree created from `main` alone will not include those edits.
Record the starting diff and compare copied source bytes. Preserve unrelated
work and run build-dependent checks sequentially.

Select Node 24.22.0 and npm 12.2.0 as specified in
[CONTRIBUTING.md](../CONTRIBUTING.md). Install a new QA checkout with `npm ci`.
Use the commands in [package.json](../package.json):

```sh
npm run check
npm test -- test/unit/render-handoff-message.test.ts test/unit/render-review-message.test.ts test/unit/execution-supervisor.test.ts
npm test -- test/integration/execution-tool-recovery.test.ts test/integration/compaction.test.ts test/integration/execution-check-in.test.ts test/integration/response-repair-lifecycle.test.ts test/integration/response-repair-pi.test.ts test/integration/role-context-policy.test.ts test/integration/context-admission.test.ts
npm test
npm run build
npm run verify:dependencies
npm run verify:isolation
npm run verify:terminal
git diff --check
```

Stop qualification on a failed required check. Diagnose the failure before
continuing; do not waive it because an earlier snapshot passed.

Keep the fork pool and two-worker cap. Inspect the terminal's rendered success,
failed-check, recovery, cancellation, and history interactions. Separate that
PTY evidence from fixture and live-provider results.

Run coordinator integration and isolation tests from the QA environment,
outside B's nested sandbox. Keep application-level sandboxed checks scoped to
the target app. Preserve test exit codes, and do not use `tail` or `grep` pipeline
success as evidence that the upstream test passed. A denied operation remains
an environment limitation, not proof that every failing test is pre-existing.
No sandbox expansion is proposed here.

Follow [secure setup](secure-setup.md) to verify the new trusted snapshot first.
Inside that snapshot, run the existing bounded local check with
`bin/node scripts/verify-local-executor.mjs --with-format-repair`. This checks
local readiness and formatter isolation; it does not prove compaction recovery.

For live qualification, run 20 bounded trials: five baseline and five candidate
trials for each context variant. Interleave order, pin the runtime and inputs,
and retain all outcomes. At 90 seconds per trial, inference is bounded to
30 minutes, plus preparation and cleanup. Include passing and deliberately
failing checks in the recorded task set. Match the task sequence in paired
baseline and candidate cells.

Proposed acceptance targets apply to the ten candidate trials:

- At least 9 of 10 complete within the bound, with at least 4 of 5 in each
  context variant. Compare against baseline; do not claim statistical certainty.
- No unexpected writes, action replay, or accepted fabricated execution facts.
- Correct observed commands, exit codes, totals, and assertion identities.
  Score diagnosis accuracy separately from schema validity and termination.
- Every failure is retained with its category, cleanup result, and preserved
  changes. Stop the candidate batch on an unexpected action or unknown outcome.

Then run bounded full workflow scenarios in disposable workspaces from a fresh
verified trusted installation. Exercise a passing verification task, a failing
verification report, a scoped repair followed by verification, and a continuation
through compaction and review. Use the normal operator `/approve` boundary.
Record a five-minute operation deadline for each of the four scenarios. If a
scenario needs more time, review its evidence before changing the bound.
Keep cancellation and format repair covered by real Pi fixtures and terminal
checks. Record actual Agent A review and provider evidence separately.

Do not activate a candidate that passes only the B-only benchmark. Document any
missing prerequisite or unrun gate. Preparing a snapshot and switching the
launcher are separate steps. Activation is outside this documentation request.
For a later rollout, verify installation hashes, preserve the previous launcher,
and require existing sessions to relaunch. Rollback must not resume unfinished
work or silently rewrite historical sessions.

## Proposed review decision

Start with phases 1 and 2: the repeatable benchmark and precise verification
handoffs. Add factual review support and timeout diagnostics next. Reassess
compaction retention only after those measurements are available.

Keep corrections to the reading-list app tests separately reviewable. Do not
mix app repairs, sandbox permissions, model defaults, timeout increases, and
compaction policy into one patch.

## Local investigation artifacts

The measured results are summarized above so this plan remains useful if
temporary files disappear. The following local artifacts contain the raw trial
classifications and repeatable probes. They are supporting evidence, not
portable repository prerequisites.

- First comparison: `/var/folders/7d/h5dz__nj3c34c0qjw6rx3v800000gq/T/pi-b-compaction-verification-iyhmcoot/verification-audit.json`.
- Stop-rule comparison: `/var/folders/7d/h5dz__nj3c34c0qjw6rx3v800000gq/T/pi-b-stop-rule-verification-6958azzr/verification-audit.json`.
- Both directories contain `probe.mjs`. The first also contains
  `fixture-probe.mjs`; the second contains `expectation-check.json` and
  `timeout-server-evidence.json`.
- Verified runtime used for the trials:
  `/Users/Taylor/.local/share/pi-dual/runtime-independent-formatter-20261022T175002Z`.

Related implementation context is recorded in
[response formatting isolation verification](response-formatting-isolation-verification.md)
and [execution tool recovery verification](execution-tool-recovery-verification.md).
Historical reports do not replace checks against the next candidate.
