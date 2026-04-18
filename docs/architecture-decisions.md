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

- Pi auth, models, and project-local resources continue to resolve through Pi’s normal `agentDir`.
- Coordinator-owned state lives under the dual-agent session root and is append-only where practical.
- Handoff ledger state must be reconstructable after restart without coordinator memory.

## Handoff Boundary

- Handoffs are recognized only at stable Pi boundaries, specifically `turn_end`.
- The coordinator parses structured handoff/completion blocks from those stable assistant messages.
- Raw model text is never forwarded directly from A to B; the coordinator renders a deterministic handoff prompt for B.

## V1 Scope

- Plain readline REPL only.
- Happy-path task -> A plan -> validated handoff -> B execution -> structured completion.
- Recovery, replacement, logging, and duplicate suppression are part of the initial ship surface because they materially affect correctness.
