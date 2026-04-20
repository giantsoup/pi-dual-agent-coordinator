# pi-dual-agent-coordinator

Coordinator-driven dual-agent workflow engine built on the Pi SDK.

This project runs two isolated Pi runtimes under one coordinator:

- Agent A is the planner, reviewer, and final sign-off model.
- Agent B is the execution model and the only agent allowed to make changes.
- The coordinator handles the handoff loop, review cap, and workflow persistence.

This repo is meant to be usable by people who want a practical local agentic tool, not just by people who want to study the code. The setup below assumes you already know how to run your preferred local model app if you want a local Agent B.

## Quick start

### 1. Requirements

- Node.js `>=20.6.0`
- npm
- A working Pi-compatible environment
- An OpenAI model for Agent A
- Optional: a local OpenAI-compatible model endpoint for Agent B

Examples in this README use:

- Agent A: `openai/gpt-5.4`
- Agent B: `local-qwen/qwen3-coder-next`

### 2. Download and install

Clone the repo or download it as a ZIP from GitHub, then open a terminal in the project folder and run:

```bash
npm install
```

`npm install` builds the project automatically. You do not need to run a separate build step for normal use.

If you use `nvm`, the repo includes [.nvmrc](./.nvmrc).

### 3. Create your Pi config files

Pi uses its standard agent directory. On macOS and Linux that is usually `~/.pi/agent/`.

If you are unsure which folder your machine is using, run `npm run doctor -- . --no-mcp` once. It prints the exact Pi agent directory path for your system.

On macOS and Linux, you can create the folder and copy the example files like this:

```bash
mkdir -p ~/.pi/agent
cp examples/pi-agent/auth.json.example ~/.pi/agent/auth.json
cp examples/pi-agent/models.lm-studio.json ~/.pi/agent/models.json
```

Use [examples/pi-agent/models.ollama.json](./examples/pi-agent/models.ollama.json) instead if your local model app exposes an Ollama-style OpenAI-compatible endpoint.

On Windows, create the same files manually in the Pi agent directory printed by `doctor`.

### 4. Fill in the config

`auth.json`

- If you already export `OPENAI_API_KEY` in your shell, leave the example as-is.
- If you prefer a literal key, replace `OPENAI_API_KEY` with your actual key.

Example:

```json
{
  "openai": {
    "type": "api_key",
    "key": "OPENAI_API_KEY"
  }
}
```

`models.json`

- Set the correct `baseUrl` for your local model app.
- Set the correct local model `id`.
- Keep provider compatibility flags in `models.json`, not in coordinator code.

Before you run the coordinator, verify the exact model id returned by your local server:

```bash
curl http://127.0.0.1:1234/v1/models
```

If your local app uses a different port or URL, use that instead.

### 5. Run the setup check

This validates Node.js, the Pi config files, the model ids you plan to use, and any MCP config files:

```bash
npm run doctor -- . \
  --model-a openai/gpt-5.4 \
  --model-b local-qwen/qwen3-coder-next
```

If something is missing, `doctor` tells you exactly what to fix.

### 6. Start the coordinator

```bash
npm run repl -- . \
  --model-a openai/gpt-5.4 \
  --model-b local-qwen/qwen3-coder-next \
  --thinking-a high \
  --thinking-b off \
  --max-review-rounds 3
```

For a quick smoke test without persisted sessions:

```bash
npm run repl -- . --no-session --model-a openai/gpt-5.4 --model-b local-qwen/qwen3-coder-next
```

### 7. Optional: add a `pdual` shell shortcut

If you want the same convenience wrapper used in the local development setup for this repo, add a function like this to your `~/.zshrc`:

```bash
pdual() {
  local project_input="$PWD"
  if [[ $# -gt 0 && "$1" != -* ]]; then
    project_input="$1"
    shift
  fi

  local project
  project="$(cd "$project_input" 2>/dev/null && pwd -P)" || {
    echo "pdual: project path not found: $project_input" >&2
    return 1
  }

  (
    cd /absolute/path/to/pi-dual-agent-coordinator || return 1
    npm run repl -- "$project" \
      --model-a openai/gpt-5.4 \
      --model-b local-qwen/qwen3-coder-next \
      "$@"
  )
}
```

