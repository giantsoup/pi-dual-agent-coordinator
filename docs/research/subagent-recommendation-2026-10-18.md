# Subagents for agents A and B

Historical SDK assessment: version-specific conclusions below describe Pi 0.67.68. The coordinator now targets Pi 1.3.0. See [upgrade verification](../pi-upgrade-verification.md). Subagent implementation remains outside this migration.

Research date: 18 October 2026. Inspected `main` at `8532d2d54d56c9f3b37bafa2f568989c39098c3e`, including the existing uncommitted runtime, coordinator, and terminal changes. This is a design recommendation, not an implementation or a throughput benchmark. Existing work was preserved.

## Recommendation

Add a coordinator-owned delegation tool to both agents. Each delegated task gets an independent Pi session, restricted tools, a task identity, and a bounded lifetime. A and B decide when a helper is useful. The coordinator decides whether the request fits permissions, available capacity, and the remaining operation budget.

Ship read-only helpers first. A can split repository investigation and independent reviews across helpers. B can ask helpers to trace an unfamiliar subsystem, inspect a failure, or examine adjacent behavior while keeping implementation in B's own hands. A retains planning and final sign-off. B retains execution ownership. Child findings are evidence that the parent evaluates.

Follow with write-capable B helpers only after workspace isolation and result integration exist. A must never gain write access through delegation. Keep children one level deep initially.

My planning estimate is **6-10 engineering days for a supported read-only release**, including security, cancellation, retained history, and terminal verification. Isolated coding helpers add approximately **6-10 more days**. These are judgment estimates for one developer familiar with this code, not measured delivery commitments. A runnable demonstration would be much smaller than the supported feature.

## What exists today

The current flow is operator input, A planning, execution authorization, B execution, A review, and another bounded iteration or final response. The coordinator validates the machine blocks and owns all transitions. During longer B runs it pauses B after every ten completed parent turns for an A process check. See [workflow orchestration](../../src/coordinator/workflow-orchestrator.ts), [execution supervision](../../src/coordinator/execution-supervisor.ts), and [the architecture decisions](../architecture-decisions.md).

There is useful infrastructure to reuse, but no child-task supervisor:

| Existing mechanism | Consequence for delegation |
| --- | --- |
| [`createRoleRuntime`](../../src/runtime/create-role-runtime.ts) constructs broker-backed, sandboxed sessions | Reuse its trusted construction and `baseToolsOverride`; do not create ordinary Pi sessions with defaults. |
| [`Role`](../../src/types/role.ts) is A or B; [`RuntimeRegistry`](../../src/runtime/runtime-registry.ts) stores one binding per role | Keep these as top-level roles. Track helpers by task ID in a separate registry. |
| [`RuntimeEventBridge`](../../src/coordinator/bind-runtime-events.ts) keys subscriptions and run state by role | Binding another A or B through it would replace that role's subscription. Child events need their own identity and routing. |
| [`Coordinator.cancelActive`](../../src/coordinator/coordinator.ts) aborts the two registered sessions | Extend operation ownership to queued and active children before reporting cancellation complete. |
| [`createRoleRuntime`](../../src/runtime/create-role-runtime.ts) couples role, provider, prompt, and tool permissions | Separate trusted worker profiles from parent identity so a local B helper can have read-only tools. |
| [`withSafeMutation`](../../src/tools/with-safe-mutation.ts) reports paths; [`reservePath`](../../src/tools/path-reservations.ts) resolves a path | Neither provides ownership or conflict isolation. B's bash can also write without passing through the edit/write callback. |

The [security model](../security-model.md) is a requirement for children too. A uses approved OpenAI models through its private broker. B uses fixed local LM Studio models and has no cloud fallback. Tool subprocesses cannot access the network, Keychain, coordinator state, or the trusted installation's writable files. General executable Pi resource discovery is disabled. Historical Step 0 verification is documented in [its verification record](../step-0-verification.md); no isolation suite was rerun for this research.

## What Pi provides

