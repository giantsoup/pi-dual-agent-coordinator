# Architecture Decisions

## Core Control Plane

The coordinator is the only component allowed to observe both Pi runtimes, persist cross-runtime state, validate handoffs, and trigger runtime replacement. Agent A and Agent B never communicate directly.

## Role Separation

- Agent A is planning-only and receives read-only workspace tools. Global Pi MCP tools are available to both roles, with explicit role restrictions supported.
- Agent B is execution-authoritative and receives coding tools.
- V1 safety depends primarily on this tool separation, not on trusting model intent.

## Runtime Model

- Each role runs in an isolated `AgentSessionRuntime`.
- Runtime replacement always goes through a coordinator-owned codepath.
- Session-local subscriptions are invalid after replacement and must be rebound explicitly to `runtime.session`.

## Persistence

- Secure mode keeps Agent A's credentials in Keychain behind the trusted broker. Agent A uses approved OpenAI models, including the fixed trusted GPT-6 Luna descriptor. Agent B uses fixed local LM Studio models through a separate broker without retrieving a cloud credential. Both use in-memory broker capabilities. Executable Pi resources and auth references are disabled.
- Tool and stdio MCP execution use macOS Seatbelt. The trusted installation and coordinator state must be outside the writable workspace. See `security-model.md`.
- Coordinator-owned state lives under the dual-agent session root and is append-only where practical.
- Handoff ledger state must be reconstructable after restart without coordinator memory.

## Workflow Boundary

- Workflow machine blocks are recognized only at stable Pi boundaries, specifically `turn_end`.
- Agent A emits `pi-plan` during planning and `pi-handoff` or `pi-final` during execution review. Legacy `pi-execute` is accepted as a pending plan; only operator `/approve` authorizes B.
- Agent B may emit only `pi-completion`.
- Raw model text is never forwarded directly between runtimes. The coordinator renders deterministic handoff, review, repair, and cap-control prompts.

## Current Scope

- Full-screen terminal UI by default on a TTY, with a plain readline fallback.
- Automatic capped workflow loop: task -> A plan/final -> B execution -> A review -> ... -> A final.
- Recovery, replacement, logging, repair prompts, and append-only workflow replay are part of the ship surface because they materially affect correctness.

## Terminal operations

The coordinator owns one active submission, its abort signal, total deadline,
runtime cleanup, and durable cancellation or failure outcome. The interactive
service enforces the same busy policy for TUI and readline. Presentation does
not decide whether execution, review, repair, or another handoff may start.

Session selection restores Pi conversation context. Recovery replays outcomes
and supersedes unfinished workflows with fresh role sessions. It never resumes
a coordinator workflow automatically. Model changes prepare a replacement
isolated runtime before installing it, retain conversation context, and rebind
subscriptions and trusted extensions. Saving non-secret defaults is explicit.

The runtime adapter owns Pi preflight, agent events, and post-turn compaction as
one prompt lifetime. Cancellation disables queued compaction, aborts active
compaction and agent work, and drains the prompt before coordinator ownership is
released. Runtime settings use Pi 1.3.0's corrected `SettingsManager.inMemory(initial)` so
resource reloads retain retry and discovery policy. Reload regression tests
verify cache warming, analytics, and install telemetry remain disabled. Broker error responses also disable the
OpenAI SDK's independent HTTP retry path.

The local provider distinguishes upstream inactivity from total request duration.
Its 120-second idle timer refreshes on headers and nonempty chunks. A separate
30-minute cap never refreshes. Provider failures end the request without replay.
Runtime settlement telemetry retains the failed run's bounded reason, so a later
A check-in run cannot steal attribution from resumed B execution. Terminal
presentation and read-only history consume that evidence without deciding retries.

Trusted installation builds fresh and runs credential-free stream checks against
the copied compiled broker. The installation manifest binds the result to the
broker hash. Copy integrity alone does not establish correct timeout behavior.

Session resets create mode-appropriate managers explicitly; Pi's generic runtime
`newSession()` would turn a memory session into a persistent file. Replacements
are constructed before the current conversation is released. History previews
parse and migrate only in memory, validate ancestry, and leave source bytes intact.

Response formatting uses a fresh, tool-free Pi Agent for one request through the
same role's validated broker and model. The coordinator supplies inert transcript
evidence, the latest response, schema, and identifiers. The live role session's
tool registry and conversation never change for formatting. Formatter messages
persist as custom records excluded from model replay and projected as messages
only during read-only run inspection. Admission and abort/drain ownership remain
shared with the role runtime; formatting cannot compact its source conversation
or restart execution. Formatter failures drain without aborting idle execution
resources. Explicit cancellation still stops the owned role resources.

The metadata catalog is synchronous and credential-free. Each role separately
creates an asynchronous ModelRuntime containing only its selected broker model.
Other provider authentication is disabled. Refresh remains offline after creation.
SessionManager supplies the canonical system, tool, and conversation projection.
The event bridge awaits the whole managed prompt before accepting the terminal
turn result, preserving typed supervision and formatting failures.

