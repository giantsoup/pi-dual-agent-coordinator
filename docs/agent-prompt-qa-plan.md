# Agent prompt QA and improvement plan

Status: proposed for review. No implementation authorized or started.

Reviewed on 2026-10-18 against `main` at `7d245c1a1a690d891016eb138ed077dfa03d1dfa`. The working tree was clean before this document was added. Research dates below are access dates unless a publication or specification date is explicitly given.

## Recommendation

Keep the current two-agent workflow and fenced JSON protocol. Improve the context each agent receives, repair omissions in the assembled prompts, and test behavior against the actual role models. Start with trust boundaries, tool guidance, and review evidence. Do not solve these issues by making the persistent system prompt longer.

The highest-priority findings are concrete: the custom Pi system prompt skips normal tool guidance; MCP server instructions enter that privileged prompt; and final review does not receive the approved acceptance criteria or constraints. A separate authorization issue needs a product decision: an initial model-generated `pi-execute` block currently starts B without an independently represented operator execution intent.

This document is the only repository change from this pass. It proposes future code, tests, and documentation work. It does not change dependencies, models, configuration, credentials, permissions, or running installations.

## Verified baseline and scope

The application uses Node.js `>=20.6.0`, TypeScript with strict NodeNext ESM, Pi sessions and TUI, Zod workflow schemas, TypeBox tool schemas, the MCP TypeScript SDK, and Vitest. The lockfile resolves Pi coding-agent/agent-core/ai to `0.67.68`, TypeScript to `5.9.3`, Vitest to `3.2.4`, MCP SDK to `1.29.0`, TypeBox to `0.34.49`, and Zod to `4.3.6`. These are local compatibility facts, not recommendations to upgrade.

Agent A uses OpenAI Responses and is read-only. Agent B uses the local LM Studio OpenAI-compatible completions transport and has mutation tools. Defaults in [models.ts](../src/security/models.ts) are `openai/gpt-6-luna` and `lm-studio/qwen3.6-35b-a3b`; configuration can select other approved models. Evaluate configured models and settings, not just these defaults. Do not assume B supports a developer role or OpenAI-specific output controls.

The audit covered these instruction paths:

- Persistent role policy, planning guidance, and protocol examples in [trust-policy.ts](../src/app/trust-policy.ts).
- System prompt construction, isolated root `AGENTS.md` loading, resource restrictions, and session replacement in [create-role-runtime.ts](../src/runtime/create-role-runtime.ts).
- Interactive planning and approval in [coordinator.ts](../src/coordinator/coordinator.ts), plus initial execution planning in [workflow-orchestrator.ts](../src/coordinator/workflow-orchestrator.ts).
- B's [handoff](../src/handoff/render-handoff-message.ts), A's [review](../src/workflow/render-review-message.ts), and [review-cap control](../src/workflow/render-final-message.ts) prompts.
- Both directions of [process check-in](../src/coordinator/execution-supervisor.ts), [format repair](../src/coordinator/response-repair.ts), and [provenance tags](../src/app/prompt-provenance.ts).
- Built-in tools, MCP direct/proxy descriptions, server initialization instructions, resources, and fetched MCP prompts in [tools](../src/tools/create-role-tools.ts), [extension](../src/mcp/extension.ts), [direct tools](../src/mcp/direct-tools.ts), and [proxy](../src/mcp/proxy-tool.ts).
- Pi-owned compaction and branch-summary prompts in the installed package, their lifecycle in [managed-session.ts](../src/runtime/managed-session.ts), and workflow/session recovery. Branch-summary support was inspected; this pass does not establish that every SDK path is exposed by the app.
- The copy/paste [Pi upgrade](pi-upgrade-implementation-prompt.md), [narrative TUI](tui-narrative-history-implementation-prompt.md), and [active-turn implementation](research/agent-tui-design/active-turn/IMPLEMENTATION_PROMPT.md) prompts. These are human-invoked documentation, not automatically loaded runtime prompts.

No workspace `AGENTS.md` was present in this checkout. Its loading behavior was inspected in code. External servers' live prompt contents and users' private project instructions were not fetched. Global Pi skills, executable extensions, and prompt templates are deliberately disabled; do not enable them as a prompting improvement.

## QA findings

Priority P1 means address before claiming stronger authorization, trust handling, or reliable review. P2 means reliability and maintainability work. These findings distinguish observed code behavior from model-behavior risks; no exploit or live-model success rate was established.