Then reload your shell:

```bash
source ~/.zshrc
```

Examples:

```bash
pdual
pdual ~/Sites/my-project
pdual ~/Sites/my-project --thinking-b off --max-review-rounds 3
```

Replace `/absolute/path/to/pi-dual-agent-coordinator` with the location where you downloaded this repo, and adjust `--model-a` / `--model-b` if you use different models.

## Everyday commands

- `npm start -- --help`: show top-level CLI help
- `npm run doctor -- . --model-a ... --model-b ...`: validate setup
- `npm run repl -- . --model-a ... --model-b ...`: start the REPL
- `npm test`: run the test suite
- `npm run check`: run the TypeScript checker

The local binary is also available as `pi-dual` after install, so `npx pi-dual --help` works too.

## REPL basics

Inside the REPL:

- Plain text talks to Agent A in planning mode.
- If Agent A proposes a pending plan, run `/approve` to start execution.
- Agent B performs the execution work automatically.
- Agent A reviews the result and either finalizes or sends another handoff.

Useful slash commands:

- `/help`
- `/status`
- `/approve`
- `/discard`
- `/sessions`
- `/handoff`
- `/new A`
- `/new B`
- `/switch A <session-path>`
- `/switch B <session-path>`
- `/quit`

## Config examples

Starter templates live here:

- [examples/pi-agent/auth.json.example](./examples/pi-agent/auth.json.example)
- [examples/pi-agent/models.lm-studio.json](./examples/pi-agent/models.lm-studio.json)
- [examples/pi-agent/models.ollama.json](./examples/pi-agent/models.ollama.json)
- [examples/project/.mcp.json.example](./examples/project/.mcp.json.example)

## MCP support

MCP is enabled by default.

Discovery order:

1. `<agentDir>/mcp.json`
2. `<cwd>/.mcp.json`
3. each `--mcp-config PATH` in the order provided

Later sources override earlier ones by server name.

Standard `.mcp.json` files work directly. App-specific coordinator settings belong under `x-pi-dual`.

Example project config:

```json
{
  "mcpServers": {
    "laravel-boost": {
      "command": "php",
      "args": ["artisan", "boost:mcp"],
      "x-pi-dual": {
        "directTools": true,
        "lifecycle": "lazy",
        "idleTimeoutMinutes": 10,
        "roles": {
          "A": {
            "allowTools": ["search-docs"]
          }
        }
      }
    }
  }
}
```

## Troubleshooting

- `doctor` fails on `auth.json`: copy [examples/pi-agent/auth.json.example](./examples/pi-agent/auth.json.example) to `~/.pi/agent/auth.json`.
- `doctor` fails on `models.json`: copy one of the model templates from [examples/pi-agent](./examples/pi-agent/) and update the URL and model id.
- Agent B fails immediately: confirm the local provider URL and model id from `/v1/models`.
- Local model ignores reasoning settings: set `supportsReasoningEffort: false` in `models.json`.
- Local model mishandles developer messages: set `supportsDeveloperRole: false` in `models.json`.
- A recovered workflow blocks a new task: finish it or supersede it by rebinding Agent A or Agent B with `/new` or `/switch`.
- You want to disable MCP for one run: add `--no-mcp`.

## Development

```bash
npm run check
npm test
npm run build
```

For the same verification used in CI:

```bash
npm run ci
```

## Additional docs

- [docs/review-loop.md](./docs/review-loop.md): workflow lifecycle, machine block schemas, provider compatibility notes, and troubleshooting
- [docs/handoff-state-machine.md](./docs/handoff-state-machine.md): workflow state transitions and replay behavior
- [docs/architecture-decisions.md](./docs/architecture-decisions.md): design rationale and system boundaries
- [CONTRIBUTING.md](./CONTRIBUTING.md): local setup, validation, and pull request expectations
- [docs/security-model.md](./docs/security-model.md): role separation and trust boundaries
- [docs/implementation-backlog.md](./docs/implementation-backlog.md): future work
