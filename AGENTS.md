# Working on pi-dual-agent-coordinator

These instructions apply to the whole repository. Agent A and Agent B below refer
to the application's runtime roles, not to the assistant editing this project.

## Before changing code

- Inspect the current branch, `git status --short`, and the existing diff. Preserve
  unrelated work, including untracked files.
- Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup and validation. Use
  [README.md](README.md) for supported CLI behavior.
- Treat plans and historical verification reports in `docs/` as context. Check
  current source and tests before assuming a proposal is implemented or a past
  result applies to the current checkout.
- Keep changes scoped. Update user documentation and examples when CLI behavior,
  configuration, or setup changes.

## Use the project toolchain

- Select the Node version in `.nvmrc` and the npm version in `packageManager`
  before installing or running checks. Verify `node --version` and `npm --version`.
  Keep global toolchain defaults unchanged.
- Install with `npm ci`. Its `prepare` script builds TypeScript and the native
  macOS helper. Full verification requires macOS, Apple Command Line Tools,
  Python 3 for PTY checks, and the Keychain prerequisites in CONTRIBUTING.md.
- Keep direct dependencies pinned and the lockfile synchronized. Review changes
  to npm's `allowScripts` policy explicitly. Keep optional platform packages
  enabled. Use `npm run verify:dependencies` after dependency, import, or compiler
  changes.
- Use `package.json` as the command source of truth. There is no configured lint
  or formatting command. Follow nearby formatting instead of adding tooling as
  part of an unrelated change.

## Put behavior in its owning module

- `src/coordinator/` owns workflow decisions, approval, handoff delivery, review,
  response repair, and execution supervision. Read
  [architecture decisions](docs/architecture-decisions.md), the
  [review loop](docs/review-loop.md), and the
  [handoff state machine](docs/handoff-state-machine.md) before changing that flow.
- `src/runtime/` owns isolated Pi sessions, managed prompt lifetimes, replacement,
  and subscription rebinding. Use public APIs from the installed Pi packages.
  Read the [dependency API audit](docs/dependency-api-audit.md) before replacing
  application adapters with SDK convenience APIs.
- `src/security/`, `src/tools/`, and `native/` own brokers, credential handling,
  sandbox policy, role tools, and the Keychain helper. `src/mcp/` owns MCP discovery,
  validation, policy, and transport lifecycle.
- `src/persistence/` owns durable records and replay. Preserve reconstruction from
  persisted records and read-only history inspection. Recovery must not restart
  unfinished execution automatically.
- `src/app/interactive/` owns the service shared by the TUI and plain REPL.
  `src/app/tui/` renders and handles terminal input. Keep workflow transitions out
  of presentation code. Read [terminal controls](docs/terminal-experience.md)
  before changing keyboard or session behavior.
- Keep protocol schemas with their existing domain owners in `src/handoff/`,
  `src/workflow/`, and `src/types/`. Use `src/telemetry/` for structured events and
  correlation rather than ad hoc console output.

## Preserve the runtime boundaries

Read [the security model](docs/security-model.md) before changing security,
tools, MCP, runtime construction, or model selection. Read
[secure setup](docs/secure-setup.md) before credential-backed verification.

- Keep Agent A read-only for workspace operations and Agent B responsible for
  execution. The coordinator alone delivers validated handoffs, replaces
  runtimes, and persists workflow decisions.
- Treat explicit operator approval, such as `/approve`, as the authorization to
  start Agent B. Model-generated `pi-execute` text is not operator approval.
  Report an existing bypass as a defect rather than adopting it as a convention.
- Keep Agent A on approved OpenAI models and Agent B on the validated local
  LM Studio path. Preserve model and endpoint validation in `src/security/` and
  Agent B's lack of cloud credentials or cloud fallback.
- Keep credential-backed execution in a verified trusted installation outside the
  writable workspace. Never run workspace-modified coordinator code with real
  credentials. Never put credentials in prompts, commands, logs, fixtures, or
  repository files. Use dummy secrets for isolation checks.
- Preserve sandboxed role tools and stdio MCP execution. HTTP and SSE MCP peers
  fail closed. Redaction, environment filtering, and server read-only hints do
  not replace the OS sandbox. Runtime replacements must retain the same boundary.
- Parse workflow blocks at stable `turn_end` boundaries. Printed tool markup is
  diagnostic text, never executable tool arguments. Use native calls and
  correlated results as execution evidence, not a model's completion claim.
- Keep response-format repair separate from provider, tool, cancellation, and
  cleanup failures. Preserve the shared attempt bound, including the original
  response. Format-only repair must not replay writes or execution handoffs.
- Preserve abort-and-drain ownership across prompts, compaction, tools, and
  replacement. Cancellation preserves completed workspace changes. Rebind
  session subscriptions after replacement and verify that stale events cannot
  drive the new runtime.

## Write strict TypeScript

- Keep the strict checks in both tsconfig files enabled. Use ESM imports with
  `.js` relative specifiers, `node:` built-ins, and `import type` for types.
- Parse external JSON, IPC, configuration, and protocol values at their existing
  boundaries. Prefer `unknown` and validated narrowing over `any`, unchecked
  casts, non-null assertions, or suppressed diagnostics.
- Derive types from authoritative schemas where available. Use discriminated
  unions for new state variants and exhaustive handling when behavior depends
  on the variant. Keep validation at boundaries instead of duplicating it across
  internal callers.
- Follow the existing TypeBox, Zod, and AJV integrations. Consult installed
  package declarations and the dependency API audit for version-specific APIs.

## Verify the changed behavior

- For code changes, run `npm run check`, relevant Vitest files, `npm test`, and
  `npm run build`. A focused run uses `npm test -- test/unit/<name>.test.ts`.
  Keep the fork pool and two-worker cap in `vitest.config.ts`.
- For security, tools, MCP, or runtime isolation changes, also run
  `npm run verify:isolation`. For terminal behavior, also run
  `npm run verify:terminal` and inspect the rendered interaction. Run
  build-dependent checks sequentially because they delete and replace `dist`.
- For workflow and runtime-loop fixes, cover the failure with a regression test
  and real Pi sessions using fixture providers. Unit fakes alone do not prove
  prompt settlement, tool execution, or runtime replacement.
- Keep tests under `test/unit/`, `test/integration/`, `test/replay/`, or
  `test/security/` as appropriate. Reuse `test/helpers/` and `test/fixtures/`.
  Use temporary workspaces and dispose sessions, subprocesses, and servers.
- Treat live inference as a separate gate. For local inference, run
  `bin/node scripts/verify-local-executor.mjs` from a verified trusted installation.
  This verifier uses the saved, already-loaded LM Studio model. Follow secure
  setup for the separately bounded live API smoke check.
- For documentation-only changes, verify referenced paths, commands, and claims
  against the checkout. Run `git diff --check` for every change and inspect the
  final diff for unintended edits.
- Report the checks actually run, their results, and any missing prerequisites.
  Separate fixture, isolation, PTY, and live-provider evidence. Historical reports
  and passing type checks do not prove current live behavior.