### F1. Custom system prompt drops tool guidance · P1

[create-role-runtime.ts](../src/runtime/create-role-runtime.ts), around lines 234–240, supplies a one-sentence custom `systemPrompt`. Installed Pi's `dist/core/system-prompt.js` returns early for a custom prompt, retaining the role appendix and project text but skipping its ordinary tool snippets and `promptGuidelines`. That includes the MCP proxy's guidance to prefer direct tools and otherwise search/describe/call.

A read-only probe of Pi's actual `buildSystemPrompt` confirmed that marker snippets and guidelines appear with the default builder and disappear with the custom prompt. Tool definitions still exist in the API request; this is missing guidance, not missing executable tools.

Plan: retain controlled resource loading and explicitly compose the small app-owned coding/tool contract needed by each role. Test the resulting provider-bound prompt, including when tools are disabled for repair. Do not blindly restore Pi's full default prompt or its discovery assumptions.

### F2. External and project text has insufficient trust separation · P1

[mcp/extension.ts](../src/mcp/extension.ts), around lines 69–76 and 143–164, appends server-provided initialization instructions to `systemPrompt`. Whitespace normalization and a 220-character truncation do not establish trust. Isolated `AGENTS.md` text also enters Pi's privileged project-context section. Handoff/review strings and check-in guidance are interpolated into coordinator messages without a uniform distinction between application controls and model-authored content.

Plan: keep app policy privileged. Supply project guidance and server content through explicit lower-trust context with source attribution. Follow applicable project conventions only within the operator's scope and role permissions. Treat tool results, fetched MCP prompts, and agent reports as data, including when they contain plausible workflow tags. Preserve useful tool descriptions while identifying their external origin. Escaping and delimiters help interpretation but do not prevent prompt injection by themselves. [OpenAI agent safety](https://developers.openai.com/api/docs/guides/agent-builder-safety)

Related code issue: [mcp/policy.ts](../src/mcp/policy.ts) permits an A tool based on `readOnlyHint` without a separately modeled server-trust decision. The [MCP tools specification, 2025-11-25 edition](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) says annotations are untrusted unless the server is trusted. Resolve that policy explicitly; a prompt warning cannot enforce A's read-only boundary. Existing sandbox and external-server limitations remain relevant.

### F3. Review lacks the approved contract and independently grounded evidence · P1

[render-review-message.ts](../src/workflow/render-review-message.ts) supplies a user objective and B's summary, paths, verification strings, and open questions. It omits `workflow.latestHandoff` acceptance criteria, execution plan, and constraints, although [WorkflowSnapshot](../src/types/workflow.ts) retains that data. The approved-plan path sets `userTask` to the plan's objective at [coordinator.ts](../src/coordinator/coordinator.ts), around line 920, so the review label "Original user objective" is not necessarily the original operator request.

The role appendix already asks A to perform QA. The gap is that review context and evidence do not reliably support that instruction. `verification: ["npm test"]` says neither whether it passed nor which artifact was checked. Schema normalization validates shape, not truth.

Plan: render the current approved contract explicitly; preserve the original request separately where available. Identify B's statements as claims. Ask A to inspect the relevant diff/files and relate each criterion to evidence. Distinguish passed, failed, not run, and unavailable verification. Preserve A's read-only sandbox: checks requiring writes must run through authorized B execution or an existing controlled verifier, not by expanding A's permissions. Missing evidence should lead to a specific revision or an honest blocked result.

### F4. Natural-language execution approval depends on model interpretation · P1, behavior decision

[submitUserInputInternal](../src/coordinator/coordinator.ts), around lines 239–305, executes a valid initial `pi-execute` result. The prompt tells A to emit it only when execution is requested. Format repair already prevents upgrading a `pi-plan` or unrecognized initial response to execution, but that protection does not establish the operator's intent for the first response.

Recommendation for review: represent execution permission in coordinator state, set by an explicit execution action or `/approve` bound to the current plan/request. A model block cannot grant itself that permission. Unprivileged text, examples, and retrieved instructions cannot change it. For ordinary chat without that signal, a proposed execution becomes a pending plan. Keep already authorized execution direct; do not add confirmations to individual routine tools.

