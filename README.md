# pi-dual-agent-coordinator

Coordinator-driven dual-agent workflow engine built on the Pi SDK.

This project runs two isolated Pi runtimes under one coordinator:

- Agent A is the planner, reviewer, and final sign-off model.
- Agent B is the execution model and the only agent allowed to make changes.
- The coordinator handles the handoff loop, review cap, and workflow persistence.

Agent A uses OpenAI project API-key authentication. Agent B runs locally through
LM Studio. Cloud credentials live in macOS Keychain behind a trusted broker.
Agent tools and stdio MCP servers run in
an OS sandbox. Read [the security model](docs/security-model.md) before use.

## Secure setup

Requirements: macOS, Node.js 24.22.0 LTS, npm 12.2.0, Apple Command Line Tools, an unlocked
Keychain, a logged-in desktop for private entry, and LM Studio serving on
`127.0.0.1:1234`. Subscription auth and arbitrary provider endpoints are not supported.

Select the project-scoped Node and npm versions first. Confirm `node --version` is
`v24.22.0` and `npm --version` is `12.2.0`. The supported runtime range is
`>=24.22.0 <25`; `.nvmrc` and `packageManager` record the frozen versions.
Run these commands in the source checkout, before creating or entering a real key:

```sh
npm ci
npm run verify:dependencies
npm run check
npm test
npm run verify:isolation
npm run secure:install -- "$HOME/.local/share/pi-dual/runtime-1"
```

The snapshot includes `bin/node`, npm 12.2.0, the lockfile, and a hash manifest.
Verify it with its `bin/node scripts/verify-installation.mjs`. See the exact
upgrade evidence and rollback limits in [Pi upgrade verification](docs/pi-upgrade-verification.md).

Use a separate trusted installation outside the agent workspace. Running the app
against its own installation or a parent directory fails closed. Follow
[secure setup](docs/secure-setup.md) to create a minimally privileged project key,
enter it through the private native dialog, and run the bounded Pi-backed smoke
check. Never paste a key into chat, a command, `auth.json`, `.env`, or shell files.

From your own private local terminal, run:

```sh
"$HOME/.local/share/pi-dual/runtime-1/bin/node" "$HOME/.local/share/pi-dual/runtime-1/dist/src/index.js" setup /absolute/project
"$HOME/.local/share/pi-dual/runtime-1/bin/node" "$HOME/.local/share/pi-dual/runtime-1/dist/src/index.js" doctor /absolute/project --no-mcp
"$HOME/.local/share/pi-dual/runtime-1/bin/node" "$HOME/.local/share/pi-dual/runtime-1/dist/src/security/smoke.js" /absolute/project
```

Setup verifies isolation with dummy secrets before opening the secure entry
dialog. Agent A defaults to `openai/gpt-6-luna` at high reasoning. Agent B defaults to
`lm-studio/qwen/qwen3.8-27b` with API thinking off. Step 0 stays incomplete until the
isolation suite and the live smoke check both pass.

## Everyday commands

Use the trusted installation's `dist/src/index.js` entry point:

- `help`: show CLI help.
- `auth /absolute/project`: rerun verified private Keychain entry for rotation.
- `doctor /absolute/project`: check isolation, secure storage, models, and MCP.
- `repl /absolute/project`: start the terminal UI with saved defaults.
- `repl /absolute/project --plain`: use the plain terminal fallback.
- `repl /absolute/project --no-mcp`: disable MCP for that run.

F3 opens a model picker with GPT-6.1 Sol, GPT-5.6 Terra, and GPT-6 Luna for A,
plus Low/Medium/High reasoning. B lists downloaded LM Studio LLMs with tool calling
and at least 65,536 context tokens. Use A/B to change agents, arrows to choose,
Enter to apply, and S to toggle saving for restart. Controls appear in the picker.
For example, `--model-a openai/gpt-6-luna --thinking-a high --model-b lm-studio/qwen/qwen3.8-27b --thinking-b off`.
Pi 1.3.0 supplies these GPT descriptors. The app uses its bundled metadata and keeps
the approved model IDs explicit in `src/security/models.ts`, using the official OpenAI endpoint. Coordinator defaults are
non-secret and separate from Pi auth. Legacy unrelated credentials remain intact.

Start LM Studio's server and download the executor. The app loads the selected
model automatically, shows progress, and waits for 65,536-token context readiness.
Selecting another B model unloads the old model first. Manual loading also works:

