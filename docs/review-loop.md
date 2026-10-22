# Review Loop

## Lifecycle

Each execution start becomes a workflow with a stable `workflowId`. Successful planning-only turns stay outside the workflow ledger. Failed, cancelled, or timed-out planning requests record their terminal outcome.

1. The coordinator begins in planning mode and prompts Agent A with the operator’s input.
2. Agent A may reply with plain prose and no machine block for as many planning turns as needed.
3. A concrete plan ends with one `pi-plan` block and waits for `/approve`. A legacy `pi-execute` block also becomes a pending plan. Model text or natural-language requests cannot replace `/approve`.
4. After operator `/approve`, the coordinator creates the workflow, persists `prepared`, and submits a deterministic B handoff prompt. It records delivery after the runtime returns.
5. Agent B must emit exactly one `pi-completion` block at `turn_end`.
6. The coordinator persists `completed`, renders a deterministic review prompt for Agent A, and repeats until A emits `pi-final`, a repair fails, or the round cap is reached.
7. If the cap is reached and A still wants more execution work, the coordinator sends a control prompt requiring a terminal blocked `pi-final`.

Workflow ledger record categories:

- `prepared`
- `delivered`
- `completed`
- `finalized`
- `blocked`
- `capped`
- `repair_requested`
- `superseded`
- `cancelled`
- `timed_out`
- `failed`

Recovery replays the append-only JSONL ledger in order and reconstructs the latest workflow snapshot from durable records only. A truncated final JSONL line is ignored during replay.

## Machine blocks

Agent A pending plan (operator `/approve` starts execution):

````text
```pi-plan
{
  "schemaVersion": 1,
  "objective": "Implement the requested change.",
  "summary": "The change is ready for execution.",
  "acceptanceCriteria": ["Tests pass"],
  "relevantPaths": ["src/index.ts"],
  "executionPlan": ["Update the implementation", "Run focused verification"],
  "constraints": ["Do not widen scope"]
}
```
````

For file-free tasks, such as tool inventories, `relevantPaths` may be `[]`.
Acceptance criteria and execution steps must still be nonempty.

Agent A handoff:

````text
```pi-handoff
{
  "schemaVersion": 1,
  "workflowId": "wf-123",
  "handoffId": "handoff-123",
  "iteration": 1,
  "objective": "Implement the requested change.",
  "summary": "Agent B must edit files and verify the result.",
  "acceptanceCriteria": ["Tests pass"],
  "relevantPaths": ["src/index.ts"],
  "reviewNotes": ["Fix the edge case from the previous attempt."]
}
```
````

Agent B completion:

````text
```pi-completion
{
  "schemaVersion": 1,
  "workflowId": "wf-123",
  "handoffId": "handoff-123",
  "iteration": 1,
  "summary": "Implemented the change.",
  "changedPaths": ["src/index.ts"],
  "verification": ["npm test"],
  "openQuestions": ["Manual validation still needed."]
}
```
````

Agent A final:

````text
```pi-final
{
  "schemaVersion": 1,
  "workflowId": "wf-123",
  "iteration": 1,
  "decision": "approved",
  "summary": "The task is complete.",
  "userResponse": "Implemented the requested change and verified it.",
  "changedPaths": ["src/index.ts"]
}
```
````

## Provider and retry policy

The secure runtime uses approved OpenAI Responses models with API-key
authentication. Arbitrary provider endpoints and executable Pi resources remain
disabled. Pi automatic retries are disabled in the secure settings. The
coordinator never reruns a workflow automatically after failure or cancellation.
See [terminal controls](terminal-experience.md) for cancellation and deadline limits.

## Troubleshooting

- A emits `pi-handoff`, `pi-final`, or `pi-completion` during planning mode: the coordinator sends a planning repair prompt requiring prose-only output, one valid `pi-plan` block, or one valid `pi-execute` block.
- Missing or malformed machine block: the coordinator allows ten total response attempts, including the original. Output-only corrections run in a separate formatter using the same role's selected model, with no executable tools. The live role session keeps its authorized tools and conversation; formatting cannot replay completed execution. Exhausted planning fails without starting B; exhausted workflow responses block the workflow.
- A keeps asking for more work after the cap: the coordinator sends a control prompt requiring `pi-final` with `decision: "blocked"`.
- B cannot follow tool protocol: expect malformed or missing `pi-completion` blocks, repair prompts, and eventually a blocked workflow.
- Printed `<tool_call>`, `[TOOL_CALL]` / `[END_TOOL_CALL]`, or `[TOOL_REQUEST]` / `[END_TOOL_REQUEST]` text in an invalid completion is an execution-protocol failure. Detection is case-insensitive and recognizes an opening or closing marker alone. At `turn_end`, the supervisor steers B with tools still enabled, at most twice per handoff and three times per workflow. It never executes printed arguments or replays unknown native outcomes. The same recovery applies to unfinished prose without a completion fence and to invalid completions without native results. Malformed fenced completion reports after native results use the separate formatter. The settled final turn is used after continuation.
- Completion change claims require correlated successful native tool results in the current handoff. Verification requires an observed result, allowing failed checks to reach review. A completion claiming work with zero native results is rejected and uses the same bounded execution recovery as printed tool markup. These failures share the two-per-handoff and three-per-workflow redirect budget. Unsupported claims introduced by the formatter stop the workflow without execution replay. An honest no-action blocker can use empty `changedPaths` and `verification` with `openQuestions`. This minimum evidence gate does not certify each claim; A must inspect actual artifacts and check results.
- Restart after interruption: recovery replays the ledger and supersedes unfinished workflows with fresh sessions.
- Viewing or switching saved sessions restores conversation context without resuming coordinator work.

## Native verification and diagnostic completion

Verification-only handoffs define completion as reporting the observed result,
including nonzero exits. They do not authorize repair. Failed checks cannot satisfy
an implementation requirement that checks pass. Agent A must disclose failed
checks when approving an accurate diagnostic report.

Completed ledger records can contain versioned `details.nativeEvidence` from the
execution supervisor. Review receives correlated call IDs, tool names, native
status, validated shell exits when available, bounded output, and archive references
separately from B's claims. Missing historical metadata remains unknown. Shell
pipeline exits and absent or truncated counts need read-only review. Formatting
cannot resolve causal uncertainty or rerun a check. See the
[verification report](agent-b-reliability-verification.md).
