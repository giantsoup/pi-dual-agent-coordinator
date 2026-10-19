# Agent A intervention for Agent B tool-call failures

Status: implementation plan, not implemented.

Prepared on 2026-10-18 against commit `f7ac2b11260a81aa9f3e8d6ffcca6ec6360b1ecc` and the installed Pi 1.3.0 packages. Recheck these contracts before implementation if the source or dependency versions change.

## Outcome

When B attempts a tool call but returns tool-call markup as ordinary assistant text, the coordinator must pause execution, give A verified failure evidence, obtain specific corrective instructions, and steer B within the existing approved handoff. B must retain its authorized tools during that retry. Recovery succeeds only when runtime events confirm an actual successful tool invocation.

Keep completion-format repair separate. Formatting an invalid completion report must remain unable to execute tools or repeat writes. A supervises and B executes; neither role gains permissions through recovery.

## Evidence and current gaps

The homepage workflow `24458718-7258-4893-873f-a0f492bf1773` demonstrated the failure:

- B had `read`, `bash`, `edit`, `write`, and `mcp` enabled on each of three execution attempts.
- B returned `<tool_call><function=read>…` as text with a normal `stop`. There were zero B tool-execution events.
- Each attempt entered generic completion-format repair, which intentionally removed B's tools.
- A received B's repaired self-report, including unsupported claims that reads had run. A requested implementation twice without seeing the actual tool-call failure.
- The review cap ended the workflow without changes or verification.

This proves the failure observed at the application boundary. It does not establish whether the model, LM Studio's template/parser, or another provider integration detail produced the malformed response.

Relevant contracts:

- [Execution supervisor](../src/coordinator/execution-supervisor.ts): failed turns are logged and returned without intervention. Periodic supervision runs after ten successful turns.
- [Response repair](../src/coordinator/response-repair.ts): retries correct machine-block formatting with tools disabled.
- [Review prompt](../src/workflow/render-review-message.ts): supplies B's completion claims without coordinator-owned execution facts. [Cap prompt](../src/workflow/render-final-message.ts) also needs the latest evidence.
- [Check-in schema](../src/workflow/workflow-schema.ts): periodic check-ins require a positive turn count. Failure recovery must work at zero successful turns.
- [Managed session](../src/runtime/managed-session.ts): awaits the core `turn_end` listener and queues returned steering before the next model request.
- [Event bridge](../src/coordinator/bind-runtime-events.ts): waits for the managed prompt, but its result promise is resolved by the first eligible text-only turn. Steering after that turn can leave the caller with the original malformed response even if a later response succeeds.
- [Architecture decisions](architecture-decisions.md): the coordinator owns cross-runtime state, rendered messages, lifecycle, and persistence. Restart restores history without automatically resuming work.

LM Studio documents structured calls in the response's `tool_calls` field. Printed markup alone is not that interface. Use this distinction for diagnostics, without assuming that prompt changes can repair every provider-side problem. [Official tool-use documentation](https://lmstudio.ai/docs/developer/openai-compat/tools)

## Scope and constraints

Implement recovery for the observed text-only tool-call failure first. Also handle repeated tool-invocation errors using observed results, with the distinctions below. Preserve normal model self-correction after an isolated real tool error.

Do not implement XML-to-command execution, provider/template changes, automatic model switching, cloud fallback for B, sandbox relaxation, or a general retry framework. Never replay the original handoff to recover one failed turn. Previously successful operations must remain in the same conversation and must not be repeated automatically.

Follow [CONTRIBUTING.md](../CONTRIBUTING.md), [security-model.md](security-model.md), and [dependency-api-audit.md](dependency-api-audit.md). Retain strict NodeNext TypeScript, `.js` import specifiers, schema-derived types, existing Zod validation, the pinned toolchain, and the Vitest worker cap. No dependency upgrade is needed for this work.

## Recovery behavior

### 1. Classify the completed B turn

Add a small pure classifier, proposed as `src/coordinator/execution-failure.ts`. Consume the actual `ModelTurnEnd`, the active B tool catalog, and bounded prior failure state. Use a discriminated union so each outcome carries only its required facts.

Apply these rules in order:

1. Cancellation, provider errors, and truncation follow their existing lifecycle paths. Do not turn them into a tool-format retry or infer that a partially emitted operation ran.
2. Native `toolCall` blocks and their correlated results are authoritative. A mixed batch retains each call's result; one failure does not erase successful calls.
3. A valid, correctly correlated `pi-completion` follows normal review, unless a recovery probe is still unresolved. Handle that exception as described below.
4. With no native calls, detect a high-confidence attempted invocation when the complete response consists of recognizable tool-call blocks, such as the observed XML form. Recognize the call envelope and tool name; never execute or reconstruct arguments from that text.
5. Otherwise preserve the existing invalid-completion/format-repair behavior.