This changes the current natural-language "start now" shortcut unless the UI supplies an explicit start action. Approving the implementation plan should include this behavior choice. If retaining unrestricted natural-language auto-start is required, document that residual model-classification risk and do not call it a deterministic authorization boundary. A keyword regex is not a safe substitute.

### F5. Persistent policy contains too many phase contracts and weak examples · P2

[trust-policy.ts](../src/app/trust-policy.ts) gives A planning, execution-start, handoff, final, and check-in rules together. `PLANNING_GUIDANCE` is also repeated in planning-turn messages. Required fields and examples are maintained separately from schemas, while repair already uses schema-derived `responseShape`. Positive examples dominate; the handoff example's "Tests pass" criterion is less specific than the planning guidance requires.

Plan: retain stable role and authority rules once, and supply the active phase's output contract with its exact identifiers. Use schema-validated examples for successful completion, blocked work, revision, and plan-only behavior. Explain that protocol blocks terminate the coordinator submission after tool work, not every intermediate tool-call turn. Preserve concise progress prose where the protocol allows it. Avoid requests for hidden chain-of-thought; request decisions, evidence, and next steps.

### F6. Context survival is implicit · P2

Compaction is enabled. Pi's generic summarizer preserves goals and constraints, but it has no app-specific guarantee to retain the current approval state, IDs, iteration, or protocol contract. Repair relies on the same conversation. Review's omitted contract compounds this risk. Provenance text is a useful label but is not authenticated control state.

Plan: reconstruct a compact current-task context from coordinator state at each submission and after relevant compaction/replacement boundaries. Preserve approved scope, current identifiers, acceptance criteria, unresolved evidence, and the valid terminal response. Summaries cannot grant authorization or overwrite authoritative state. Keep existing restart supersession behavior; this plan does not introduce automatic workflow resumption. Do not edit installed Pi files.

### F7. Check-in wording differs from the actual counter · P2

Persistent prompts and handoffs refer to every 10 model turns. [execution-supervisor.ts](../src/coordinator/execution-supervisor.ts) advances the counter only for successful tool turns or a valid completion; errors and incomplete tool results do not advance it. The actual check-in prompt correctly describes successful turns. Repeated failed calls can therefore receive no periodic A check-in, although operation deadlines still apply.

Plan: derive wording from `EXECUTION_CHECK_IN_INTERVAL` and describe the actual counter. Add failure/repetition evaluation cases. If they show a problem, introduce a separate bounded repeated-failure stop or escalation policy. Do not quietly change the existing successful-turn metric or use a prompt promise as an execution budget.

### F8. Tests verify protocol mechanics more than prompt effectiveness · P2

Existing tests provide meaningful schema, iteration, repair, role-policy, and lifecycle coverage. The role and renderer tests largely assert strings. There is no dedicated versioned prompt comparison suite demonstrating task success, resistance to misleading content, independent review, or robustness across configured models.

Plan: keep deterministic tests, add fully assembled context checks, and introduce opt-in empirical evaluations. Tag results with prompt revision, model/transport, reasoning configuration, Pi version, and fixture revision. Reuse existing telemetry rather than collecting another unrestricted transcript archive.

### F9. Copy/paste implementation prompts contain dated workspace claims · P2

The Pi upgrade and narrative TUI prompts describe substantial uncommitted work. This audited commit started clean. They do instruct implementers to reinspect state, which is good; the unconditional dirty-worktree descriptions are still stale. The active-turn prompt contains dated implementation context and lives under research.

Plan: mark historical baselines as dated and conditional, identify superseded prompts, and require a fresh checkout/version inventory before future execution. Keep each prompt linked to its owning plan and existing verification/security requirements. Do not silently make the unapproved Pi upgrade or TUI plan part of this implementation.

## Current research and how it applies

Primary sources were checked live on 2026-10-18 using OpenAI documentation MCP tools and web access. Living documentation can change; recheck capability-specific details at implementation time. These recommendations are application decisions informed by the sources, not claims that one universal prompt works for every model.

