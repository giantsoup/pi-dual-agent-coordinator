# pi-dual-agent-coordinator

Coordinator-driven dual-agent workflow engine built on the Pi SDK.

This project runs two isolated Pi runtimes under one coordinator:

- Agent A is the planner, reviewer, and final sign-off model.
- Agent B is the execution model and the only agent allowed to change workspace files.
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
`secure:install` builds fresh and checks the copied broker with credential-free
stream fixtures before recording a successful installation. The check covers
active streams, upstream silence, and the absolute request deadline.
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
`lm-studio/qwen/qwen3.8-27b` with xhigh reasoning. Step 0 stays incomplete until the
isolation suite and the live smoke check both pass.

## Everyday commands

Use the trusted installation's `dist/src/index.js` entry point:

- `help`: show CLI help.
- `auth /absolute/project`: rerun verified private Keychain entry for rotation.
- `doctor /absolute/project`: check isolation, secure storage, models, and MCP.
- `repl /absolute/project`: start the terminal UI with saved defaults.
- `repl /absolute/project --plain`: use the plain terminal fallback.
- `repl /absolute/project --no-mcp`: disable MCP for that run.

Press Esc in the editor, then m to open the model picker with GPT-6.1 Sol,
GPT-5.6 Terra, and GPT-6 Luna for A,
plus Low/Medium/High reasoning. B lists downloaded LM Studio LLMs with tool calling
and at least 65,536 context tokens. Use a/b to change agents, arrows to choose,
Enter to apply, and s to toggle saving for restart. Controls appear in the picker.
For example, `--model-a openai/gpt-6-luna --thinking-a high --model-b lm-studio/qwen/qwen3.8-27b --thinking-b xhigh`.
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
with `"modelB": "lm-studio/qwen/qwen3.8-27b"` and `"thinkingB": "xhigh"`, or choose Xhigh with Esc then m, b, and the reasoning arrows with Remember enabled.
Qwen3.8 exposes Off, Low, Medium and Xhigh; other local models remain Off.
The same setting is available as `/thinking B xhigh save`.
After verifying a trusted installation, run its `bin/node scripts/verify-local-executor.mjs`
from that installation to exercise Agent B's live LM Studio inference and sandboxed
write/read tools in a temporary workspace. It uses the saved, already-loaded model
and makes local inference requests without loading or downloading models.

## REPL basics

Inside the REPL:

- Plain text talks to Agent A in planning mode.
- Run `/approve` on Agent A's pending plan to start B, including read-only inventory tasks. Model-generated `pi-execute` blocks also wait for this command.
- Agent B performs the execution work automatically.
- Agent A reviews the result and either finalizes or sends another handoff.

To start a new conversation, enter `/new`. This resets both agent contexts and
opens an empty current view. Previous work remains available in Request history.
Press Esc then r, or F4, to open it. Arrows highlight a request, Enter displays it,
and Esc or F4 dismisses the pane. Current returns to live output, even when the
current conversation is empty. History selection changes the display only;
new prompts continue the current conversation. Use
`/new A` or `/new B` to reset only one agent. Cancel active work first with `/cancel`.

The **Current activity** panel stays immediately above your draft, including while
you browse history, inspect a record, or open help. It shows the observed action,
role, model, phase, safe tool target, elapsed time, event age, and available progress.
The action text stays steady while a small marker animates. `TERM=dumb` uses a
static marker, and `NO_COLOR` disables role colors. Recent activity belongs to the
current request. Hidden output remains unread until you return to visible output.

The narrative retains planning, operator approval, execution, check-ins,
continuation, revisions, and review in event order. Tool groups start folded.
A completed run means the runtime settled. Approval and revision labels require
coordinator decision events. The plain REPL uses the same observed activity states.

When a runtime fails, Current activity retains the failed role, phase, and safe
reason, including after B continues from an A check-in. The reason remains in
retained history. An interrupted tool call is never presented as executed.

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

The TUI gives the displayed operator request the full body width. Request history
opens temporarily with Esc then r or F4 at every terminal size. Press Esc in the editor
to see the controls menu, then h for help, w for the workspace, or r for history.
Tab cycles panes when browsing; it completes text in the editor. Earlier role
runs and tools remain individually inspectable across session changes and restart.
The request body retains both agents' readable responses in order, with consecutive
tool activity collapsed into totals. Select a run and press Right or Space to
expand its calls; Enter opens retained details. Model responses remain visible
when ownership moves between A and B.
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

