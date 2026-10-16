# Architecture Decisions

## Core Control Plane

The coordinator is the only component allowed to observe both Pi runtimes, persist cross-runtime state, validate handoffs, and trigger runtime replacement. Agent A and Agent B never communicate directly.

## Role Separation

- Agent A is planning-only and receives read-only Pi tools.
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
- Agent A may emit either `pi-handoff` or `pi-final`.
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
released. Runtime settings use seeded in-memory storage so Pi resource reloads
retain retry and discovery policy. Broker error responses also disable the
OpenAI SDK's independent HTTP retry path.

Session resets create mode-appropriate managers explicitly; Pi's generic runtime
`newSession()` would turn a memory session into a persistent file. Replacements
are constructed before the current conversation is released. History previews
parse and migrate only in memory, validate ancestry, and leave source bytes intact.