Bound detection work and evidence size. Start with an explicit small syntax set and tests for that set, not a regex that treats any mention of `read`, JSON, or `<tool_call>` as an attempted call. Ignore tool output and reasoning content. Explanations, quoted examples, code fences containing examples, and a valid completion discussing tool syntax must not trigger recovery. Unrecognized or ambiguous syntax is an ordinary invalid response, not permission to execute it.

For native calls, distinguish an observed error result from a missing result. An error may reflect partial side effects; a missing result is an unknown outcome. Do not classify permission denial, argument validation, or an unknown tool by guessing from arbitrary prose. Preserve structured categories only where the installed adapter provides them; otherwise report `tool_result_error` with bounded metadata. Missing results take a terminal diagnostic path because execution cannot safely be assumed absent.

Trigger A immediately for high-confidence text-only calls. Trigger A after two consecutive completed native tool turns with error results and no successful results. Reset this consecutive-error counter on successful tool progress, not on a reformatted report. A single tool error remains available for B to correct normally. Mixed success/error batches do not qualify for automatic replay and retain their individual facts for review.

Completion criterion: unit tests reproduce the homepage response as an attempted call with zero executions, while distinguishing documentation examples, ordinary malformed completions, native tool errors, and unknown outcomes.

### 2. Give A coordinator-owned evidence

Introduce a versioned evidence schema, proposed in `src/workflow/tool-recovery.ts`, and derive TypeScript types from it. Include:

- Request, workflow, handoff, iteration, incident, and B response/run identifiers available from the coordinator.
- Successful B-turn count, including zero; observed native call/result counts; and successful/error/unknown outcomes.
- Failure category, recognized attempted tool name, and whether tools were enabled for this execution turn.
- The active tool names and the selected tool's trusted input schema, obtained through a narrow metadata-only runtime accessor. Never obtain this information from B's assertions.
- A bounded list of recent actual tool facts, including successful operations that must not be replayed.
- Recovery attempts already used and the last validated instruction/outcome, so A can change its advice instead of repeating it.

Do not send raw B reasoning, full assistant messages, arbitrary tool output, credentials, or broker capabilities to A. For the observed failure, normalized facts such as `text_tool_call`, `attemptedTool: read`, `nativeCalls: 0`, and `toolsEnabled: true` are sufficient. Keep inferred intent distinct from observed execution.

Use the existing redaction and display sanitization helpers before evidence reaches a prompt, event, ledger, or UI. Tool metadata and workspace-derived values remain untrusted data; render them in a bounded data section with explicit trust instructions. Validate names against the active catalog, and expose only relevant schema fields rather than dumping MCP metadata.

Completion criterion: A receives enough facts to identify the protocol failure without seeing raw B content or accepting B's unverified claims as runtime evidence.

### 3. Request a specific correction from A

Keep periodic `pi-check-in` behavior intact. Add a separate strict `pi-tool-recovery` decision schema and prompt renderer. This avoids weakening the positive-turn periodic-check contract to accommodate a different event.

Common decision fields: `schemaVersion`, current correlation IDs, `incidentId`, `attempt`, and a bounded `reason`. Use a discriminated decision union:

- `redirect`: a validated active `toolName`, concrete argument data checked against that tool's input schema, one to five bounded instructions, and the fixed expectation `successful_tool_result`.
- `blocked`: a bounded explanation and a concrete next diagnostic step. No execution instructions or argument payload are allowed in this variant.

For text-only tool calls, the redirect should normally request one read of an existing, relevant workspace file. A can inspect the workspace with its existing read-only tools to choose that file. If there is no suitable permitted diagnostic, A should report the constraint; it must not invent a path or create a file just to test execution. For other failures, A should choose a safe inspection or corrected invocation within the existing approved scope. Treat prior mutation outcomes conservatively.

Example guidance for the recorded incident:

> The runtime observed zero tool calls. Your previous response was text. Invoke the registered `read` tool through the tool-calling interface with `path` set to `README.md` in the current workspace. Make one call and wait for its result. Printed XML and completion reports do not execute tools. After the read succeeds, continue the approved homepage work and run its required checks.