MCP is enabled by default. Configure servers directly for Pi; another coding
agent or editor is not required. Stdio servers run in the role sandbox without
network access. Remote servers use anonymous Streamable HTTP over public HTTPS
on port 443. Private addresses, redirects, custom headers, authentication, and
legacy SSE transports are rejected. See [the supported boundary](docs/security-model.md).

Discovery order:

1. `<agentDir>/mcp.json`
2. `<cwd>/.mcp.json`
3. each `--mcp-config PATH` in the order provided

Later sources override earlier ones by server name. Global stdio servers default
to the current workspace as their working directory. Explicit `cwd` values are
resolved relative to their configuration file and must match the workspace.

To enable the public OpenAI documentation server, create `~/.pi/agent/mcp.json`
with the contents of [the global example](examples/pi-agent/mcp.json.example).
No package installation or API key is needed for this server. With `--agent-dir`,
use that directory instead of `~/.pi/agent`. Existing files must be merged rather
than overwritten. Restart Pi after changing configuration.

Both roles have access to every tool from a global Pi MCP server by default.
`x-pi-dual.roles.A.allowAllTools: false` restores A's read-only/allowlist policy
for that server. `onlyTools` restricts a role to named tools, and `excludeTools`
always takes precedence. Project-only servers retain A's existing read-only
policy. A's workspace tools remain read-only, and MCP configuration does not
authorize Agent B execution. Codex/Cursor registries and host `node_repl` are not
imported.

Global servers expose native tools at startup by default. Set
`x-pi-dual.directTools: false` to use proxy-only discovery. Global servers are
optional by default; set `x-pi-dual.required: true` to fail startup if discovery
fails. Optional failures leave the proxy available for a later retry.

Call `list_tools({})` for the session's active native names and parameter schemas,
MCP tools and server status, and installed skill catalog. Its `tools` entries have
`kind: "native"` or `"mcp"`; the `mcp` section also covers proxy-only tools and their
role permissions. The `skills` section reports discovery status and instruction
workflows separately. A failed discovery is reported rather than treated as an
empty installation. Asking for MCP tools also prompts the agent to explain which
installed capabilities are skills.
For MCP proxy discovery, call `mcp({action: "list_tools"})`; it connects
and includes input schemas. `search_tools` provides a compact searchable catalog,
and `describe_tool` returns the full schema for a selected tool. A status of
`connected: false` without an error means idle, rather than failed access.
Discovery and direct calls open the connection as needed. Failed servers appear
in status and discovery diagnostics. Doctor validates configuration without
claiming connectivity; an unavailable optional server produces a warning.

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

## Install and use skills

Install Agent Skills into `<agentDir>/skills`, normally `~/.pi/agent/skills`.
Matt Pocock's [upstream repository](https://github.com/mattpocock/skills) supports
Pi directly through its skills installer:

```sh
npx skills@latest add mattpocock/skills --agent pi --global --copy
```

Select the stable skills listed in the upstream plugin manifest, including
`setup-matt-pocock-skills`. Another editor or coding agent is not required.
Use `--copy` so references remain inside Pi's isolated skills directory.
The installer copies instruction files; MCP servers are configured separately.

