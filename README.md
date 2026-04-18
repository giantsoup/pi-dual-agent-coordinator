# pi-dual-agent-coordinator

Coordinator-driven split-brain handoff runtime built on the Pi SDK.

## Initial scope

- Two isolated Pi SDK runtimes
- Single coordinator as the control plane
- Agent A is read-mostly and planning-focused
- Agent B is write-authoritative and execution-focused
- Durable handoff state lives in session entries
- Replay and recovery are first-class design goals

## Repository layout

```text
docs/
  implementation-backlog.md
src/
  app/
  coordinator/
  handoff/
  persistence/
  runtime/
  telemetry/
  tools/
  types/
test/
  fixtures/
  integration/
  replay/
  unit/
```

## Current status

The repository is past the initial scaffold stage. The current codebase includes:

- dual runtime bootstrap and lifecycle wiring,
- coordinator-managed handoff preparation, delivery, and completion,
- durable ledger and restart recovery support,
- runtime rebinding and health inspection,
- role-based tool separation for read-mostly Agent A and write-authoritative Agent B.

`npm test`, `npm run check`, and `npm run build` are expected to pass before manual testing.

The phased plan in [docs/implementation-backlog.md](./docs/implementation-backlog.md) should be read as the design backlog and roadmap, not as a statement that Phase 1 is still the next unfinished task.

## Manual test

Prerequisites:

- Node.js `>=20.6.0`
- Pi agent auth and model configuration available in your normal agent environment

Build and start the REPL:

```bash
npm install
npm run build
node dist/src/index.js repl .
```

Quick smoke test without persisted sessions:

```bash
node dist/src/index.js repl . --no-session
```

Useful REPL commands:

- `/status` shows both runtime bindings, model selection, and current handoff summary
- `/sessions` shows the active session metadata for roles `A` and `B`
- `/handoff` shows the last validated and persisted handoff state
- `/new A` or `/new B` creates a fresh session for one role
- `/switch A <session-path>` or `/switch B <session-path>` rebinds a role to an existing session file
- `/quit` exits cleanly

Suggested live test:

1. Start the REPL and run `/status` to confirm both runtimes booted.
2. Submit a task that should cause Agent A to analyze and delegate implementation work to Agent B.
3. Run `/handoff` and confirm the handoff moved through prepared, delivered, and completed states.
4. Run `/sessions` to confirm both role sessions remain bound after the exchange.
5. Restart without `--no-session` and run `/handoff` again to confirm persisted recovery state is visible.

Current test coverage includes unit, replay, and fake-runtime integration tests. The main remaining validation is live end-to-end behavior against the real Pi SDK runtime and models.
