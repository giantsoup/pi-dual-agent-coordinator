# Security Model

## Trust Boundary

The coordinator owns the trust boundary. It decides which runtime receives which tools, which prompts are coordinator-authored, and which state transitions become durable ledger records.

## Compatibility Mode

V1 loads Pi project-local resources by default so local `AGENTS.md`, prompts, skills, and extensions remain compatible with standard Pi behavior. This improves adoption but expands the trust surface to repository-local Pi resources.

Implications:

- A malicious or incorrect project-local Pi resource can influence either role.
- The coordinator does not attempt to sandbox project-local prompt content in V1.
- The app-specific ledger remains coordinator-owned and separate from Pi’s auth/settings root.

## Mutation Policy

- Agent A receives read-only tools only.
- Agent B is the only role allowed to receive mutation-capable tools.
- Mutation-capable tool invocations are wrapped so path-bearing arguments are normalized to canonical absolute paths before coordinator-side recording.

## Cross-Runtime Safety

- There is no direct A/B messaging channel.
- Only the coordinator can deliver work between roles.
- Only validated handoff envelopes and completion records affect coordinator state.

## Failure Policy

- Invalid handoffs are rejected and never delivered.
- Duplicate handoff ids are ignored after first persistence.
- Runtime replacement invalidates prior subscriptions immediately; rebinding is mandatory before further coordination.