In the coordinator, use `/skills` to ask Agent A for the installed catalog.
Use `/skill:tdd <request>` or `/skill:setup-matt-pocock-skills` to request a skill.
The [pstack package](https://github.com/cursor/plugins/tree/main/pstack) can be
installed alongside Matt Pocock's skills under `<agentDir>/skills/pstack/skills`.
Its skills appear as `pstack/NAME`, so `tdd` and `pstack/tdd` remain distinct.
Use `/skill:pstack/poteto-mode <request>` to request pstack's main workflow.
Package reference files can stay alongside its `skills` directory.

You can also ask for a skill by name in ordinary conversation. The `skills`
tool lists installed skills, reads their instructions, and reads reference files
relative to the selected skill, within the global skills directory. Both roles
use the same read-only installation.
Skills marked user-only require an explicit operator request.

Both roles receive names, short descriptions, and user-only flags at session
startup. Full instructions are read on demand. New sessions reload the catalog;
`list_tools({})` includes that session's catalog, while `skills({})` refreshes
skill discovery immediately. Large startup
catalogs show an explicit truncation notice and retain the full catalog through
these tools. Matt Pocock and pstack skills do not add MCP servers.
If the global skills directory was created after Pi started, restart Pi so the
role sandbox can grant access to that directory.

Reading a `pstack/NAME` skill or bundled reference also supplies Pi's host adapter.
It maps skill references to `skills`, workspace inspection to declared role tools,
questions to conversation, and execution to normal approval-gated A/B handoffs.
Model setup uses the operator's `/model` and `/thinking` controls. It does not
write Cursor settings. Workflows requiring arbitrary subagents, independent
multi-model panels, cloud environments, or unavailable services report a
capability gap. Sequential A/B work is used only when it preserves the requested
method; it is not presented as independent parallel review.

Skill files are read in the OS sandbox. The runtime does not load third-party
extensions, hooks, or executable plugins. Skill instructions do not grant
workspace writes to A, approve B, or replace coordinator response formats.
Workflows that require unavailable host tools or independent subagents must
report that limitation rather than claim to have run them.

After building, `npm run verify:global-mcp` exercises the configured public
`openaiDeveloperDocs` service through both real Pi roles: native inventory, direct
calls, and proxy calls, using fixture inference.
`npm run verify:global-skills` verifies both roles can list the 27 installed Matt
Pocock plugin skills plus 56 pstack skills and read instructions from both
packages. Neither verifier retrieves an inference key.

## Verify local projects in a browser

Both roles can use a native `browser` tool for explicitly configured local projects.
Agent A navigates and inspects snapshots, screenshots, and console warnings. Agent B
also clicks, types, selects, and presses keys after normal `/approve` authorization.
Each role and Pi session gets its own disposable browser. After `/approve`, Agent B
can start project servers with the managed `local_server` tool and make local TCP
requests through sandboxed bash. Bind servers explicitly to `127.0.0.1` or `::1`, use an unused project port,
and stop servers started for verification when finished. Public and other-host
network connections, UDP, LM Studio port 1234, ports 5900/9222/9223, and reserved
provider-broker ports 49152–49215 remain blocked. Agent A and generic stdio MCP
remain network-denied. Host-local services are trusted; local proxies must not be
used to relay public traffic. Seatbelt's `localhost` filter includes this Mac's
own interface addresses and permits wildcard listeners, so explicit loopback
binding is required in server commands. See the [security model](docs/security-model.md).

For example, B can serve a dependency-free project on a configured origin:

```json
{"action":"start","command":"python3 -m http.server 4173 --bind 127.0.0.1 --directory unit-converter-test"}
```

Use `http://127.0.0.1:4173/`. Browser origins still require the operator policy below;
starting a server does not grant browser access to a new origin. The tool returns
a `serverId`; use `{"action":"status","serverId":"..."}` for recent logs and
`{"action":"stop","serverId":"..."}` to stop it. Up to four managed servers may
run per session. Run commands in the foreground; the coordinator manages their
process groups and drains them on cancellation, session replacement, and disposal.
Poll HTTP readiness from bash before opening the page. A later bash call cannot
signal a server started in an earlier shell sandbox, so use `local_server` instead
of detached shell jobs for servers needed across tool calls.

Configure exact project origins from the built checkout with the scoped toolchain:

```bash
npm run browser:allow -- /absolute/path/to/project http://localhost:5173 https://project.test
```

The command writes a private project-bound policy at
`~/.pi/dual-agent-coordinator/browser.json`. See the
[policy example](examples/browser.json.example). It backs up legacy version-1 global
origins before migration. Restart Pi to load new grants. Origins are matched to the
canonical project directory; a grant for one project does not enable another.
Only loopback hosts and `.test` names that resolve exclusively to loopback are
accepted. Public sites, inference/control ports, ephemeral broker ports, WebSockets,
file URLs, uploads, downloads, personal profiles, and arbitrary browser scripts
are unavailable. Local HTTPS uses a private TLS-terminating proxy and permits local
development certificates. External assets are blocked unless separately granted as
local project origins.

The integration uses the existing `@playwright/mcp@0.0.83` installation at
`~/.local/share/pi-dual/browser-runtime` and `/Applications/Google Chrome.app`.
Trusted installation copies and hashes the browser runtime. Browser startup checks
that bundle against its installation manifest. Set the browser policy's `enabled`
to `false` to disable it. `--no-mcp` controls globally configured MCP servers;
the local browser has its separate project policy. No-tools smoke runtimes omit it.
Doctor checks configuration and installation, but does not claim browser connectivity.

```bash
npm run verify:browser
npm run verify:local-servers
```

This builds the candidate, probes its browser OS boundary using dummy credentials,
and opens a disposable HTTP/HTTPS project through real Pi sessions and Chrome.
The local-server verifier makes B start a server, request it from bash, open it in
Chrome, capture a screenshot, and stop it. Inference uses fixture providers.
Run the compiled scripts directly in a verified
trusted installation to check the installed artifact without rebuilding it:

```bash
bin/node scripts/verify-browser-boundary.mjs
bin/node scripts/verify-local-browser.mjs
bin/node scripts/verify-local-servers.mjs
```

Cancelled or failed interactions can already have changed the local app. Inspect
fresh application state before repeating them. Cancellation closes the proxy,
drains the browser process groups, and discards the browser session. An unexpected
worker exit disables the browser until Pi restarts because complete orphan cleanup
cannot be proved. General web
browsing remains outside this integration.

## Troubleshooting

Run doctor from the trusted installation. Missing or locked Keychain storage,
legacy OpenAI auth, unsupported provider overrides, and isolation failures block
startup. Follow [secure setup and migration](docs/secure-setup.md). Doctor never
prints credential values and never substitutes environment-key authentication.

Startup replays saved outcomes and supersedes unfinished workflows with fresh
sessions. Session switching restores conversation context without resuming work.
Cancellation and timeout preserve completed file changes. Inspect those changes
before submitting another request. Project `AGENTS.md` instructions load when a
role runtime is created. Use `/new` or restart Pi after adding or editing them.

Agent B's local provider stops after 120 seconds without upstream data. An active
stream can continue for up to 30 minutes per request, subject to the outer
operation deadline. Streaming tool arguments count as activity. A's provider
keeps its 120-second absolute request limit. Provider failure stops the workflow
without replaying tools or a handoff. The terminal shows the safe stopping cause.

Run `bin/node scripts/verify-provider-stream-deadlines.mjs` inside a trusted
installation to check its compiled broker with injected streams and scaled
deadlines. This check makes no live inference requests.
For a separate bounded live check, run `bin/node scripts/verify-local-stream.mjs`
inside a verified trusted installation. It uses the saved already-loaded local
model, permits only native write and read tools, and checks a response lasting
over two minutes plus exact file bytes in a disposable workspace. It stops after
seven minutes and never loads a model or resumes an existing workflow.

## Development

```bash
npm run check
npm test
npm run build
npm run verify:isolation
npm run verify:terminal
```

## Project scope

The main branch contains the terminal UI, plain terminal fallback, and local-project
browser automation. The separate browser-based coordinator interface remains
archived on `feature/browser-experience`.
See [terminal controls](docs/terminal-experience.md) for the terminal work plan.

## Additional docs

- [docs/review-loop.md](./docs/review-loop.md): workflow lifecycle, machine block schemas, provider compatibility notes, and troubleshooting
- [docs/handoff-state-machine.md](./docs/handoff-state-machine.md): workflow state transitions and replay behavior
- [docs/architecture-decisions.md](./docs/architecture-decisions.md): design rationale and system boundaries
- [CONTRIBUTING.md](./CONTRIBUTING.md): local setup, validation, and pull request expectations
- [docs/security-model.md](./docs/security-model.md): role separation and trust boundaries
- [docs/implementation-backlog.md](./docs/implementation-backlog.md): future work

### History compaction

The coordinator uses Agent A's selected approved model to summarize both agents'
histories through a separate, tools-disabled request. Agent B's execution stays
in LM Studio. The Current activity panel identifies which history A is compacting,
shows the pause and elapsed time, and retains the outcome in request history.
Ctrl+C cancels during compaction, including while browsing history. Plain mode
prints the start and outcome once.

Compaction preserves the full archive and completed file changes. If summary
creation, persistence, or request-budget verification fails, execution stops;
submit explicitly to continue. A summary never grants execution approval.

B's complete text/tool request is counted with the loaded LM Studio model's
prompt template and tokenizer before inference. Its selected window remains
65,536 tokens, with output headroom and a 4,096-token safety margin. Tokenizer
unavailability and unsupported image formats fail before inference. Private B
reasoning remains archived and is omitted from provider replay. A's text requests use a conservative byte allowance. Summary requests
use low reasoning where supported and a separate bounded output budget.

From a verified trusted installation, `bin/node scripts/verify-context-budget.mjs`
checks the saved local executor's tokenizer without inference.
`bin/node scripts/verify-compaction.mjs /absolute/credential-project` separately
checks real A summaries and B tool continuation across two compactions in a
throwaway workspace. Both require the saved executor to be already loaded;
neither loads or downloads a model.
