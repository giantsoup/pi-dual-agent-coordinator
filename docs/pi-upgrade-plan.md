# Upgrade Pi and the development stack

Status: implementation and acceptance gates complete on the frozen 1.3.0 target, including the requested Qwen3.8 default and separate trusted cloud/local checks. The existing launcher remains unchanged. See [execution evidence](pi-upgrade-verification.md). The following research baseline is historical. Researched on 18 October 2026 against `main` at `8532d2d54d56c9f3b37bafa2f568989c39098c3e`, including existing uncommitted application and model-picker work. No dependencies or application code were changed while preparing this plan.

## Outcome and scope

Move the coordinator from Pi 0.67.68 to the latest stable Pi family and update its direct dependency and development-tool stack. Preserve the terminal experience, approved workflow, role restrictions, broker-only inference, local model selection, cancellation, and retained history. Finish with a reproducible lockfile and a separately installed, verified trusted runtime.

The verified Pi target is **1.3.0**, published under **`@earendil-works`**, at release commit **`71023aec1546d6d677a65669c5665c0927ce0dd0`**. The old `@mariozechner/pi-coding-agent` package's latest version is 0.73.1; upgrading that package alone would miss the current release. See the [official release](https://github.com/earendil-works/pi/releases/tag/v1.3.0).

Treat this as a complete SDK migration. Remove obsolete integrations after migrating their callers. Do not preserve a second legacy runtime, add package aliases that conceal the namespace change, or patch installed dependencies. Subagent implementation remains a separate feature. Do not introduce native Pi MCP, codemode, tool search, cloud fallback for B, new provider credentials, or model downloads as part of this upgrade.

## Verified dependency targets

Recheck stable npm tags and official release notes at implementation start. Freeze one coherent target set for the run and record it. If stable Pi has advanced, inspect the additional release delta and update this plan and its evidence before implementing that version. Never substitute `main`, a prerelease, or a floating `latest` dependency.

| Item | Inspected baseline | Target checked on 18 October |
| --- | --- | --- |
| Node runtime | `.nvmrc` 20.6.0; running host 24.10.0 | Node **24.22.0 LTS** |
| npm | Running host 11.6.0 | **12.2.0**, scoped to the project toolchain |
| Pi coding-agent and TUI | `@mariozechner/*` 0.67.68 | `@earendil-works/*` **1.3.0**, exact pins |
| Pi ai and agent-core | Imported directly but only transitively declared, 0.67.68 | Declare `@earendil-works/pi-ai` and `@earendil-works/pi-agent-core` directly at **1.3.0** |
| TypeBox | `@sinclair/typebox` 0.34.49 | Replace with **`typebox`**, initially **1.3.27** to match Pi; evaluate latest **1.4.2** before the final dependency gate |
| MCP SDK | 1.29.0 | **1.32.1** |
| Zod | 4.3.6 | **4.6.7** |
| TypeScript | Locked 5.9.3 | **7.0.2** |
| Vitest | 3.2.4 | **5.0.5** |
| Vite | Transitive test dependency | Declare compatible test peer **8.3.4** directly |
| Node types | Locked 24.12.2 | **24.19.2**, latest Node 24 types |

Use exact versions for the new direct-dependency baseline and commit the generated lockfile during implementation. Pi 1.3.0 itself pins its internal packages, provider SDKs, and TypeBox. Let npm resolve those published requirements. Do not force every transitive package to its independent latest version through overrides.

The TypeBox checkpoint is intentional. Migrate package names and schemas at Pi's published 1.3.27 first, then test the direct application dependency at 1.4.2. Keep 1.4.2 if typechecking and actual MCP schema validation pass. Otherwise retain the aligned version with a concrete incompatibility record. This plan does not claim that 1.4.2 is incompatible. Nested versions required by Pi are not, by themselves, a defect.

Node 24 is the selected supported LTS line. Pi declares Node >=22.19.0, but this plan also modernizes the app's compiler and tests. Set `.nvmrc` to 24.22.0, document the supported Node 24 range, and align `engines`, Node types, and a `packageManager` entry of `npm@12.2.0`. Verify actual Node/npm versions; metadata alone does not select them. Use project-scoped tooling without changing the machine's global defaults. Node 26 types are not the right target for a Node 24 runtime.

