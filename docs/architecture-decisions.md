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

- Secure mode keeps credentials in Keychain behind the trusted broker. Pi uses in-memory broker authentication and approved OpenAI models, including the fixed trusted GPT-6 Luna descriptor. Executable Pi resources and auth references are disabled.
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