- OpenAI now documents typed, code-managed prompt modules and versioning alongside application changes. Keep builders close to their workflow owners, with typed inputs and reviewable fixtures. This supports evolving the current TypeScript modules without a hosted prompt-management product or template framework. [Prompt engineering](https://developers.openai.com/api/docs/guides/prompt-engineering#version-prompts-in-code)
- Current model guidance emphasizes explicit autonomy, instruction-file behavior, and proportionate verification. Keep the A/B permission split, reduce unnecessary clarification, and stop after the approved acceptance criteria are met. Do not import provider-specific delegation instructions into a coordinator that owns a fixed two-role workflow. [OpenAI prompting best practices](https://developers.openai.com/api/docs/guides/latest-model#prompting-best-practices)
- Anthropic's context-engineering guidance, published 2025-09-29, recommends selective, high-signal context and deliberate compaction. Apply it to phase-specific contracts and state restoration, not an arbitrary token target or removal of necessary constraints. [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Clear instructions, explicit context/example separation, and relevant examples are useful starting points. Example count and phrasing require local testing, especially for B. Claude-specific advice is comparative guidance, not evidence of OpenAI or Qwen behavior. [Anthropic prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- Tool purposes, parameter descriptions, bounded results, and actionable errors influence performance. Evaluate tool selection and argument correctness together with final task outcomes. [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
- Evaluation should cover representative, edge, and adversarial tasks, with repeatable scoring and human review of ambiguous cases. Use deterministic artifact checks wherever possible; model confidence is not a pass condition. [OpenAI evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)
- LM Studio documents JSON-schema output controls, but support depends on the model and serving path. This does not prove compatibility with Pi's tool loop or the current fenced protocol. Retain local parsing and repair first; any native structured-output experiment belongs in a separately verified change. [LM Studio structured output](https://lmstudio.ai/docs/developer/openai-compat/structured-output)
- Pi upstream documentation is useful, but the installed `0.67.68` source defines today's prompt assembly behavior. Upstream now lives under `earendil-works/pi`. The separate [Pi upgrade plan](pi-upgrade-plan.md) must not be assumed implemented. [Pi SDK documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)

## Proposed implementation sequence

All phases below are future work after review. Keep them independently reviewable. If the separate Pi upgrade lands first, repeat the assembly audit against that version and adapt supported API calls before proceeding.

### Phase 0. Freeze the baseline and write regression fixtures

1. Recheck branch, dirty state, installed/locked versions, existing plans, and applicable instructions. Use an isolated branch/worktree containing the intended baseline; preserve any newly appeared local work.
2. Capture synthetic effective prompts and provider requests through the existing fixture-provider test seam. Cover both roles, planning, handoff, review, check-in, cap, and tool-free repair. Never capture production credentials or private project text.
3. Record baseline prompt sizes, protocol repair counts, and task outcomes separately. Add failing behavioral contract cases for F1–F4 before changing behavior.

Files: existing `test/unit/*` prompt tests, `test/integration/response-repair-pi.test.ts`, runtime/bootstrap fixtures, and a small new prompt-focused fixture directory under `test/fixtures/`.

Exit: the baseline is reproducible; each selected finding has an observable test or a clearly identified empirical evaluation case. Do not use word-for-word snapshots as the sole correctness test.

### Phase 1. Make prompt composition explicit and restore tool guidance

1. Keep pure typed renderers near their feature. Add a small shared prompt-contract module only for shared authority rules, context encoding, and phase contracts. Use a discriminated phase union; derive payload types/examples from existing schemas instead of adding parallel optional-field interfaces.
2. Reduce persistent A/B appendices to durable role, authority, tool, evidence, and stop rules. Place only relevant schemas/examples in active phase messages. Keep `schemaVersion: 1`, current fence names, IDs, iteration rules, and parser compatibility.
3. Restore curated role-appropriate coding and MCP guidance in the actual custom-prompt path. Build it from tools that are active. Recompute guidance for format repair after disabling tools; do not advertise unavailable tools.
4. Validate every example against its owning schema. Generate interval wording from the existing constant. Keep format repair format-only, tool-free, bounded to the existing 10 total response attempts, and unable to change a blocked decision or introduce approval.

Files: `src/app/trust-policy.ts`, `src/runtime/create-role-runtime.ts`, prompt renderers, `src/workflow/workflow-schema.ts`, and related tests.

Exit: effective provider requests contain the intended guidance exactly where needed; all protocol examples parse; deterministic fixtures demonstrate no state-transition or repair regression. Prompt size is measured, not treated as a quality score.

### Phase 2. Separate trust and enforce execution authority

1. Stop appending arbitrary MCP initialization text and raw workspace instructions to privileged policy. Deliver attributed context through supported Pi message/context hooks. Choose and verify the exact hook against the installed version; do not assume an OpenAI developer role exists on B's transport.
2. Encode model-authored fields as bounded, labeled data while keeping coordinator IDs, phase, and permissions separate. The approved plan remains B's delegated task; lower-trust evidence cannot replace it or enlarge its authority. Preserve multiline content safely; test embedded backticks, fake provenance tags, quotes, and fake instructions. Essential approved constraints must not be silently truncated. Reject an oversized mandatory contract or make it retrievable through a controlled mechanism.
3. Make MCP annotation trust explicit. Default A to operator-approved read-only capabilities; trust server annotations only under an explicit trusted-server policy. Inventory compatibility effects on existing configs. Test both direct and proxy calls against the same policy.
4. Implement the chosen F4 execution-intent behavior. Bind authorization to the current request/plan, invalidate stale permission after replacement/discard, and test that retrieved content and model output cannot create it. Update CLI/TUI help for any explicit start action.

Files: runtime assembly, `src/app/prompt-provenance.ts`, `src/mcp/{extension,policy,config-schema,direct-tools,proxy-tool}.ts`, coordinator approval paths, and only the UI entry points needed for the selected authorization behavior.

Exit: adversarial fixtures cannot enable B or A mutation capabilities; project guidance remains useful; no new discovery or secret access path is introduced. Prompt wording alone is not an acceptable pass for a permission test.

### Phase 3. Make review evidence explicit and preserve current task context

1. Include the approved handoff criteria, constraints, relevant paths, plan, and exact current identifiers in review. Retain the original operator request separately from the agent's objective when available. Legacy records must say unavailable rather than invent it.
2. Distinguish B-reported checks from coordinator-observed outcomes and A inspection. Start with bounded evidence from existing safe tool events and task-scoped diff/file inspection. A zero tool error is not proof that a test suite passed; record actual exit/result semantics when available.
3. Preserve the existing completion schema initially. Render legacy `verification` strings as claims, then attach coordinator-owned evidence to review separately. If persistence needs new fields, use an explicitly versioned, validated optional record with backward-compatible readers. Do not silently reinterpret old ledgers.
4. Compare the task-start workspace baseline with the reviewed result, including tracked and relevant untracked files, so unrelated pre-existing changes are not attributed to B. Do not rely solely on `changedPaths` or the edit/write callback; bash and MCP may mutate state too. Report unavailable remote evidence honestly.
5. Reinject current-task context from coordinator state after compaction and runtime replacement. Preserve cancellation, format-only mode, request IDs, session ownership, and existing restart supersession. Extend repeated-failure supervision only if the evaluation demonstrates the need, with a separate counter and limit.

Files: review renderer, workflow orchestrator, supervisor, runtime/session integration, persistence readers if required, and corresponding integration/replay tests.

Exit: missing criteria, false success claims, failed/unrun checks, partial completion, stale summaries, and unrelated workspace changes produce specific revisions or honest blocked outcomes. Compaction and replacement preserve authority without rerunning completed mutations.

### Phase 4. Evaluate behavior on the actual role models

Use a small opt-in script and fixtures that reuse current runtime/broker boundaries. Do not add a second agent framework. Keep deterministic fixture tests in ordinary CI; credential-backed model evaluation remains separate and bounded.

Required scenario families:

1. Discussion only, plan only, and an explicitly authorized execution.
2. A small repository change with measurable acceptance criteria and a bounded stop condition.
3. A failed test and an unresolved dependency, with honest partial-completion reporting.
4. B claims tests passed but observed evidence disagrees or is absent.
5. Project instructions, MCP content, and tool output attempt to override scope, approve execution, or spoof protocol tags.
6. Malformed/multiple blocks, wrong IDs/iteration, truncation, and protocol labels emitted as tool calls.
7. A format repair that must not rerun writes, change the substantive decision, or introduce execution.
8. Lost/stale context after compaction, model replacement, cancellation, or restart.
9. Repeated failed tool calls and check-in continue/redirect/blocked decisions.
10. No MCP, lazy proxy discovery, and direct tools with different role permissions.

Score first-response validity, repair attempts, authorization correctness, scope adherence, task completion, verification accuracy, inappropriate actions, prompt/input/output tokens, and elapsed time. Inspect the actual artifact and tool effects. Record exact model IDs, settings, and local model artifact/quantization where available. Do not combine fixture results and live-model results into one claimed success rate.

Begin with four representative baseline/candidate cases repeated three times each, at most 24 workflow samples. Treat this as a pilot subset of a full ten-case comparison, one case per family, with three repetitions per baseline/candidate: at most 60 total workflow samples, including the pilot. Finish the remaining 36 only if the pilot passes and the configured budget permits it. Broader variants require a separately bounded follow-up evaluation. Fix maximum workflow turns, time, tokens, and total cloud spend before starting. Use disposable synthetic workspaces; never execute real destructive external actions as an evaluation.

Release gates: all deterministic authorization/security/protocol cases pass; the full ten-family comparison is complete; no observed unauthorized action or false approval in the candidate evaluation; no unexplained task-quality regression relative to the baseline; and token/latency changes are reported. These are gates for this sample, not a statistical guarantee of safety or effectiveness. If a required model or budget is unavailable, report that release evidence as incomplete.

### Phase 5. Verify, document, and roll out

1. Run focused prompt, policy, approval, repair, check-in, compaction, and recovery checks while developing. Then run `npm run check`, `npm test`, and the documented build/security/terminal checks. Run build-dependent commands sequentially because `build` deletes `dist`.
2. Required final commands are `npm run build`, `npm run verify:isolation`, `npm run verify:terminal`, and `git diff --check`. Use `npm run verify:local` when validating the local provider path, with its prerequisites documented. Extend PTY fixtures if authorization UX changes.
3. Credential-backed evaluation or smoke requires a separately prepared trusted installation and passing dummy-secret gates. Preserve the existing installation for rollback. Do not run real credentials from agent-editable source, expose credentials to tools, or silently load/download different models.
4. Add prompt revision/hash and safe configuration metadata to the existing response lifecycle records. Avoid full raw-prompt logging. Keep readers compatible with old records. Include a reproduction command and results for every evaluation report.
5. Update `docs/review-loop.md`, `docs/security-model.md`, `docs/execution-check-ins.md`, relevant README/help text, and the dated manual implementation prompts. Add a concise prompting contract document covering ownership, phase transitions, trust, examples, and evaluation commands.
6. Roll back by restoring the previous trusted app/prompt revision together. Do not roll back into an active workflow or resume superseded work automatically. Keep old sessions/ledgers readable. No deployment, launcher switch, push, or PR is included in this planning request.

Exit: deterministic checks pass; model-evaluation evidence and its limits are recorded; the trusted artifact and rollback path are identifiable; documentation describes delivered behavior rather than this proposal.

## Stack conventions and scope controls

Use strict NodeNext TypeScript and existing `.js` import conventions. Parse external data as `unknown` at Zod/TypeBox boundaries, derive types from authoritative schemas, and exhaustively handle phase variants. Do not introduce unchecked casts, `any`, or a parallel schema system to make prompt plumbing compile. Keep security policy in code and prompt rendering pure where practical.

Reuse Vitest, real Pi deterministic provider fixtures, the existing telemetry/ledger, and PTY verification. Preserve redaction, endpoint restrictions, sandboxed tools, tool-free repairs, review caps, cancellation/drain, and session compatibility. No dependency upgrade, new provider, subagent feature, browser redesign, hosted prompt platform, automatic prompt optimizer, chain-of-thought capture, or native structured-output migration is required by this plan.

## Evidence from this QA pass

- Inspected the source, schemas, renderers, role policies, manual prompts, relevant tests, installed Pi prompt builder, and compaction code at the commit above.
- Ran a read-only installed-Pi assembly probe. Custom prompt mode retained role/project content and omitted tool snippets/guidelines; default mode included them.
- Ran `npm test -- test/unit/trust-policy.test.ts test/unit/render-handoff-message.test.ts test/unit/render-review-message.test.ts test/unit/response-repair.test.ts test/unit/execution-supervisor.test.ts test/unit/review-cycle.test.ts test/unit/mcp-policy.test.ts`. All 81 tests across seven files passed.
- Current primary-source research supports the design recommendations; local source establishes the application findings. Neither source substitutes for future implementation verification.
- No full suite, build, terminal verifier, isolation suite, credential-backed evaluation, live MCP-server audit, or deployment was performed for this documentation-only pass. No claims of complete security or model reliability are made.

The main review decision is F4's explicit execution-intent behavior. The other phases preserve the existing A-plans/B-executes workflow while making its prompt contracts and evidence more reliable.