Sources: [registry metadata snapshot](research/pi-upgrade-dependencies-2026-10-18.json), [Pi's published manifest](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/package.json), [Node 24.22.0 LTS](https://nodejs.org/en/blog/release/v24.22.0), [TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/), and [Vitest 5 migration](https://vitest.dev/guide/migration/). Version metadata establishes availability and declared requirements, not compatibility with this app.

## Phase 0: Preserve the actual starting application

1. Read applicable `AGENTS.md` instructions, [CONTRIBUTING](../CONTRIBUTING.md), [security rules](security-model.md), [architecture decisions](architecture-decisions.md), [execution check-ins](execution-check-ins.md), and [secure setup](secure-setup.md). Reinspect the current checkout rather than relying on this dated inventory.
2. Record branch, HEAD, status, Node/npm versions, dependency tree, and hashes of the manifest, lockfile, and files used as the migration baseline. The working tree contains unfinished runtime, terminal, LM Studio, model-picker, tests, and documentation changes. A worktree created from HEAD alone will omit them.
3. Work in a dedicated migration branch/worktree containing the intended current application. Prefer a reviewed baseline commit. If that work is uncommitted, copy an inventoried set of relevant tracked changes and required new source/test files to the worktree and verify file hashes. Preserve original files and unrelated calculator/demo artifacts. Do not stash, reset, clean, or commit everything. Record which untracked feature files were included and which artifacts were excluded.
4. Establish the old-version baseline in that isolated checkout. Build first, then run typecheck, full tests, isolation verification, and terminal verification sequentially. Use only dummy providers and dummy secrets for this baseline. Separate genuine baseline failures from migration failures, and fix blocking baseline defects separately without relaxing checks.
5. Use disposable state for tests. Back up any real coordinator state before a new runtime writes it, through a trusted local operation that keeps backup contents out of tool output. Do not read or export Keychain credentials. Old and new session formats must be tested on fixture copies first.

Exit evidence: preserved source checkout, identified application baseline, recorded command results, and an explicit list of pre-existing failures or unavailable host prerequisites. Do not claim the old application is green without running these checks.

## Phase 1: Resolve one modern dependency set

1. Confirm package provenance against the official repository and registry, including the scope change. Review coding-agent, agent-core, ai, and TUI changelogs from 0.67.68 through the frozen release, not only the final release notes.
2. Update runtime/toolchain declarations and replace legacy package entries with the four directly imported Pi packages. Replace `@sinclair/typebox` with `typebox`. Update the other direct dependencies and test tools in the target matrix. Keep the project on npm and ESM.
3. Generate a lockfile using the selected npm. Use `--ignore-scripts` during initial dependency resolution/installation so the root `prepare` hook cannot compile half-migrated code. Review required dependency install scripts and native/optional packages, then run necessary setup deliberately in the isolated checkout. Do not omit optional platform packages needed by the native TypeScript compiler or other runtime dependencies.
4. Migrate active imports in `src`, `test`, `scripts`, and standalone examples. Declare every directly imported external package. Avoid a global replacement across historical research, recorded transcripts, or unrelated demos.
5. Inspect `npm ls` and the lockfile for invalid peers, unexpected duplicate Pi families, old namespaces, and changed install scripts. Do not use `--force`, `--legacy-peer-deps`, or an audit fix to hide resolution problems.

Expected result: a frozen, inspectable dependency graph. Intermediate compiler errors belong to the following migration phases; this phase alone is not a working upgrade.

## Phase 2: Migrate the secure SDK integration

Start with [the sourced SDK findings](research/pi-upgrade-source-notes-2026-10-18.md) and the exact published target declarations.

### Model access and authentication

Update `src/security/models.ts`, `src/runtime/create-role-runtime.ts`, setup, doctor, and coordinator model selection. The old public `AuthStorage` integration is replaced by asynchronous `ModelRuntime`. Its runtime-key installation is asynchronous too. Await initialization and keep ownership and disposal explicit.

Use the public in-memory credential-store interface, `modelsPath:null`, `refreshOnCreate:false`, and `allowModelNetwork:false`. These settings prevent default initialization paths; they are not sufficient credential or endpoint confinement. Preserve the broker as the sole inference route, explicit model/provider/endpoint checks, rejection of ambient auth/proxy overrides, and the rule that B never retrieves the OpenAI key.

Restrict later catalog refresh paths as well. `allowModelNetwork:false` only controls creation-time refresh. Later refresh calls must explicitly disallow networking or be unavailable through the app's trusted interface. Test this rather than treating a flag as a universal network block.

Replace old pi-ai root-level global helpers with public instance/provider APIs where possible. Some legacy functions now live under `/compat`; do not silently adopt that module as the permanent integration. Check any target-internal shared state with simultaneous A/B sessions and replacement tests.

The current setup, doctor, and `Coordinator.getAvailableModels()` use synchronous catalog access. Separate metadata enumeration from asynchronous auth/runtime construction using the target's bundled catalog APIs or a deliberately initialized trusted catalog. Do not make browsing the picker retrieve credentials or contact provider catalogs. Preserve the current GPT choices, reasoning controls, dynamic downloaded LM Studio inventory, verified instance aliases, and rollback of failed local model changes.

Use target catalog descriptors only after checking required model behavior and the application's trusted metadata. Do not copy stale manual model definitions merely to make compilation pass, and do not let a newly expanded upstream catalog enlarge role permissions implicitly.

### Tools, resources, and settings

Keep the public direct `AgentSession` constructor with the required `modelRuntime` and sandboxed `baseToolsOverride`. The high-level `tools` option now selects tool-name strings/patterns; passing old executable tool objects there is invalid. A new default factory must never replace the isolated role tools with unrestricted built-ins.

Retain the private resource directory, disabled executable discovery, isolated `AGENTS.md` reads, in-memory settings, and existing guarded MCP bridge. Do not register Pi's native MCP, codemode, or tool-search factories. These are CLI defaults, not automatically active merely because their packages are installed.

Set `cacheWarming:"off"`, `enableInstallTelemetry:false`, and `enableAnalytics:false`. Omit the optional direct-constructor cache warmer. Do not set `codemode.mode:"off"`; the target schema permits only `on` and `only`. Disable that feature through absent registration and tool policy.

Use `usesDefaultTools:false` and an explicit role-specific tool registry/loadout derived only from isolated tools and the app-owned MCP definitions. Review `allowedToolNames` and `excludedToolNames`, including the target's exception for registered native `mcp__` tools. Exclude native `codemode`, `tool_search`, and native MCP names while retaining the app's guarded `mcp` proxy and trusted direct tools. Verify collisions and lazy MCP registration. Assert both registered and active tools after construction, reload, new/switch, and model replacement. Persisted tool declarations must never expand permissions.

Update `src/mcp/direct-tools.ts` and `src/mcp/proxy-tool.ts` to canonical TypeBox schemas. Validate dynamic MCP JSON schemas and tool arguments at their existing boundaries. A type assertion or `Type.Unsafe` declaration alone does not validate external input. Retain sandboxed stdio, allowlisted environments, `env -i`, redaction, per-role policy, and the rejection of HTTP/SSE peers. Do not replace the existing bridge with upstream native MCP during this migration.

The target fixes `SettingsManager.inMemory(initial)` backing-store initialization. Remove the current seeded-Map workaround only after a reload regression test proves all security settings survive. Keep the smaller public integration that passes that test.

Exit evidence: actual target Pi sessions with deterministic providers, isolated A reads and B mutations, exact approved tool registries, correct model-selection behavior, and no unintended file/config/network/auth fallback.

## Phase 3: Adapt lifecycle, transcripts, and persistence

Update `src/runtime/managed-session.ts`, runtime replacement, the event bridge, execution supervision, telemetry normalization, fixture providers, `src/runtime/session-history.ts`, and retained-history projections where target behavior requires it.

- Keep the awaited low-level turn listener that pauses B before its next model request. Do not replace it with queued notification listeners. Prove ordering at turns 10 and 20, normal completion on a threshold turn, malformed guidance, and cancellation during A's check.
- Audit `agent_end` versus the newer outer `agent_settled` lifecycle. The coordinator must own preflight, tools, retries/recovery, compaction, and final settlement as one submission. No provider request or queued follow-up may start after cancellation or deadline expiry.
- Target `dispose()` initiates more cancellation than 0.67.68, but returns void. Explicitly abort and drain work before releasing brokers, clearing operation ownership, or reporting idle. Prove failed cleanup remains visible and late events cannot attach to a replacement run.
- Restore conversation state through the supported SessionManager projection. The transcript now contains system messages and tool declarations; assigning `agent.state.messages` alone is not an adequate migration strategy. Preserve approved prompts, redaction, tool restrictions, and context across replacement.
- The session version remains 3, but content semantics have changed. Test old fixture sessions, branches, compaction, custom entries, missing/cyclic ancestry, and target-generated system/tool state. History inspection must not repair or rewrite original files. Do not automatically resume unfinished workflows.
- Use the target's real assistant-event stream factory where required by deterministic fixtures. Check new event variants and malformed-tool-argument behavior rather than discarding fields or weakening validation.

Retain existing ledger semantics and non-secret config paths unless a demonstrated target requirement forces a documented migration. Do not delete old sessions, reset history, or assume old Pi can read files newly written by the target.

Exit evidence: real SDK integration tests cover stable completion, abort/drain, replacement, reload, copied historical sessions, retained inspection, and process check-in ordering. Mock-only bootstrap tests do not establish this gate.

## Phase 4: Finish TypeScript, test-runner, and terminal changes

Keep strict NodeNext ESM, explicit `.js` local import specifiers, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and typed boundary validation. Derive types from target public declarations instead of reproducing SDK shapes. Do not add `any`, unchecked casts, `@ts-ignore`, or relaxed compiler settings to mask migration errors.

TypeScript 7 is a native compiler. Review the 6.0 and 7.0 migration notes, removed options, ambient `types` behavior, native platform packages, and declaration/source-map emission. Preserve `dist/src/index.js` and other executable paths used by scripts. No app compiler-API integration was found during this inspection; check installed tools before adding compatibility compiler packages. Test a representative typecheck/build inside B's actual sandbox too.

Read both the [Vitest 4 migration](https://v4.vitest.dev/guide/migration.html) and [Vitest 5 migration](https://vitest.dev/guide/migration/). Review mocks/spies, cleanup, test discovery, worker configuration, and Vite peer resolution. Vitest 5 clears mock history by default. Preserve test intent instead of blindly updating expected values or disabling new checks. Keep `environment:"node"` and the intended test file set. If needed, explicitly choose a supported process pool because existing integration tests use `process.chdir()` and process-local state.

Adapt TUI interfaces and test terminals, including `setProgramStatus()`, cursor markers, key parsing, Home/End behavior, and control-sequence handling. Verify the rendered terminal, not only component strings. Preserve F1/F3/F6 controls as applicable to the current baseline, draft ownership, model-picker progress/errors, resizing, retained history, cancellation, plain mode, terminal restoration, and color-free output.

Complete the TypeBox 1.4.2 compatibility checkpoint described above. Record any remaining direct-version exception with a reproduction, not a guess.

Exit evidence: strict check, focused tests, full intended suite, native build, and real PTY behavior pass with the frozen modern toolchain.

## Phase 5: Prove reproducibility and security before live use

After adaptation, perform a fresh install in the isolated migration checkout with the frozen lockfile. Review and permit the normal required install lifecycle, including the root `prepare` build, and verify that the documented `npm ci` path works. `npm ci --ignore-scripts` alone is not proof of a normal installation. See [npm's ci contract](https://docs.npmjs.com/cli/v11/commands/npm-ci/).

Run build-dependent checks sequentially. `build`, `verify:isolation`, and `verify:terminal` replace `dist`; concurrent tests can lose their isolated workers.

```sh
npm ci
npm ls --all
npm run check
npm test
npm run build
npm run verify:isolation
npm run verify:terminal
git diff --check
```

Use the selected Node/npm for these commands. Run focused tests during development, then the complete suite for the final candidate. Do not repeatedly broaden checks after a clean final run unless further edits or unresolved failures justify it.

Extend the existing security verifier to prove the new SDK's behavior with dummy secrets:

- No real key reaches Pi, tools, MCP, process environments, logs, sessions, caches, telemetry, or ledger records. Pi sees only a broker capability.
- All inference, including compaction and recovery, uses the selected role's broker and pinned endpoints/models. B has no cloud credential lookup or fallback. Provider refresh, auth discovery, telemetry, and cache warming cause no additional outbound work.
- Hostile `auth.json`, `models.json`, project resources, persisted tool declarations, and ambient auth cannot re-enable unsafe execution or authentication. A remains read-only through bash and MCP too.
- New/switch/model replacement/reload cannot restore unrestricted built-ins, native MCP, codemode, or tool search. A no-tools smoke session has an empty complete tool registry.
- Simultaneous A/B requests, creation/disposal of temporary catalog instances, and replacement cannot cross-wire broker tokens, providers, models, or accounting.
- Cancellation before preflight, during streaming/tools, at check-in, and during compaction leaves no owned work issuing late requests. The total deadline and bounded smoke request count still hold.

Run dependency audit and inspect actionable findings without `npm audit fix --force`. Record unavailable checks and any unresolved relevant findings. Add a rerunnable dependency check for declared direct imports, matching Pi versions, required engines, and forbidden active legacy imports. Historical reports are allowed to retain historical package names.

Write `docs/pi-upgrade-verification.md` with exact versions, starting baseline, commands, exit results, test counts, failure resolutions, evidence locations, dependency exceptions, and skipped live checks. Do not copy old verification counts as new evidence.

## Phase 6: Install and validate the trusted candidate

1. Update README, CONTRIBUTING, `.nvmrc`, secure setup, current security/architecture documentation, examples, and launcher prerequisites. Leave dated verification/research records intact; mark the old subagent report's version-specific conclusions as historical where they are used as current guidance.
2. After the source candidate passes dummy isolation and terminal checks, use the existing `secure:install` flow to create a new versioned trusted snapshot outside all writable agent workspaces. Never overwrite the old snapshot. Include the lockfile and a manifest of Node/npm/Pi/source versions and file hashes in the new installation so copied dependencies can be traced to the verified build.
3. Re-run dummy verification from the installed artifact, verify hashes, and run its doctor against the intended existing workspace. A successful source build or doctor alone is not live connectivity proof.
4. Only then run the existing one-request, token-capped, deadline-bounded OpenAI smoke through the new trusted artifact, using an existing approved credential and no tools/MCP/project resources. Never export the credential or run credential-backed agent-modifiable source. Keychain accounts are keyed by canonical workspace path, so testing a different worktree must not be mistaken for missing or invalid original credentials.
5. Run the local executor verifier against an already available selected model and disposable workspace. Do not download models or silently change the operator's loaded-model state. The live model-switch script changes server state and is separate from the deterministic model-switch tests; run it only when its restoration conditions and authorization are satisfied.
6. Treat missing live prerequisites honestly. Complete all available dummy checks and report the exact unverified live path. If private credential entry is required, the operator must use the existing native local flow; no credential belongs in chat or agent output.
7. If updating the local launcher is in the implementation run's scope, preserve its previous target, switch only to the verified candidate, and check the resolved artifact and ordinary launch path. Otherwise deliver the exact new runtime path and switch command without claiming the launcher was updated. Do not push, publish, or open a PR unless that delivery is requested.

The rollback unit is the previous runtime and Node environment plus the matching pre-migration state backup. A launcher rollback alone does not downgrade rewritten sessions. Never overwrite the originals during fixture migration or assume downgrade compatibility from the unchanged session version.

## Completion checklist

- [x] The frozen current stable Pi family is declared directly, consistently versioned, and reproducibly installed.
- [x] Current intended WIP behavior is preserved; unrelated work and old trusted artifacts remain intact.
- [x] Active legacy imports and obsolete adapters are removed. Any direct dependency exception has evidence and is visible.
- [x] New model/auth, tool registry, resource loading, lifecycle, transcript, and TUI contracts are implemented through public APIs.
- [x] Required typecheck, full tests, build, dummy isolation, and PTY checks pass against the actual candidate.
- [x] A fresh supported install and the separate trusted snapshot are verified. Live checks are individually passed or explicitly unverified.
- [x] Current docs and a new verification record match the implemented artifact. No subagent feature or unrelated redesign was added.

## Evidence and limits of this plan

The [source investigation](research/pi-upgrade-source-notes-2026-10-18.md) checks the released SDK and its published packages. The [dependency snapshot](research/pi-upgrade-dependencies-2026-10-18.json) records official registry metadata, runtime versions, and the original manifest/lockfile hashes. Source and documentation checks were performed for planning. No target dependency installation, migration build, app test suite, credential access, inference, or benchmark was performed in this planning task.

The [implementation prompt](pi-upgrade-implementation-prompt.md) delegates this plan as execution work. The implementer must recheck live versions and the working tree before changing them.
