# pi-dual-agent-coordinator

Coordinator-driven dual-agent workflow engine built on the Pi SDK.

This project runs two isolated Pi runtimes under one coordinator:

- Agent A is the planner, reviewer, and final sign-off model.
- Agent B is the execution model and the only agent allowed to make changes.
- The coordinator handles the handoff loop, review cap, and workflow persistence.

This repo is meant to be usable by people who want a practical local agentic tool, not just by people who want to study the code. The recommended onboarding path is the built-in `setup` wizard. If you want a local Agent B, you still need to point Pi at your local model app yourself.

## Quick start

### 1. Requirements

- Node.js `>=20.6.0`
- npm
- A working Pi-compatible environment
- Either:
  - ChatGPT Plus/Pro with Codex subscription access
  - OpenAI Platform API access with an API key
- Optional: a local OpenAI-compatible model endpoint for Agent B

Examples in this README use:

- Agent A subscription preset: `openai-codex/gpt-5.4`
- Agent A API preset: `openai/gpt-5.4`
- Agent B: `local-qwen/qwen3-coder-next`

### 2. Download and install

Clone the repo or download it as a ZIP from GitHub, then open a terminal in the project folder and run:

```bash
npm install
```

`npm install` builds the project automatically. You do not need to run a separate build step for normal use.

If you use `nvm`, the repo includes [.nvmrc](./.nvmrc).

### 3. Run the guided setup wizard

Pi uses its standard agent directory. On macOS and Linux that is usually `~/.pi/agent/`.

Run the wizard from this repo:

```bash
npm run setup -- .
```

The wizard walks you through Agent A auth and saves a default model for future runs.

It offers two first-class Agent A paths:

- `openai-codex`: ChatGPT Plus/Pro subscription login in the browser
- `openai`: OpenAI Platform API key setup

What the wizard writes:

- Pi credentials stay in Pi's standard `auth.json`
- Coordinator-owned defaults go in `~/.pi/dual-agent-coordinator/config.json`

If the browser does not open during ChatGPT subscription login, the terminal also prints the URL and lets you paste the redirect URL or code back manually.

If you later want to switch Agent A from subscription to API key, or back again, run:

```bash
npm run auth -- .
```

### 4. Optional: configure a local or custom Agent B

If you want Agent B on a local OpenAI-compatible model endpoint, add a Pi `models.json` file. Starter templates live here:

- [examples/pi-agent/models.lm-studio.json](./examples/pi-agent/models.lm-studio.json)
- [examples/pi-agent/models.ollama.json](./examples/pi-agent/models.ollama.json)

Before you run the coordinator, verify the exact model id returned by your local server:

```bash
curl http://127.0.0.1:1234/v1/models
```

If your local app uses a different port or URL, use that instead.

### 5. Run the setup check

This validates Node.js, your Pi auth state, your saved coordinator defaults, optional model ids you plan to use, and any MCP config files:

```bash
npm run doctor -- .
```

If you want to force explicit models for one run, you still can:

```bash
npm run doctor -- . \
  --model-a openai-codex/gpt-5.4 \
  --model-b local-qwen/qwen3-coder-next
```

If something is missing, `doctor` tells you exactly what to fix and which command to run next.

### 6. Start the coordinator

```bash
npm run repl -- .
```

On a TTY, `repl` launches the full-screen TUI by default. If you need the plain shell fallback, add `--plain`.

The saved Agent A default from `setup` is used automatically when `--model-a` is omitted.

If you want to override either model explicitly for one run:

```bash
npm run repl -- . \
  --model-a openai/gpt-5.4 \
  --model-b local-qwen/qwen3-coder-next \
  --thinking-a high \
  --thinking-b off \
  --max-review-rounds 3
```

To launch the terminal UI from any project directory, link the local binary once:

```bash
cd /absolute/path/to/pi-dual-agent-coordinator
npm link
```

Then from any project:

```bash
pi-dual repl .
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
    npm run repl -- "$project" "$@"
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
- `npm run setup -- .`: guided first-run auth and defaults
- `npm run auth -- .`: switch or repair Agent A auth/defaults
- `npm run doctor -- .`: validate setup with saved defaults
- `npm run repl -- .`: start the REPL with saved defaults
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

- Browser did not open during ChatGPT login: rerun `npm run auth -- .`, then open the printed URL manually.
- OAuth callback failed: rerun `npm run auth -- .` and paste the redirect URL or code into the terminal when prompted.
- You want to switch from ChatGPT subscription to API key, or back again: run `npm run auth -- .`.
- You already have both `openai` and `openai-codex` configured: that is fine. The saved coordinator default decides which one `pi-dual repl` uses when `--model-a` is omitted.
- `doctor` fails on `auth.json`: the recommended fix is `npm run setup -- .` or `npm run auth -- .`. Use [examples/pi-agent/auth.json.example](./examples/pi-agent/auth.json.example) only if you want the advanced manual path.
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

## Project scope

The main branch contains the terminal UI and plain terminal fallback. The browser interface,
including its in-progress changes, is preserved on `feature/browser-experience`.
See [TERMINAL_EXPERIENCE_PLAN.md](./TERMINAL_EXPERIENCE_PLAN.md) for the terminal work plan.

## Additional docs

- [docs/review-loop.md](./docs/review-loop.md): workflow lifecycle, machine block schemas, provider compatibility notes, and troubleshooting
- [docs/handoff-state-machine.md](./docs/handoff-state-machine.md): workflow state transitions and replay behavior
- [docs/architecture-decisions.md](./docs/architecture-decisions.md): design rationale and system boundaries
- [CONTRIBUTING.md](./CONTRIBUTING.md): local setup, validation, and pull request expectations
- [docs/security-model.md](./docs/security-model.md): role separation and trust boundaries
- [docs/implementation-backlog.md](./docs/implementation-backlog.md): future work