```sh
lms server start --port 1234 --bind 127.0.0.1
lms load qwen/qwen3.8-27b --identifier qwen/qwen3.8-27b --context-length 65536 --yes
```

Agent B never retrieves an OpenAI credential or falls back to a cloud model.
Its server must accept local requests without authentication. If you have saved
older OpenAI defaults for B, replace them in `~/.pi/dual-agent-coordinator/config.json`
with `"modelB": "lm-studio/qwen/qwen3.8-27b"` and `"thinkingB": "off"`, or rerun setup.
After verifying a trusted installation, run its `bin/node scripts/verify-local-executor.mjs`
from that installation to exercise Agent B's live LM Studio inference and sandboxed
write/read tools in a temporary workspace. It uses the saved, already-loaded model
and makes local inference requests without loading or downloading models.

## REPL basics

Inside the REPL:

- Plain text talks to Agent A in planning mode.
- If Agent A proposes a pending plan, run `/approve` to start execution.
- Agent B performs the execution work automatically.
- Agent A reviews the result and either finalizes or sends another handoff.

To start a new conversation, enter `/new`. This resets both agent contexts and
opens an empty current view. Previous work remains available in History. Use
`/new A` or `/new B` to reset only one agent. Cancel active work first with `/cancel`.

During an ongoing handoff, Agent B pauses after every 10 completed model turns
for a brief Agent A process check-in. One turn includes the model response and
its tool results. A checks progress, repeated attempts, and drift against the
approved plan, then tells B to continue, gives specific next steps, or blocks
execution. Guidance reaches B before its next model request. A final response
on turn 10 goes directly to the normal completion review.

Check-ins keep the current handoff and iteration. A normal completion review
resets the counter for the next handoff. Check-ins use the existing operation
deadline and appear in activity and retained history. Invalid check-in responses
stop execution. `/cancel` also stops a paused check-in.

Agent A's planning instructions require concrete files and symbols, behavior
examples, edge cases, constraints, verification commands, expected results, and
stop conditions. Essential details go inside the structured plan fields that B
receives. These instructions improve reliability; they do not guarantee a
successful model run. See [the check-in design](docs/execution-check-ins.md).

Useful slash commands:

- `/help`
- `/status`
- `/history` and `/inspect ID [section] [line-offset]` for retained, read-only work inspection
- `/approve`
- `/discard`
- `/sessions`
- `/handoff`
- `/cancel`
- `/new`
- `/sessions A` and `/sessions B` to select saved conversations
- `/model A` and `/model B`
- `/thinking A` and `/thinking B`
- `/config review-rounds 3`
- `/config timeout-ms 600000`
- `/new A`
- `/new B`
- `/switch A <session-path>`
- `/switch B <session-path>`
- `/quit`

The TUI gives the current operator turn most of the workspace, with a history
rail on wide terminals and a focusable history control at 80 columns. F1 opens
contextual help; F6 cycles panes. Earlier role runs and tools remain individually
inspectable across session changes and restart.
The current-turn border and role labels use cyan for A and amber for B. Prose
keeps the terminal's default foreground and background, with no colored fill.

See [terminal controls](docs/terminal-experience.md) for keyboard navigation, editable
drafts, cancellation, deadlines, session switching, and explicitly saved defaults.

## Config examples

The [project MCP example](examples/project/.mcp.json.example) demonstrates stdio
configuration. The local-provider JSON files are standalone Pi examples;
the coordinator uses its fixed catalog and does not load `models.json` or OpenAI
entries in `auth.json`.

## MCP support

MCP is enabled by default. Secure mode supports sandboxed stdio servers. HTTP
and SSE peers fail closed. Stdio servers run without network access, with a
disposable HOME and an allowlisted environment. See [the supported boundary](docs/security-model.md).

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

Run doctor from the trusted installation. Missing or locked Keychain storage,
legacy OpenAI auth, unsupported provider overrides, and isolation failures block
startup. Follow [secure setup and migration](docs/secure-setup.md). Doctor never
prints credential values and never substitutes environment-key authentication.

Startup replays saved outcomes and supersedes unfinished workflows with fresh
sessions. Session switching restores conversation context without resuming work.
Cancellation and timeout preserve completed file changes. Inspect those changes
before submitting another request.

## Development

```bash
npm run check
npm test
npm run build
npm run verify:isolation
npm run verify:terminal
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