The renderer may show the validated tool name and a JSON argument object as reference data. It must distinguish those arguments from an assistant-text tool invocation. B still constructs and sends the native tool call; the coordinator does not execute A's proposed arguments itself.

Correlate the probe with the requested tool and validated arguments, using deterministic normalization for workspace-relative paths. Match the resulting call ID to its result. An unrelated successful call must not satisfy the probe. Preserve the normal sandbox and scope checks; JSON-schema validity alone does not establish that an action is permitted.

Add `tool-recovery` to response-progress handling and `pi-tool-recovery` to reserved protocol tool names. Add `coordinator_tool_recovery` provenance. Reuse bounded `repairResponse` only to repair A's decision format, with A's tools disabled on those format-only attempts. B remains paused throughout. A decision-format exhaustion must remain a typed A failure, not consume B execution retries or silently resume B.

Do not put zero into the existing positive `ResponseProgress.turnCount`. Keep recovery's nonnegative `completedTurns` in its own schema and evidence. Migrate all affected protocol consumers and presentation mappings in the same change.

Completion criterion: A generates schema-valid, correlated guidance for a zero-turn incident; invalid tool names, wrong IDs, invalid arguments, oversized fields, and action data attached to `blocked` are rejected before steering.

### 4. Steer B within the active submission

Use the awaited `onTurnEnd` path. A's recovery request runs while B is paused; once the decision is validated and recorded, return the rendered steering instruction to `ManagedSession`, which queues it through Pi's supported steering API. Do not call `B.prompt()` recursively while B's submission is active.

The installed agent-core loop checks queued steering after emitting `turn_end`, including a text-only turn. Prove this using a real Pi fixture test before relying on it. Preserve the same approved handoff, iteration, request, session, and execution response; recovery gets its own incident/attempt identifiers. It does not create a new review round, bypass approval, reset the total operation deadline, or clear conversation history.

Keep a typed incident state such as `idle`, `awaiting_recovery_decision`, and `awaiting_probe_result`. Store the expected tool and safe correlation data with the pending probe. Never expose an unrestricted model-controlled state patch.

Observe the next B turn:

- A matching native call with a correlated non-error result proves the requested diagnostic executed. Record recovery success, then let B continue its original work. This proves tool use, not task completion.
- A native error proves the invocation reached the tool path, but not that the diagnostic succeeded. Give A that distinction on the next bounded intervention.
- Another text-only invocation or an unrelated response fails the probe. Obtain revised A guidance if budget remains.
- A valid completion with an unresolved probe does not establish recovery. If it reports a blocker, pass it to review with the unresolved runtime evidence. If it claims execution success without the required facts, treat that as a failed probe rather than accepting the assertion as proof.
- Cancellation, provider failure, truncation, missing results, or a stopped submission take the appropriate existing terminal path. Never silently retry an operation with an unknown outcome.

B's authorized tools remain available. Guidance narrows the requested next action; it is not a new permission grant or a guarantee that B obeys. If B performs other authorized operations, record them accurately and never repeat them automatically to satisfy the probe.

Completion criterion: malformed text -> A redirect -> native read/result -> continued B work -> valid completion occurs within one approved handoff, without generic B format repair or replayed writes.

### 5. Fix final-response selection

Update `RuntimeEventBridge.promptAndWaitForTurnEnd` so a continued intermediate text response cannot become the returned submission result. Maintain submission-local terminal candidates as turns arrive, and return the final eligible assistant response only after the entire managed prompt, queued events, and compaction have settled. Later provider errors, cancellation, or typed supervision failures must take precedence over an earlier candidate.

Do not patch this by returning the last global message from a session: that risks stale history, role confusion, and unrelated submissions. Preserve current runtime/session correlation and cleanup. Reconcile the current waiter/buffer machinery with the submission-local result owner, and remove redundant result selection rather than keeping two competing paths.

Review both real Pi and fake-session behavior. Existing tests emit events through adapters with different timing; the final-result contract must not depend on listener registration order. Preserve UI transcript retention for intermediate responses while marking their recovery outcome separately.

Completion criterion: a real Pi fixture that emits malformed text followed by steered tool use and a valid completion returns the valid completion. A later provider error or cancellation rejects the submission instead of returning earlier text.

### 6. Bound retries and preserve failure attribution

Use explicit coordinator constants for the initial implementation:

- At most two A-directed B recovery attempts per incident.
- At most three A-directed B recovery attempts across the entire approved workflow, shared across handoffs.
- Existing operation deadline and cancellation remain the outer limits. Existing A response-format attempt limits still apply independently.