## Pi-native MCP and skills

Global services are configured in `<agentDir>/mcp.json`. Configuration from other
agent applications is not imported. Both roles can use the full global tool
catalog, while project-only servers retain A's read-only policy. A shared
readiness check reports unsupported servers before invocation. Anonymous public
HTTPS uses the MCP SDK behind an endpoint-bound fetch adapter; stdio continues
to use Seatbelt. See the security model for destination and authentication limits.

Agent Skills are installed separately in `<agentDir>/skills`. Both roles read
metadata, instructions, and references through the isolated `skills` tool.
`/skill:NAME` becomes an operator request to A. Skills do not add executable
extensions or bypass approval, model selection, workspace, or response-format
boundaries. Native resource discovery stays disabled.

Session construction obtains a bounded, validated metadata catalog through the
same isolated tool and adds names, short descriptions, and user-only flags to
the prompt. Skill bodies remain on demand. Each new session reloads metadata.
The application-owned pstack adapter accompanies pstack reads and maps supported
host operations to declared Pi tools and coordinator handoffs. Unsupported
delegation and host services remain explicit capability gaps, not simulated
independent workers or new permissions. Upstream files are unchanged.

## Tool discovery

Both roles receive a trusted metadata-only `list_tools` extension that reports
active native names and parameter schemas from Pi's public registry APIs,
sandboxed session-start skill metadata, and MCP metadata with per-server connection errors.
Combined discovery shares the proxy's connection and role-policy path and passes
through cancellation; it never invokes an MCP action tool. Global
MCP servers default to native tools with optional startup discovery; explicit
proxy-only and required settings remain supported. The MCP proxy accepts
`list_tools` as well as `search_tools`, connects on discovery, and distinguishes
an idle connection from a recorded failure. A's workspace tools remain read-only.
Plans and handoffs allow empty `relevantPaths` for file-free tool tasks.


## Local project browser

One native `browser` extension owns one disposable browser per role and Pi session.
It maps a fixed action set to the existing pinned Playwright MCP runtime through a
private transport. A navigates and observes; B adds input under the normal approval
gate. Generic MCP calls and workspace configuration cannot access this backend.

A project-bound private operator policy replaces the archived global origin list.
The browser tree receives a separate mandatory Seatbelt profile and can reach only
its authenticated proxy. The coordinator resolves exact grants to loopback once.
For HTTPS it terminates TLS and validates decrypted Host/origin instead of tunnelling
opaque traffic. This supports local development certificates without general web
access. The system-managed Chrome executable is fixed; the copied MCP bundle is
covered by the trusted installation manifest.

Chrome's nested sandbox fails under the verified outer profile. The fixed
`--no-sandbox` flag is confined to this mandatory single kernel boundary, with no
unrestricted fallback. Proxy revocation precedes process drain. Runtime replacement
explicitly awaits browser teardown because Pi extension shutdown diagnostics alone
cannot carry a security failure. See the security model for limits and verification.

## History compaction ownership

Each role installs a trusted `session_before_compact` hook. An independent,
lazy A-only broker and ModelRuntime generate summaries for both roles using
public Pi `compact` APIs. The capability belongs to the A runtime binding and
uses its validated model selection, with its own broker lifetime; B's callback
resolves the current A binding on every job. Model switches are idle transactions,
so an old binding drains before its capability is disposed. The summarizer has
no AgentSession, tools, MCP, planning transcript, or workflow parser.

Pi appends checkpoints and rebuilds context. Hook failures explicitly abort and
cancel; `session_compact_failed` also catches persistence/rebuild failures.
ManagedSession propagates failures after drain and rejects later dispatch. Its
owned preflight can compact old history before a new user request. A final payload
admission check covers late steering and tool/schema growth without replaying
writes or redelivering a handoff. Raw session history remains intact.

Budget-triggered compaction temporarily uses a zero-token retained tail and an
inert metadata boundary after the visible history. The trusted hook summarizes
all projected messages through that boundary, including the newest response;
Pi still appends the checkpoint and rebuilds context. This handles serialized
reasoning payloads that exceed serialized admission while Pi's text estimate fits the
normal recent-history allowance. Original settings are restored after settlement,
and admission must pass again before inference. A uses exact input-token counting
and 16,384 output tokens, leaving its large context available. B has a 32,768-input
soft target and an 8,192-token recent tail, with its 65,536-token hard limit unchanged.
The counting endpoint is an A-only private broker capability. Fixture counting
transports return conservative byte counts by default for boundary tests; policy
tests provide realistic authoritative counts independently of serialized bytes.

Compaction events correlate the source session and job separately from A's model.
The shared activity reducer renders compaction without changing workflow role or
approval. Success is reported after checkpoint creation; it does not claim that
execution resumed until real execution activity arrives.
