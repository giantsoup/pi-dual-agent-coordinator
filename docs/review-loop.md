# Review Loop

## Lifecycle

Each execution start becomes a workflow with a stable `workflowId`. Planning-only turns stay outside the workflow ledger until Agent A explicitly starts execution.

1. The coordinator begins in planning mode and prompts Agent A with the operator’s input.
2. Agent A may reply with plain prose and no machine block for as many planning turns as needed.
3. When execution should start, Agent A must emit exactly one `pi-execute` block at `turn_end`.
4. The coordinator creates the workflow, persists `prepared`, renders a deterministic B handoff prompt, persists `delivered`, and waits for Agent B.
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

## Compatibility notes

- Model A should remain the higher-quality review/planning model.
- Model B should remain the cheaper execution model.
- Local provider quirks belong in `~/.pi/agent/models.json`, not in coordinator logic.
- OpenAI-compatible local Qwen endpoints work as long as they can follow Pi tool protocol and return stable fenced JSON machine blocks.

Useful provider compatibility flags include:

- `supportsDeveloperRole: false`
- `supportsReasoningEffort: false`
- `supportsStrictMode: false`
- `maxTokensField: "max_tokens"`
- `thinkingFormat: "qwen"` or `"qwen-chat-template"`

## Troubleshooting

- A emits `pi-handoff`, `pi-final`, or `pi-completion` during planning mode: the coordinator sends a planning repair prompt requiring either prose-only output or exactly one valid `pi-execute` block.
- Missing or malformed machine block: the coordinator sends one deterministic repair prompt for the expected block type. If the repair still fails, the workflow is blocked.
- A keeps asking for more work after the cap: the coordinator sends a control prompt requiring `pi-final` with `decision: "blocked"`.
- B cannot follow tool protocol: expect malformed or missing `pi-completion` blocks, repair prompts, and eventually a blocked workflow.
- Restart after interruption: restart recovery replays the ledger and reconstructs the latest non-terminal workflow state.
- Starting fresh after recovery: the coordinator refuses to start a new task while a recovered workflow is still active. Rebinding either runtime supersedes that workflow and records the invalidation durably.
