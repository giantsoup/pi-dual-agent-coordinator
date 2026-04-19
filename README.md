# pi-dual-agent-coordinator

Coordinator-driven multi-model workflow engine built on the Pi SDK.

## What it does

- Runs two isolated Pi runtimes under one coordinator.
- Keeps Agent A read-only for planning, review, and final sign-off.
- Keeps Agent B as the only write-authoritative execution model.
- Executes one automatic capped workflow per REPL task:
  `user -> A plan/final -> B execute -> A review -> ... -> A final`
- Persists workflow records in an append-only ledger and reconstructs state after restart.

## Current scope

- REPL-only operator UX
- Automatic review loop with a configurable round cap
- Durable workflow replay and restart recovery
- Runtime rebinding for Agent A and Agent B

## Requirements

- Node.js `>=20.6.0`
- A Pi-compatible agent environment
- An OpenAI model for Agent A
- An OpenAI-compatible local model endpoint for Agent B if you want mixed-model execution

## Install

```bash
npm install
npm run build
```

The package exposes a `pi-dual` binary after build, but running `node dist/src/index.js` works the same way during development.

## Repository layout

```text
docs/
  architecture-decisions.md
  handoff-state-machine.md
  implementation-backlog.md
  review-loop.md
src/
  app/
  coordinator/
  handoff/
  persistence/
  runtime/
  telemetry/
  tools/
  types/
  workflow/
test/
  fixtures/
  integration/
  replay/
  unit/
```

## Model roles

- Agent A should be the stronger planning and review model.
- Agent B should be the cheaper execution model.
- Agent A owns termination and the final user-facing response.
- Agent B never terminates the workflow directly.

This repository was built around the following practical setup:

- Agent A: `openai/gpt-5.4`
- Agent B: local `qwen3-coder-next` exposed through LM Studio or another OpenAI-compatible endpoint

## Configure authentication

Pi reads auth from `~/.pi/agent/auth.json`.

If your shell already exports `OPENAI_API_KEY`, point Pi at that environment variable:

```json
{
  "openai": { "type": "api_key", "key": "OPENAI_API_KEY" }
}
```

If you prefer to store a literal key in the auth file, use:

```json
{
  "openai": { "type": "api_key", "key": "sk-..." }
}
```

## Configure models

Pi reads model/provider definitions from `~/.pi/agent/models.json`.

### LM Studio example

If LM Studio is serving an OpenAI-compatible API on `http://127.0.0.1:1234/v1`, use:

```json
{
  "providers": {
    "local-qwen": {
      "baseUrl": "http://127.0.0.1:1234/v1",
      "api": "openai-completions",
      "apiKey": "lm-studio",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false
      },
      "models": [
        {
          "id": "qwen3-coder-next",
          "name": "Qwen3 Coder Next (LM Studio)",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 128000,
          "maxTokens": 16384,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
```

Verify the exact local model id before running the coordinator:

```bash
curl http://127.0.0.1:1234/v1/models
```

If the server returns a different id, update both `models.json` and `--model-b` to use that exact id.

### Ollama-style example

If your local server exposes an OpenAI-compatible endpoint on `http://localhost:11434/v1`, the same shape works with a different base URL and API key placeholder:

```json
{
  "providers": {
    "local-qwen": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false
      },
      "models": [
        {
          "id": "qwen3-coder-next",
          "name": "Qwen3 Coder Next (Local)",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 128000,
          "maxTokens": 16384,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
```

Provider quirks belong in `models.json`, not in coordinator logic. Common compatibility flags include:

- `supportsDeveloperRole: false`
- `supportsReasoningEffort: false`
- `supportsStrictMode: false`
- `maxTokensField: "max_tokens"`
- `thinkingFormat: "qwen"` or `"qwen-chat-template"`

## Run the REPL

Recommended mixed-model command:

```bash
node dist/src/index.js repl ~/Sites/print-for-me \
  --model-a openai/gpt-5.4 \
  --model-b local-qwen/qwen3-coder-next \
  --thinking-a high \
  --thinking-b off \
  --max-review-rounds 3
```

Equivalent binary form:

```bash
pi-dual repl ~/Sites/print-for-me \
  --model-a openai/gpt-5.4 \
  --model-b local-qwen/qwen3-coder-next \
  --thinking-a high \
  --thinking-b off \
  --max-review-rounds 3
```

Useful flags:

- `--model-a MODEL`
- `--model-b MODEL`
- `--thinking-a off|low|medium|high`
- `--thinking-b off|low|medium|high`
- `--max-review-rounds N`
- `--agent-dir PATH`
- `--session-root PATH`
- `--no-session`
- `--json-logs`
- `--verbose`

Defaults:

- `--max-review-rounds` defaults to `3`
- Agent A defaults to `high` thinking if not overridden
- Agent B defaults to `medium` thinking if not overridden

Quick smoke test without persisted sessions:

```bash
node dist/src/index.js repl . --no-session
```

## REPL behavior

- Each submitted task blocks until the full workflow finishes.
- Agent A may terminate immediately with `pi-final` if no execution work is needed.
- Otherwise Agent A emits `pi-handoff`, Agent B executes and emits `pi-completion`, and Agent A either finalizes or issues the next handoff.
- The printed final answer always comes from Agent A’s `pi-final.userResponse`.
- One deterministic repair prompt is allowed for each malformed or missing machine block before the workflow is blocked.
- If Agent A still requests more execution work after the round cap, the coordinator forces a terminal blocked finalization path.

Useful REPL commands:

- `/status` shows the active workflow id, iteration, workflow status, runtime bindings, last completion summary, and repair count.
- `/sessions` shows the active session metadata for roles `A` and `B`.
- `/handoff` shows workflow-level state plus the latest persisted records.
- `/new A` or `/new B` creates a fresh session for one role.
- `/switch A <session-path>` or `/switch B <session-path>` rebinds a role to an existing session file.
- `/quit` exits cleanly.

## Workflow and recovery

Each user task becomes a workflow with a stable `workflowId`. Each Agent B execution round has its own `iteration`.

The append-only ledger records workflow progress using these categories:

- `prepared`
- `delivered`
- `completed`
- `finalized`
- `blocked`
- `capped`
- `repair_requested`
- `superseded`

Recovery replays the ledger in order and reconstructs the latest workflow snapshot. A truncated final JSONL line is ignored during replay.

Operationally important recovery behavior:

- If restart recovery leaves a workflow active, the coordinator refuses to start a new task until that workflow is cleared.
- Rebinding either runtime with `/new` or `/switch` supersedes the active workflow and records that invalidation durably.

## Development

```bash
npm run check
npm test
npm run build
```

## Troubleshooting

- Agent B fails immediately: verify the local provider base URL and model id returned by `/v1/models`.
- Local model ignores reasoning settings: set `supportsReasoningEffort: false` in `models.json`.
- Local model mishandles developer messages: set `supportsDeveloperRole: false`.
- Workflow blocks after malformed machine output: inspect the latest `/handoff` state and confirm the model is returning exactly one fenced machine block at `turn_end`.
- A recovered workflow prevents a new task: either finish that workflow or explicitly supersede it by rebinding Agent A or Agent B.

## Additional documentation

- [docs/review-loop.md](./docs/review-loop.md): workflow lifecycle, machine block schemas, provider compatibility notes, and troubleshooting
- [docs/handoff-state-machine.md](./docs/handoff-state-machine.md): workflow state transitions and replay behavior
- [docs/architecture-decisions.md](./docs/architecture-decisions.md): design rationale and system boundaries