An incident begins on a triggering failure and ends on a verified successful diagnostic or a terminal outcome. A repeat failure while the probe is pending belongs to the same incident. Consume a B recovery attempt when a validated redirect is durably recorded for dispatch; failed A formatting attempts do not consume that budget. Resetting the periodic counter, changing handoff iteration, or getting a well-formed completion cannot replenish the workflow budget.

The workflow orchestrator owns the shared budget; a newly constructed per-handoff supervisor must not reset it. Prefer a small workflow-local recovery owner over mutable module globals or a general-purpose retry service.

On exhaustion, block with a typed tool-recovery error carrying the current workflow, handoff, iteration, incident, counts, and last verified outcome. Integrate it into both orchestrator failure entry points, result construction, and attribution. Do not fall back to iteration 1 or label an exhausted B tool failure as an A model failure. Distinguish A declining recovery, A decision-format exhaustion, unknown execution outcome, and B retry exhaustion.

Report an actionable conclusion, for example: “B continued returning tool-call text after two guided attempts. No native tool execution was observed. Check the local model's tool-use integration.” Do not assert a specific LM Studio parser defect without separate evidence.

Completion criterion: persistent failure stops at the configured bound with correct IDs and counts, no extra B request, and an accurate explanation.

### 7. Persist and present the intervention

Add versioned recovery lifecycle records through the existing append-only ledger, with a dedicated nonterminal `tool_recovery` status and a schema-validated details union. Record incident detection, validated redirect dispatch intent, successful diagnostic, and terminal failure. Use incident/attempt IDs to correlate records and prevent duplicate handling. Keep B recovery counts separate from existing completion-format `repairCount`.

Record redirect intent before queuing B steering. A record is evidence of dispatch intent, not proof that a tool executed. If persistence fails, stop before sending the redirect. If the application exits between recording and execution, replay shows an interrupted incident and does not resume it automatically.

Update ledger replay and workflow snapshot projections to retain recovery history and terminal evidence without manufacturing a completed iteration or changing existing workflow status semantics. Validate new details at the persistence boundary, preserve old ledger compatibility, and keep the existing partial-final-line recovery behavior. Do not expand this into a general ledger rewrite.

Emit structured events for detected, reviewing, redirected, recovered, and stopped states, carrying the same bounded evidence. Update activity summaries, retained history, history detail, prompt provenance labels, and TUI progress. Use a dedicated recovery progress variant with `completedTurns: 0` supported; keep periodic `scheduled`/`checking` variants unchanged. Render messages such as “A diagnosing B tool invocation” and “B retrying read, attempt 1/2”. Failed probes must not increment successful B-turn counts.

Both ordinary review and review-cap prompts must include a separate coordinator-observed section: actual calls/results, unresolved failures, recovery attempts, and known successful operations. Label B's summary and verification list as claims. These facts help A challenge unsupported claims but do not independently prove file contents, test coverage, or task completion. Recovery exhaustion must retain a deterministic factual user-facing explanation even when no final A response is available.

Completion criterion: live output and replay both explain what failed, what A instructed, what B actually executed, and why execution continued or stopped. Old histories still load; restart dispatches neither agent.

## Implementation sequence and files

1. **Lock down the failure and continuation behavior.** Extend [runtime-event-bridge tests](../test/unit/runtime-event-bridge.test.ts) and add `test/integration/tool-recovery-pi.test.ts` using the existing real Pi fixture-provider pattern. Capture the text-only XML failure without copying private sessions into the repository. Use a test-supplied steering callback to demonstrate continuation independently of the new A policy. Prove the stale-first-response regression, fix final-response selection, and make this first test pass before adding the recovery policy.
2. **Define classification and evidence.** Add the classifier, recovery schema/decision renderer, and focused unit tests. Add a metadata-only active-tool accessor to [runtime contracts](../src/runtime/create-role-runtime.ts), implement it in `ManagedSession`, and update [test fakes](../test/helpers/fakes.ts). Keep accessor output credential-free and validated.
3. **Wire A intervention and B continuation.** Update `execution-supervisor.ts`, `workflow-orchestrator.ts`, `managed-session.ts` only where required, and `bind-runtime-events.ts`. Add the workflow-scoped budget, pending-probe state, typed terminal errors, protocol label reservation, response-kind handling, and provenance.
4. **Add durable evidence and operator output.** Update `src/types/handoff.ts`, `src/types/workflow.ts`, `session-ledger.ts`, `handoff-state-machine.ts`, review/cap renderers, `execution-progress.ts`, and the affected files under `src/app/interactive`, `src/app/presentation`, `src/app/tui`, and `src/app/activity-summary.ts`. Update all discriminated-union consumers together.
5. **Verify and document the behavior.** Extend existing supervision, response-repair, lifecycle, history, and security coverage. Add terminal fixture scenarios. Update architecture decisions, response-repair documentation, and terminal verification documentation with observed results and limits.

