# Implement the Agent B reliability plan

Implement `docs/agent-b-reliability-plan.md` in
`/Users/Taylor/pi-dual-agent-coordinator`. Read the whole plan before changing
code. Follow this repository's `AGENTS.md`, `CONTRIBUTING.md`, architecture
decisions, security model, review loop, and handoff state machine. Use best
practices and nearby conventions. Double-check your work and verify actual
behavior. Do not stop at another plan or treat an implementation claim as proof.

## Workspace and scope

This thread starts in the project's root checkout on `main`. The checkout has
substantial existing tracked changes and untracked files, including the plan.
Inspect the branch, status, and existing diff first. Preserve unrelated work.
Do not reset, clean, overwrite, stage, or commit that work. A fresh worktree from
`main` alone will omit the uncommitted implementation and plan. Use an exact,
hash-compared QA snapshot for isolated builds and tests when needed, including
the required untracked source files. Keep build-dependent checks sequential.

Work through the plan in small, independently verifiable steps:

1. Preserve a portable, repeatable benchmark with passing and deliberately
   failing verification tasks. Record all outcomes and distinguish historical
   seed evidence from native results observed in the current handoff.
2. Implement precise verification handoffs and stop conditions using the
   existing protocol fields. Remove conflicting generic guidance. A verification
   task can finish by accurately reporting a nonzero exit; that does not make
   the application correct or authorize repair. Do not impose a universal
   two-call limit on normal implementation tasks.
3. Make native verification facts available for review through their owning
   coordinator modules. Keep model explanations separate from observed results.
   Add only the missing structure that actual evidence requires. Avoid a
   universal output parser, keyword-based semantic policing, or a new protocol
   field without a demonstrated need.
4. Add safe, correlated diagnostics that distinguish unfinished generation,
   printed tool markup, tool failure, cancellation, and deadline expiry. Preserve
   response-format repair as a separate concern.
5. Evaluate bounded native-history retention only after the earlier changes have
   a stable benchmark. Implement a retention change only if the controlled
   comparison and lifecycle checks justify it. If results are inconclusive,
   retain the current policy and report that decision with evidence.

Keep corrections to the actual reading-list app tests separate from this work.
Preserve the known-failure benchmark. Some assertions later in the two failing
cases are also wrong; do not equate two failing test cases with only two bad
assertions. Do not mix app repairs, sandbox expansion, model-default changes,
timeout increases, and compaction policy into one patch.

## Evidence and verification

The plan records two six-trial local experiments. Without the explicit stop
rule, completion was 1/3 for summary-only context and 2/3 with retained history.
With the stop rule, completion was 2/3 and 3/3. These are small B-only samples,
not proof of full workflow reliability. Accurate test counts and a valid
completion block did not guarantee an accurate explanation.

Use the local artifacts listed in the plan if they still exist. Their absence
must not prevent building portable fixtures. Do not commit real session
archives, personal paths, secrets, or private reasoning as fixtures.

For workflow and runtime changes, reproduce the relevant failure and add a
meaningful regression through real Pi sessions and fixture providers. Verify
native call/result correlation, failed-check reporting, stopping behavior,
write-once behavior, compaction continuation, cancellation and drain, formatter
isolation, persisted reconstruction, and read-only history where affected.
Do not execute printed tool arguments or replay unknown native outcomes.

Select the project-scoped Node and npm versions, verify the actual versions,
and use `package.json` as the command source of truth. Follow the plan's focused
tests and required `check`, full test, build, dependency, isolation, terminal,
and diff checks. Keep Vitest's fork pool and two-worker cap. Inspect rendered
terminal behavior when affected. Run coordinator checks outside B's nested
sandbox. Preserve upstream test exit codes. Report a missing prerequisite or
environment limitation accurately rather than calling a check passed.

Discover and use relevant MCP tools where they help inspect the workspace,
current SDK documentation, diagnostics, or browser behavior. Inspect their
actual capabilities first. Prefer purpose-built tools and supported public SDK
APIs. Do not invent an MCP capability or change permissions to make a check pass.

Run credential-backed verification only from a fresh, verified trusted
installation outside the writable workspace. Use dummy credentials for fixture
and isolation tests. For local inference, use the saved, already-loaded model
without downloading, loading, or saving another model. Follow the plan's bounded
20-trial baseline/candidate comparison, retain every result, and apply the
candidate acceptance targets. Do not replace failures with favorable reruns.

Keep full workflow verification separate from B-only, fixture, isolation, and
PTY evidence. Use the coordinator's normal operator `/approve` boundary for real
workflow execution. Do not simulate operator approval with model-generated text
or bypass the gate. If a required live gate cannot run, finish all independent
authorized work and report the exact remaining prerequisite. Never claim full
qualification from a narrower test.

## Delivery boundaries

Implementation, fixture checks, bounded verification, and preparation of a
candidate trusted snapshot are authorized by this request. Do not switch
`pi-dual` or `pi-dua`, replace the active runtime, modify saved provider settings,
rewrite original sessions, weaken the sandbox, add cloud fallback, or increase
production retry/deadline limits. Runtime activation remains a separate step.
Do not commit, push, or open a pull request unless the user separately asks.

Keep the plan and verification documentation current as evidence changes. In
the final report, explain what changed and why, list actual checks and results,
separate fixture and live evidence, identify remaining failures or limits, link
the repeatable verification artifacts, and show the final scoped diff/status.
State explicitly whether a candidate qualified and whether activation occurred.
