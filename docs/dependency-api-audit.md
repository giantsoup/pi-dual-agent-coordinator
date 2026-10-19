# Dependency API audit

Audited on 18 October 2026 in `codex/pi-upgrade-20261018`, following the completed
Pi upgrade and Qwen3.8 default change. This follow-up reviews application callers,
not just package versions. See the follow-up acceptance record in `pi-upgrade-verification.md`; the original
upgrade evidence remains separate.

## Frozen dependencies

A fresh official npm registry check found no newer stable direct dependency than
the frozen set: Pi's four packages 1.3.0, MCP SDK 1.32.1, TypeBox 1.4.2, Zod 4.6.7,
AJV 8.20.0, TypeScript 7.0.2, Vitest 5.0.5, Vite 8.3.4, Node 24 types 24.19.2,
and npm 12.2.0. Node remains the selected 24.22.0 LTS runtime. The
[official Pi release](https://github.com/earendil-works/pi/releases/tag/v1.3.0)
is still the stable target. Its 30 subsequent main-branch commits are unreleased
and are not substituted for the stable package. The registry recheck is in
`/Users/Taylor/pi-api-audit-evidence-20261018/registry-recheck.json`.

Pi's nested TypeBox 1.3.27 and vendor dependencies remain governed by its published
constraints. The retained `node-domexception@1.0.0` deprecation is transitive
through Pi's Google SDK. No new version exception, override, alias, or dependency
patch was introduced by this audit.

## Application coverage

The import inventory includes every source, test, script, example, and the Vitest
configuration. The published installed declarations and implementation at the
exact versions above are the contract used for the review. The dependency guard
checks all these import locations, direct declarations,
known removed patterns, runtime declarations, and strict compiler options. Its
text checks are regression guards, not a substitute for semantic API review.

| Dependency and application callers | Current integration and review outcome |
| --- | --- |
| Pi ai: `security/models`, `model-runtime`, `lm-studio`, fixture provider, runtime/model display, coordinator and handoff types | Bundled model metadata stays separate from authentication. Public `ModelRuntime`, `InMemoryCredentialStore`, provider factories and lazy API modules own the role's broker capability. Stream callback failures now return a completed assistant error stream, as required by `StreamFn`, instead of rejecting outside that protocol. |
| Pi coding-agent: runtime construction, managed session, history, coordinator, setup/doctor, interactive history/service, MCP extension, isolation and smoke | Public direct `AgentSession`, in-memory settings, `SessionManager` projections, resource loader, registry and extension APIs remain current. The metadata-only inventory extension uses public `ExtensionAPI.getAllTools()` and `getActiveTools()` to report active native schemas. Awaited low-level supervision, idle/compaction settlement and abort/drain remain necessary for the application's lifecycle. No private SDK fields or compatibility imports were added. |
| Pi agent-core: runtime, event bridge, response repair, handoff, isolated tools | Native `AgentToolResult.isError` and `structuredContent` now survive the MCP bridge. Structured output is available on execution events; Pi intentionally does not put that field directly on transcript messages. Worker JSON is parsed at the IPC boundary, preserving text signatures, images, usage and termination fields. Model display and tool adapters use SDK generics instead of `any` and unchecked result casts. |
| Pi TUI: bootstrap, app, workspace, model picker, key bindings and test terminals | Public `TuiMainScreen`, `ProcessTerminal`, `Editor`, `Key`, width/wrapping helpers and terminal status methods remain appropriate. `TUI` is imported as a type. Existing application-owned alternate-screen behavior is retained and tested in a real PTY. |
| MCP SDK: pool, cache, direct/proxy tools, policies, extension and security probe | Public client callbacks preserve SDK transport ownership. Closing rejects pending requests and waits for connection startup; close failures remain visible. Sandboxed stdio remains supported; anonymous public Streamable HTTP now uses a destination-bound fetch adapter. A public transport wrapper forwards the SDK callbacks because its optional sessionId getter does not satisfy exactOptionalPropertyTypes. Metadata reads honor capabilities and collect every page, with repeated-cursor and 100-page bounds. Request cancellation reaches tools, metadata, resources and prompts. Explicit `CallToolResultSchema` replaces legacy result-shape adaptation. Cache entries use SDK schemas. |
| TypeBox and AJV: tool definitions, role tool adapters, MCP schemas and isolation fixtures | Canonical TypeBox schemas declare tools. External schemas compile through public AJV Draft 7 or 2020-12 validators. Arguments and successful structured results are validated on both MCP paths, including tools from earlier metadata pages and cache hydration. Per-schema validator instances avoid collisions between unrelated server `$id` values; a WeakMap reuses compiled validators. Task-only tools fail closed because experimental task execution is outside this application's policy. |
| Zod: workflow/progress, MCP config/cache/results, history and LM Studio boundaries | Uses `z.url`, `z.strictObject`, literal issue codes, the `error` refinement option, `z.iso`, `z.json`, and native JSON Schema generation. Config types derive from their schemas. Removed the permissive `unrepresentable: "any"` schema fallback. `superRefine` remains a supported public API in installed 4.6.7. |
| Node and Node types: process, filesystem, streams, HTTP broker, native helper and verification scripts | Existing `node:` imports, abort signals, process ownership, isolated environments and ESM module paths remain supported on Node 24. No global runtime change or new process dependency is needed. |
| TypeScript: application and test checks | Strict NodeNext remains enabled, with `verbatimModuleSyntax`, `noUnusedLocals` and `noUnusedParameters` added. Unused code and incorrect value imports were removed. No ignored diagnostics or relaxed checks were introduced. |
| Vitest and Vite: tests and `vitest.config.ts` | Uses public `defineConfig`, Node environment and fork pool with two workers. Vite is Vitest's declared peer, not an application bundler. No removed configuration API was found. Existing five-second test limits remain unchanged. |

## Deliberate application adapters

The ModelRuntime refresh wrapper forces every later refresh offline and confines it
to the selected provider. Creation flags alone do not provide that guarantee.
The application keeps its sandboxed tools and MCP bridge instead of registering
Pi's CLI tool defaults, native MCP, codemode or tool search. This is a security
boundary, not an obsolete integration.

ManagedSession continues to own preflight, awaited turn supervision, recovery,
compaction and final settlement. Public SDK notifications alone cannot pause the
next provider request. Model replacement prepares and validates a candidate before
releasing the old binding so a failed replacement can preserve the approved state.
Replacing these adapters with unguarded convenience APIs would change behavior.

The current TUI entry point is public and works with the existing screen ownership.
Switching to another layout or mouse model would be a UI redesign outside this
migration. History previews use public parsers on copies and never the repairing
file-open path. Existing role permissions and Qwen3.8 defaults are unchanged.

## Regression evidence and sources

New tests exercise real SDK connections, direct and proxy Pi tool execution,
pagination with an empty opaque cursor, repeated cursors, capability-limited
servers, output validation after cache hydration, and resource/prompt cancellation.
Cache stores now create independent empty state and release completed write queues,
including failed writes. Cache tests cover malformed protocol data, separate cache files, concurrent writers
and recovery after failed writes. Stream and IPC tests validate protocol fields
and reject malformed worker output.

During test development, the shutdown assertion's one-second request deadline
expired before the SDK's two-second stdio termination bound. The new test uses a
four-second request deadline while preserving Vitest's existing five-second limit.
The structured-output assertion was corrected to inspect Pi execution events,
where the SDK exposes that field. Missing worker `details` is valid after JSON
serialization drops undefined, so the boundary parser accepts that omission.
Failed development attempts remain in the external evidence directory.

References: [Pi stable release](https://github.com/earendil-works/pi/releases/tag/v1.3.0),
[Zod migration guide](https://zod.dev/v4/changelog),
[Vitest migration guide](https://vitest.dev/guide/migration/),
[AJV schema management](https://ajv.js.org/guide/managing-schemas.html), and the
published MCP SDK 1.32.1 client, protocol and types modules in the frozen install.

## Source acceptance

The final candidate passed the sequential fresh-install gates under scoped Node
24.22.0/npm 12.2.0: normal `npm ci` with prepare/native build, complete `npm ls`,
dependency guard across 172 files, strict check, 58 test files with 384 tests in
62.73 seconds, build, 341 dummy-isolation assertions plus two security tests,
and 445 real PTY assertions with rendered screen capture in TUI and plain mode.
The final audit reports zero vulnerabilities. No test timeout or assertion was
relaxed. Logs are `final-*` in `/Users/Taylor/pi-api-audit-evidence-20261018`.
An earlier passing sequence is preserved in `before-final-api-cleanup`; the final
sequence includes the last type annotations and Zod error-option modernization.

This proves the source candidate's dummy gates. Installed and live gates are
separate and are recorded in the follow-up section of `pi-upgrade-verification.md`.


## Skill metadata worker

Skill discovery uses Pi's public `loadSkillsFromDir` export. The build uses the
already-pinned Vite library API to bundle the skill reader and its YAML/ignore
parsers, removing unrelated SDK session/provider imports from the sandboxed
metadata path. Other role tools retain the public SDK factories. There are no
new dependencies, private SDK imports, compiler relaxations, or shared writable
code caches. Runtime skill files are still read only inside Seatbelt. Real Pi
tests cover catalog contents, packaged references, and denied skill-file access.

## Local browser adapter

The local browser uses public Pi extension registration and `session_shutdown`,
plus MCP SDK `Client`, `Transport`, `JSONRPCMessageSchema`, `CallToolResultSchema`,
and stdio serialization. It does not import Playwright internals into the coordinator.
The separate pinned MCP runtime owns browser actions and accessibility refs. The
adapter handles 0.0.83's file-backed snapshots/screenshots and `target` input field,
then returns bounded Pi text/image content. Its sandbox wrapper remains application
owned because the SDK stdio convenience transport does not enforce this OS boundary
or own Chrome's detached process groups.