Each step must leave its focused tests passing before proceeding. For implementation, start from an isolated clean checkout of the agreed project base and preserve unrelated working-tree changes. No automatic deploy, provider reconfiguration, or live rerun is part of writing this plan.

## Required verification

### Deterministic behavior

- Exact incident pattern: enabled tools, XML assistant text, zero executed calls, zero successful turns, A intervention, retained B tools, native read/result, continued implementation, and correct final completion selected.
- Persistent XML: two guided attempts in one incident, then stop; no completion-format repair used to hide the failure; no fourth handoff created to escape the limit.
- Workflow budget: separate recovered incidents and later handoffs share the three-attempt cap.
- False positives: quoted XML, fenced examples, ordinary prose, valid completion discussing tools, reasoning text, unknown syntax, and normal native tool calls.
- Actual errors: one native error allows normal correction; two consecutive unsuccessful tool turns trigger A; mixed results preserve successful operations; unknown results are not retried.
- Probe contract: wrong tool, invalid arguments, wrong target, unrelated text, blocker completion, fabricated success, successful call with an error result, and verified success all take distinct correct paths.
- A decisions: wrong IDs, nonexistent tools, invalid/oversized payloads, protocol-name misuse, malformed decision repair, explicit block, and decision-format exhaustion.
- Mutation safety: a real successful write before the malformed turn executes exactly once through recovery. No original-handoff replay and no interpretation of text as executable commands.
- Lifecycle: cancel/timeout while A diagnoses, while A repairs its decision, before redirect dispatch, and during B's probe. No post-cancellation writes, queued prompts, stuck UI, or leaked subscriptions. A subsequent operator request works.
- Bridge result selection: intermediate text followed by valid completion, later provider error, truncation, cancellation, compaction, and runtime replacement/rebinding. No stale result from another submission.
- Persistence/history: success, exhaustion, dispatch intent interrupted by restart, old ledger records, partial last line, new-record validation, chronological presentation, and zero-turn progress. Replay performs no model calls.
- Security: dummy secret and terminal-control fixtures across A prompts, steering, telemetry, ledger, and UI; no raw reasoning or full tool output forwarded; unchanged tool/catalog and role boundaries.

Use real Pi sessions with `fixtureChatResponse` for malformed text and `fixtureChatToolResponse` for structured calls. Execute tools only in disposable sandboxed workspaces. Fake-unit tests alone do not prove continuation timing or terminal-response selection. Reuse [response-repair Pi tests](../test/integration/response-repair-pi.test.ts) and [execution check-in tests](../test/integration/execution-check-in.test.ts) as patterns; retain their existing guarantees.

### Commands and evidence

For the implementation, verify the scoped Node/npm versions first. Run focused new/affected Vitest files, then:

```sh
npm run check
npm test
npm run build
npm run verify:isolation
npm run verify:terminal
git diff --check
```

Run build-dependent commands sequentially because they replace `dist`. Retain the repository's two-worker Vitest configuration. Run `npm run verify:dependencies` if dependency imports or compiler settings change. Record exact command outcomes and distinguish fixture verification from live provider verification.

After deterministic checks pass, use the existing trusted-installation workflow for one bounded live smoke test with the selected local B model. Keep credentials inside the established broker boundary. Test a disposable, approved task and inspect actual tool events. Record model/runtime identifiers, recovery attempts, tool outcomes, and final status. Prompt steering may still fail against a broken tool-use integration; accurate bounded failure is a required supported outcome. Do not claim that this plan or fixture tests verify live recovery.

## Acceptance gate

The change is complete when A can intervene at zero successful B turns using coordinator-owned evidence, issue specific validated tool guidance, and recover through a real structured call without replaying writes or weakening isolation. Unrecoverable cases must stop within their independent budget and leave a truthful, replayable record. Existing periodic check-ins, tools-disabled completion repair, review caps, cancellation, and session recovery must continue to pass their regression coverage.

Plan preparation checked the source contracts, saved incident evidence, installed Pi steering loop, and official LM Studio tool-call contract. No application behavior has been changed or live recovery tested by this document.