The lockfile and installed SDK resolve to **0.67.68**. The manifest uses `^0.67.68`, so it is not itself an exact pin. Pi supplies independent sessions, custom tools, streaming events, usage information, and cancellation methods. The app must supply task scheduling, limits, parent ownership, workspace policy, and durable results. See the [versioned SDK guide](https://github.com/badlogic/pi-mono/blob/v0.67.68/packages/coding-agent/docs/sdk.md) and [session manager](https://github.com/badlogic/pi-mono/blob/v0.67.68/packages/coding-agent/src/core/session-manager.ts).

Pi's official subagent example runs separate CLI processes and supports single, parallel, and chained tasks. Its concurrency limits belong to that example. It does not establish this app's broker, sandbox, global budget, or workspace ownership policy. Copying it unchanged is therefore unsuitable. See the [official example](https://github.com/badlogic/pi-mono/blob/v0.67.68/packages/coding-agent/examples/extensions/subagent/README.md) and [runner implementation](https://github.com/badlogic/pi-mono/blob/v0.67.68/packages/coding-agent/examples/extensions/subagent/index.ts).

One important version-specific trap: `AgentSession.dispose()` in 0.67.68 disconnects listeners but does not abort work. Child cleanup must explicitly stop and drain the managed prompt, compaction, and branch summaries before disposal. This app's [`ManagedSession`](../../src/runtime/managed-session.ts) already handles that broader lifecycle. See the [versioned session source](https://github.com/badlogic/pi-mono/blob/v0.67.68/packages/coding-agent/src/core/agent-session.ts).

Current upstream has changed package names and APIs. A Pi upgrade is separate work, not a prerequisite. The [supporting source notes](pi-subagent-source-notes-2026-10-18.md) record the version boundary and additional implementation details.

## Options considered

| Option | Benefit | Cost or limitation | Recommendation |
| --- | --- | --- | --- |
| Coordinator-managed SDK sessions | Reuses existing security and lifecycle code; streams directly into retained history | Requires task scheduling and identity beyond two roles | Choose this |
| Adapt Pi's CLI example | Existing dispatch and progress example | Must rebuild secure child bootstrap, auth, discovery suppression, and process cleanup | Use as a reference |
| Build an external agent server or adopt another orchestration framework | Potential distribution and broader provider support | Adds another trusted runtime and transport without solving this app's role, approval, or persistence rules | Defer |

A coordinator-launched worker process could later host the same secure child contract for crash isolation. That is distinct from letting an agent's sandboxed bash start an unrestricted agent. No agent-controlled subprocess should acquire credentials or launch privileged work.

## Proposed first release

Expose one `delegate` tool with a bounded batch of task descriptions and a trusted profile name. It waits for the batch and returns an individual result for every task, including failures. Parallelism happens inside the batch, while the parent awaits the tool result. Register the tool with `executionMode: "sequential"` so sibling write or bash calls cannot execute alongside it. Pi 0.67.68 supports this per-tool setting in its [tool contract](https://github.com/badlogic/pi-mono/blob/v0.67.68/packages/agent/src/types.ts). This avoids introducing detached background tasks, polling tools, and late messages in the first release. An async start/status/cancel interface can follow if overlapping parent work proves valuable.

The tool receives task text, relevant paths, and an expected result. The coordinator supplies parent operation, session, workflow, and handoff identifiers. Model-generated arguments cannot select a provider URL, credential, arbitrary cwd, executable extension, or stronger permission profile.

The flow would be:

1. The parent identifies a separable question and calls `delegate`.
2. The coordinator validates the profile and atomically reserves task and provider capacity.
3. Each worker gets an independent context with the task, approved constraints, relevant evidence, and applicable repository instructions loaded through isolated tools.
4. Child events are redacted and recorded with task, parent run, and operator turn identities. Child text never enters the parent's workflow-protocol parser.
5. The coordinator returns bounded findings, paths and evidence, verification actually performed, outcome, and usage. It retains the full sanitized transcript privately for inspection.
6. The parent evaluates the result and continues its existing planning or execution flow. A child cannot approve a plan, emit an authoritative completion, or finalize the workflow.

Use separate child prompts rather than the current top-level A/B prompt appendices. Otherwise helpers would inherit machine-block duties that do not belong to them. Each child owns its session, tool scratch space, subscriptions, and broker capability lifetime. Frozen provider configuration must be tested with concurrent sessions because Pi has process-global provider registrations. See [the model registry source](https://github.com/badlogic/pi-mono/blob/v0.67.68/packages/coding-agent/src/core/model-registry.ts).

Suggested initial policy, subject to evaluation:

| Control | Starting policy |
| --- | --- |
| Capabilities | Both parents get read-only scouts/reviewers; no MCP in child profiles initially |
| Model routing | A helpers use A's approved selected model; B helpers use B's approved local model |
| Recursion | Children receive no delegation tool |
| Concurrency | At most two active children globally; one active local inference request across parent and children |
| Task count | At most four children per batch, eight total per operator operation, including review and repair rounds |
| Lifetime | At most six model turns and 120 seconds per child, always within the parent's remaining deadline |
| Output | Bounded returned summaries; retained sanitized transcripts show truncation and failures explicitly |
| Check-ins | Disable delegation during the short A process check; preserve B's parent-turn counter and record child counters separately |

These numbers are conservative starting values, not measured optima. Per-request deadlines and output limits also apply. A child can be useful with one local inference slot because it gives a focused context, even when its work is queued. A later approved local-scout profile for A could reduce cloud usage, but routing A helpers locally should be an explicit product choice.

Acquire inference capacity per provider request, then release it when that request settles. Never hold the local slot for an entire parent session or while the parent awaits delegation. Otherwise B would hold the only slot needed by its own child. Task-lifetime limits and inference concurrency are separate controls.

Budgets must cover the whole operator operation, not reset for each child, batch, or handoff. Reserve request and output-token allowances before dispatch. Count compaction, protocol repair, and failed attempts. Track reported usage afterward. The current broker's `maxOutputTokens` path is smoke-specific and rejects tools; it is not a ready-made general child budget. Extend [the broker](../../src/security/provider-broker.ts) rather than wiring that flag into tool-enabled workers. Monetary estimates based on configured pricing are informational until billing categories are verified; enforce request and token ceilings directly.

Cancellation must first prevent new dispatch, abort queued and active children and parent sessions, and then drain all owned work. Do not report idle while children can still issue requests. Late results from an old run must be rejected. Restart should mark unfinished children interrupted and preserve their evidence, consistent with the current policy of superseding unfinished workflows rather than automatically resuming them.

Read-only children can share the workspace in this first release with sequential delegation and a coordinator-owned write barrier for the batch. Awaiting a tool alone does not establish exclusive workspace access. The barrier must cover bash and any other mutation path, including outstanding owned subprocesses. External edits can still occur, so evidence should identify the observed revision or relevant file hashes. Verification commands that need to write build artifacts belong to B, not read-only helpers.

## Local inference and eventual coding helpers

LM Studio documents continuous batching and a configurable maximum prediction count. That establishes a mechanism, not the throughput of your loaded model and runtime. Its current parallel-requests page also contains an engine-specific support caveat, so installed backend support must be checked directly. See [LM Studio's parallel requests documentation](https://lmstudio.ai/docs/app/advanced/parallel-requests).

Before raising local concurrency, compare the same delegated workload at one, two, and four inference slots. Record time to accepted result, per-task latency, tool failures, memory pressure, and swap growth. Keep the model, quantization, task input, and context settings constant. More sessions should earn their memory and coordination cost through better accepted results or shorter elapsed time. No local performance claim is established by this research.

For coding helpers, give every B child a separate writable workspace at a recorded base revision. The parent pauses its own writes until results are integrated. Children return patches and verification evidence. The coordinator checks the base and conflicts, B integrates accepted work, and A reviews the resulting combined diff. Preserve failed or conflicting work for inspection.

Git linked worktrees share repository metadata. They separate working files but are not a security sandbox. The coordinator must own worktree and integration operations, restrict child writes to its assigned directory, and protect shared Git metadata. A copied workspace with a generated patch may be simpler for the first writer implementation. See [Git's worktree documentation](https://git-scm.com/docs/git-worktree).

The current checkout has uncommitted changes, which illustrates another required policy: a worktree at HEAD does not include the current dirty files. Initially require a clean, recorded task base or explicitly construct and verify a snapshot. Do not silently omit edits or stash the operator's work. Dependency setup, generated files, shared databases, ports, and tests with external side effects also need ownership rules before multiple writers run.

## Implementation scope and estimate

Keep scheduling, budgets, cancellation, and task results behind one coordinator-owned module. Its agent-facing interface is the bounded delegation tool. It internally owns a task registry and runner. Keep top-level role replacement and child-task creation distinct.

| Work | Likely locations | Estimate |
| --- | --- | --- |
| Worker profiles and secure session construction | `src/runtime/create-role-runtime.ts`, `src/tools/create-role-tools.ts`, `src/security/isolation.ts`, `src/app/trust-policy.ts` | 1-2 days |
| Delegation tool, queue, aggregate budgets, child lifecycle | New `src/delegation/` module; coordinator operation handling; provider broker | 2-3 days |
| Child event identity, private transcripts, recovery, TUI and plain inspection | Runtime event bridge, telemetry types, persistence, retained history, terminal presentation | 1-2 days |
| Integration, isolation and PTY verification; docs and trusted-runtime rollout | Existing test layers and verification scripts | 2-3 days |
| Later isolated B writers, patch integration, dirty-base and conflict cases | Delegation workspace management and integration policy | Additional 6-10 days |

Total: **6-10 days for read-only helpers; 12-20 days including isolated coding helpers**. No new orchestration dependency is needed for the proposed first release. Recursive delegation, inter-child messaging, arbitrary model selection, independent background tasks, and distributed workers are outside these estimates.

The terminal should show a delegation group beneath the parent's run, with task name, parent, profile/model, queued/running/terminal state, duration, and usage. Each child remains inspectable after completion or restart. Keep the existing A/B turn counters accurate and show child work separately. The same information must be available in plain mode.

## Required evidence before release

Acceptance must exercise real Pi sessions with deterministic providers and the actual isolated tools:

- Both parents delegate successfully. Child context, session IDs, tools, and results stay independent. Reused tool-call IDs cannot cross-wire tasks.
- A helpers and read-only B helpers cannot mutate the workspace, including through bash or MCP. B helpers never use cloud inference.
- Oversized batches, recursive requests, expired operations, and exhausted budgets fail before dispatch. Concurrency reservations hold under simultaneous requests.
- A delegation call emitted alongside write/bash calls cannot race them. One-slot local delegation completes without the parent holding the child's inference capacity.
- Cancellation during setup, queueing, tool execution, streaming, and compaction leaves no new child requests or owned work. Disposal alone is not accepted as proof.
- A child failure or timeout is returned honestly, with no silent successful summary. Child machine blocks cannot trigger parent transitions.
- Child tool facts and outcomes reach parent supervision without inflating the parent-turn count. Delegation cannot create a nested check-in deadlock.
- Restart retains completed evidence, interrupts unfinished tasks, and does not relaunch children automatically.
- Extend dummy-secret isolation checks across child tools, auth, broker requests, transcripts, logs, MCP denial, and malicious repository instructions. Verify simultaneous sessions cannot replace each other's provider configuration.
- PTY verification covers narrow and wide terminals, retained inspection, cancellation, and plain output. Coding helpers additionally require conflict, dirty-base, shared-state, and combined-diff review checks.

Run typecheck, targeted and full tests, build, isolation verification, and terminal verification after implementation. Build and tests must run sequentially because the build replaces `dist`, which isolated workers use. Prepare the separate trusted installation before any credential-backed evaluation. A bounded live smoke and a representative coding run would provide separate provider and usefulness evidence.

For this report, verification covered source and installed-version inspection, official documentation, local link validation, and whitespace checks. No app behavior, package versions, credentials, or running model configuration changed. No inference, runtime suite, or throughput benchmark was run.

Recheck the report's local source assumptions and Markdown links with:

```sh
python3 docs/research/verify-subagent-research.py
```
