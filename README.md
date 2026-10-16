# pi-dual-agent-coordinator

Coordinator-driven dual-agent workflow engine built on the Pi SDK.

This project runs two isolated Pi runtimes under one coordinator:

- Agent A is the planner, reviewer, and final sign-off model.
- Agent B is the execution model and the only agent allowed to make changes.
- The coordinator handles the handoff loop, review cap, and workflow persistence.

Use OpenAI project API-key authentication for both roles. Credentials live in
macOS Keychain behind a trusted broker. Agent tools and stdio MCP servers run in
an OS sandbox. Read [the security model](docs/security-model.md) before use.

## Secure setup

Requirements: macOS, Node.js >=20.6, npm, Apple Command Line Tools, an unlocked
Keychain, and a logged-in desktop for private entry. Subscription auth and custom
provider endpoints are not supported by the secure path.

Run these commands in the source checkout, before creating or entering a real key:

```sh
npm install
npm run check
npm test
npm run verify:isolation
npm run secure:install -- "$HOME/.local/share/pi-dual/runtime-1"
```

Use a separate trusted installation outside the agent workspace. Running the app
against its own installation or a parent directory fails closed. Follow
[secure setup](docs/secure-setup.md) to create a minimally privileged project key,
enter it through the private native dialog, and run the bounded Pi-backed smoke
check. Never paste a key into chat, a command, `auth.json`, `.env`, or shell files.

From your own private local terminal, run:

```sh
node "$HOME/.local/share/pi-dual/runtime-1/dist/src/index.js" setup /absolute/project
node "$HOME/.local/share/pi-dual/runtime-1/dist/src/index.js" doctor /absolute/project --no-mcp
node "$HOME/.local/share/pi-dual/runtime-1/dist/src/security/smoke.js" /absolute/project
```

Setup verifies isolation with dummy secrets before opening the secure entry
dialog. Agent A defaults to `openai/gpt-6-luna` at high reasoning. Agent B defaults to `openai/gpt-5.4`. Step 0 stays incomplete until the
isolation suite and the live smoke check both pass.

## Everyday commands

Use the trusted installation's `dist/src/index.js` entry point:

- `help`: show CLI help.
- `auth /absolute/project`: rerun verified private Keychain entry for rotation.
- `doctor /absolute/project`: check isolation, secure storage, models, and MCP.
- `repl /absolute/project`: start the terminal UI with saved defaults.
- `repl /absolute/project --plain`: use the plain terminal fallback.
- `repl /absolute/project --no-mcp`: disable MCP for that run.

Model overrides must name approved OpenAI Responses models, such as
`--model-a openai/gpt-6-luna --thinking-a high --model-b openai/gpt-5.4`.
Pi 0.67.68 lacks Luna in its bundled catalog; the app supplies one fixed,
reviewed descriptor for the official `gpt-6-luna` model and endpoint. Coordinator defaults are
non-secret and separate from Pi auth. Legacy unrelated credentials remain intact.

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

The [project MCP example](examples/project/.mcp.json.example) demonstrates stdio
configuration. The older local-provider JSON files are standalone Pi examples;
secure mode does not load `models.json` or OpenAI entries in `auth.json`.

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

Unfinished recovered workflows still require an explicit fresh session or the
existing coordinator operations. This credential work does not add automatic
workflow continuation.

## Development

```bash
npm run check
npm test
npm run build
npm run verify:isolation
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
