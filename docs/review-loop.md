# Review Loop

## Lifecycle

Each execution start becomes a workflow with a stable `workflowId`. Successful planning-only turns stay outside the workflow ledger. Failed, cancelled, or timed-out planning requests record their terminal outcome.

1. The coordinator begins in planning mode and prompts Agent A with the operator’s input.
2. Agent A may reply with plain prose and no machine block for as many planning turns as needed.
3. A concrete plan ends with one `pi-plan` block and waits for `/approve`. An explicit request to start immediately may emit one `pi-execute` block at `turn_end`.
4. The coordinator creates the workflow, persists `prepared`, and submits a deterministic B handoff prompt. It records delivery after the runtime returns.
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

Agent A execution start:

````text
```pi-execute
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
- Missing or malformed machine block: the coordinator sends one deterministic repair prompt for the expected block type. If the repair still fails, the workflow is blocked.
- A keeps asking for more work after the cap: the coordinator sends a control prompt requiring `pi-final` with `decision: "blocked"`.
- B cannot follow tool protocol: expect malformed or missing `pi-completion` blocks, repair prompts, and eventually a blocked workflow.
- Restart after interruption: recovery replays the ledger and supersedes unfinished workflows with fresh sessions.
- Viewing or switching saved sessions restores conversation context without resuming coordinator work.
