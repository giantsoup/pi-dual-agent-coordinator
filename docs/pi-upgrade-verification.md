# Pi upgrade verification

Latest accepted artifact: the [dependency API audit follow-up](#dependency-api-audit-follow-up)
at the end of this record. Earlier counts and runtime paths below describe the
original migration and Qwen3.8 acceptance stages.

Implementation date: 18 October 2026. Migration branch: `codex/pi-upgrade-20261018`.
The migration worktree is `/Users/Taylor/pi-dual-agent-coordinator-pi-upgrade`.
The original checkout is `/Users/Taylor/pi-dual-agent-coordinator`.

This record separates baseline proof, candidate acceptance, and trusted live checks.
Source acceptance, installed-artifact verification, and bounded cloud/local checks
passed. Their separate evidence is recorded below; source compilation alone does
not establish those gates.

## Preserved baseline

The prompt described uncommitted work against `8532d2d`. At execution start,
`main` was clean at `7d245c1a1a690d891016eb138ed077dfa03d1dfa`, which already
contained the terminal, local-provider, model-picker, and response-repair work.
No stash, reset, clean, or blanket baseline commit was used. The dedicated worktree
starts from that commit. SHA-256 comparison verified all 252 inventoried application
and documentation files against the original checkout.

[The baseline inventory](pi-upgrade-baseline.json) records those hashes, the clean
status, and all 20 calculator/demo files excluded from migration. They were already
tracked in HEAD and remain unchanged. There were no untracked feature files to copy.
Ignored `dist`, dependencies, and test results were rebuilt in the migration worktree.
Original files, real state, and old trusted snapshots were preserved.

Old stack commands ran sequentially under host Node 24.10.0 and npm 11.6.0:

- `npm ci --ignore-scripts`: passed for baseline setup.
- `npm run build`: passed, including the native Keychain helper.
- `npm run check`: passed.
- `npm test`: 54 files, 359 tests passed.
- `npm run verify:isolation`: 284 dummy assertions and 2 security tests passed.
- `npm run verify:terminal`: 154 PTY assertions passed in TUI and plain mode.

Logs and the old dependency tree are in `/Users/Taylor/pi-upgrade-evidence-20261018/old-*`.
These counts describe this execution, not earlier verification reports.

## Frozen versions and provenance

The live npm registry and official GitHub stable release were rechecked at execution
start. Pi remains 1.3.0, so no additional release delta beyond the researched target
was introduced. The tag resolves to `71023aec1546d6d677a65669c5665c0927ce0dd0`.
The complete breaking-change sections of coding-agent, agent-core, ai, and TUI
changelogs from 0.67.68 through 1.3.0 were reviewed. TypeScript 6/7 and Vitest 4/5
migration notes were also inspected. Source downloads and extracted changelog
records remain in the external evidence directory.

Exact direct versions:

- `@earendil-works/pi-coding-agent`, `pi-agent-core`, `pi-ai`, `pi-tui`: 1.3.0 each.
- `typebox`: 1.4.2.
- `@modelcontextprotocol/sdk`: 1.32.1.
- `zod`: 4.6.7.
- `ajv`: 8.20.0.
- `typescript`: 7.0.2, `@types/node`: 24.19.2.
- `vitest`: 5.0.5, `vite`: 8.3.4.
- Node: 24.22.0 LTS. npm: 12.2.0.

[The frozen registry record](research/pi-upgrade-frozen-versions-2026-10-18.json)
contains provenance, package integrity, tags, engine requirements, and published
constraints. The Node archive was checked against the official SHASUMS256 file.
The scoped toolchain is `/Users/Taylor/pi-upgrade-evidence-20261018/toolchain/bin`.
The machine's global Node/npm defaults were not changed.

The direct TypeBox checkpoint first passed at Pi's 1.3.27 with strict checks,
real MCP execution, and 341 extended dummy-isolation assertions. At 1.4.2, strict
checking and 16 focused MCP/real-SDK tests passed. The final suite and isolation
checks below use 1.4.2. Pi's required nested 1.3.27 copies are intentional. No
TypeBox direct-version exception remains.

AJV is an additional exact direct dependency because the application now imports
its public JSON Schema validator to validate dynamic MCP schemas themselves,
then arguments, on both direct and proxy paths. `Type.Unsafe` supplies only the
static parameter declaration after schema compilation, never validation.
Draft 7 and 2020-12 schemas use their respective AJV implementations. A final
review reproduced rejection of valid Draft 7 tuple schemas by the 2020 validator;
the fix selects the declared dialect and tests valid, invalid, and extra tuple
items for both dialects. See [AJV dialect guidance](https://ajv.js.org/json-schema.html). Invalid or unresolved schemas fail closed.
Async schemas fail closed at compilation because MCP argument validation is
synchronous. Custom JSON Schema format annotations are not authorization rules.

Pi's exact internal and vendor SDK constraints were retained. No aliases,
installed-package patches, overrides, `--force`, or `--legacy-peer-deps` were used.
An initial audit found 10 vulnerable transitive packages. A targeted `npm update`
within published constraints updated 17 packages and cleared all findings.
The initial and updated audit JSON files are in the evidence directory. The final
audit result is recorded below. Pi's `@google/genai` preinstall is a no-op;
protobufjs's postinstall checks version schemes. npm 12 blocks dependency scripts
by default, so `allowScripts` records exact-version approvals for those two reviewed
scripts. The optional fsevents rebuild remains denied. Its shipped macOS binary
was imported successfully under Node 24.22.0. No global npm policy was changed. The TypeScript native platform package remains installed. The remaining install
warning is deprecated `node-domexception@1.0.0`, through Pi's pinned Google SDK,
`google-auth-library`, `gaxios`, and `node-fetch`. It is retained under the published
constraints and has no reported audit finding in this run.

## Implemented behavior

- Active Pi imports use the Earendil namespace, with all four imported Pi packages
  declared directly. The synchronous model picker reads bundled metadata without
  runtime/auth creation or networking. Existing approved model IDs remain explicit.
- At the operator's request, Agent B now defaults to `lm-studio/qwen/qwen3.8-27b`
  with API thinking off. Qwen3.6 and Qwen3 Coder Next remain explicit choices.
  Real SDK and model-switch fixtures exercise the namespaced Qwen3.8 ID.
- Async ModelRuntime owns only the selected broker model and capability. Other
  provider catalogs/auth adapters are disabled. Creation skips config and catalog
  refresh. All later refreshes force offline mode and the selected provider.
- Direct AgentSession construction retains sandboxed `baseToolsOverride`, complete
  role-specific tool allowlists, `usesDefaultTools:false`, and explicit native MCP,
  codemode, and tool-search exclusions. The app-owned MCP bridge remains sandboxed.
- MCP discovery builds its complete approved tool list before session construction.
  Invalid schemas and colliding/reserved names fail closed. Settings use the fixed
  public in-memory initializer; reload retains security settings. No cache warmer,
  native MCP, codemode, tool search, analytics, or install telemetry is registered.
- SessionManager projections restore canonical system/tool/conversation history.
  Inspection validates ancestry and never rewrites files. Session version remains
  3 without a downgrade-compatibility promise. Unfinished workflows do not resume.
- Awaited raw turn supervision remains in place. Managed prompts and the event
  bridge await outer settlement and preserve typed supervision/formatting failures.
  Cancellation clears queued work, aborts, and drains before releasing brokers.
- Strict NodeNext ESM and all existing strict checks remain enabled. The removed
  `esModuleInterop:false` option was deleted for TypeScript 7, and Node ambient
  types are explicit. Output paths, declarations, and source maps remain intact.
- Vitest uses the supported forks pool with at most two workers. The existing double-spy fixture now saves
  its original implementation, rather than recursively calling a replaced mock.
  Responses fixtures recognize trailing reasoning configuration updates. Compaction
  fixtures contain enough retained context to exercise actual target compaction.
- A final PTY run caught a picker key arriving before its first render. A focused
  regression failed with Agent A still selected. Input now synchronizes modal
  controls before dispatch, so B selection does not depend on the next frame.
  The original PTY assertion remains unchanged. Red/green logs are recorded.
- The TUI uses TuiMainScreen with the existing app-owned alternate-screen flow.
  Test terminals implement progress/status methods. Standalone render assertions
  strip terminal sequences, including the new APC cursor markers. Target keyboard
negotiation no longer needs the old 150 ms fallback workaround; shutdown uses the
public default input drain. Doctor enforces the supported Node 24.22+ range.
- `verify:dependencies` checks direct imports, exact pins, lock/install agreement,
  matching Pi versions, runtime declarations, the native compiler package, and
  forbidden active legacy imports. Historical reports retain historical names.
- Trusted snapshots include the selected Node/npm, lockfile, source and built files,
  dependencies, source identity, hashes, executable modes, and preserved symlinks.
  `scripts/verify-installation.mjs` verifies the resulting artifact.

## Candidate acceptance

The final run uses Node 24.22.0 and npm 12.2.0 from the scoped toolchain above.
The source install is normal `npm ci`, including root `prepare`, with the checked-in
npm 12 lifecycle policy. All builds and build-dependent checks run sequentially.

Heavy concurrent host activity caused whole-test five-second timeouts during three
runs. The default-worker run passed 360/366; a two-worker retry passed 358/366;
a one-worker retry passed 365/366. These are preserved as
`candidate-attempt4-loaded-host-tests.log`, `candidate-attempt5-two-workers-tests.log`,
and `candidate-attempt6-one-worker-tests.log`. No assertion, timeout, or test was
removed or relaxed. After the operator's LM Studio workload finished, the remaining
session-replacement test passed independently in 2.54 seconds including startup.
A later unrestricted-worker run still timed out in two tests, with 364/366
passing; its log is `candidate-attempt7-default-workers-tests.log`. The final
configuration caps Vitest at two fork workers to bound sandbox process startup
contention. The final full-suite command remains normal `npm test`. Earlier candidate runs passed all 365 then-existing tests;
the new picker race regression makes the final intended total 366. After the
operator requested Qwen3.8 as the default, 27 focused tests passed. The first
full run exposed eight assertions in a shared model-switch fixture that still
named the former default; 358/366 passed. The fixture now uses Qwen3.8, preserving
the same rollback and cancellation assertions. That failed run remains in
`qwen-default-stale-fixture-tests.log`. The table below records the subsequent run.

| Command | Result |
| --- | --- |
| `npm ci` | Passed; 244 packages installed, root prepare/native build completed |
| `npm ls --all` | Passed; no invalid peers or dependency-resolution errors |
| `npm run verify:dependencies` | Passed; 166 files, 9 directly imported package names, exact versions and native compiler checked |
| `npm install-scripts ls --json` | No unreviewed dependency lifecycle scripts |
| `npm run check` | Passed with strict TypeScript 7 |
| `npm test` | 55 files, 366 tests passed in 57.45 seconds; two fork workers |
| `npm run build` | Passed; expected JS, declarations/maps, native credential helper |
| `npm run verify:isolation` | 341 assertions and 2 security tests passed |
| `PI_TUI_SCREEN_CAPTURE=1 npm run verify:terminal` | 445 assertions passed; TUI/plain mode, rendered screen capture enabled |
| `npm audit --json` | Zero findings at every severity |
| `git diff --check` and staged equivalent | Passed |

Final logs are `/Users/Taylor/pi-upgrade-evidence-20261018/final-*`. Rendered
terminal screens, ANSI streams, and color/cell checks are in
`test-results/terminal-evidence` in the migration worktree. The PTY run checks
model selection/loading/cancellation, F1/F3/F6, draft retention, history, tool
output, scrolling, resizing, plain mode, startup failure, signals, and terminal
restoration against real Pi sessions with dummy providers. It does not establish
live provider behavior.

The shipped fsevents binding was imported again after the final fresh install;
`final-fsevents.log` records success. The dependency guard and strict check were
rerun after the last script/config changes.

## Trusted runtime and live verification

The final trusted installation is:

`/Users/Taylor/.local/share/pi-dual/runtime-pi-1.3.0-qwen3.8-20261018`

Its source commit is `5a3d7c270a134306c44de1de52327e34e2c3ae81`, with an empty
source diff at installation. The SDK migration is commit `1e579f63ad5e22eeebee7a547b25a9a97283269a`;
the second commit adds the requested Qwen3.8 default. The installation contains
its own Node 24.22.0 and npm 12.2.0. Its manifest covers 26,617 files and symlinks,
including executable modes. Final evidence-only documentation follows that source
commit; the trusted snapshot is not edited or rebuilt after installation.

Installed gates ran sequentially using the snapshot's own `bin/node` and `bin/npm`:

- Manifest verification before testing: all 26,617 entries passed.
- `npm run verify:dependencies`: passed with the copied exact dependency set.
- `bin/node dist/src/security/verify-isolation.js`: 341 assertions passed.
- `PI_TUI_SCREEN_CAPTURE=1 python3 scripts/verify-terminal.py`: 445 assertions passed,
  including rendered TUI/plain screens. No build ran inside the snapshot.
- Manifest verification after dummy checks: all entries remained unchanged.
- Doctor against `/Users/Taylor/pi-dual-agent-coordinator --no-mcp`: passed.
  The existing private Keychain account was available and Qwen3.8 was loaded and ready.
- Cloud smoke: passed through the trusted broker with `gpt-6-luna`, high reasoning,
  exactly `LOCAL_API_OK`, 1,836 ms, 1,573 input tokens and 7 output tokens.
  The smoke has one request, a 1,024-output-token cap, 40-second broker deadline,
  45-second session abort, no tools, no MCP, and no project resources.

The local verifier resolves the saved Agent B selection and requires it to be
already loaded with supported tools and context. It never loads or downloads models.
At the operator's request, the saved default changed from
`lm-studio/qwen3-coder-next` to `lm-studio/qwen/qwen3.8-27b`, with API thinking off.
The trusted configuration writer preserved every other field. The prior config
was separately copied into the private backup as `config-before-qwen-default.json`.
Before live verification, inventory showed only Qwen3.8 loaded, under the matching
`qwen/qwen3.8-27b` instance ID with 65,536 context tokens.

The live local executor check passed within its 120-second abort bound. Qwen3.8
invoked the actual sandboxed `write`, `read`, and `bash` tools. The disposable
`verification.txt` contained `LOCAL_EXECUTOR_OK`; the session finished normally
and the temporary workspace was removed. This proves tool execution for this
bounded task, not general coding quality.

After both live checks, LM Studio's downloaded-model inventory and loaded instance
IDs/context lengths matched the before snapshot exactly. No load/unload request
or model download was performed. All 26,617 installation manifest entries still
matched. The earlier candidate's complete 26,760-entry manifest also still matched.
Final preservation checks verified all 252 original source/doc hashes, the clean
original checkout, all 20 excluded demo files, all 15 private backup files, the
16 older runtime entry points, and the unchanged launcher hash. Existing workspace
history is unchanged. The requested saved Agent B default is the only intentional
real-state change. Evidence is in `saved-default.json`, `lm-studio-before.json`,
`lm-studio-after.json`, `installed-hashes-after-live.log`,
`previous-candidate-preservation.log`, and `final-preservation.json`.

The earlier candidate `/Users/Taylor/.local/share/pi-dual/runtime-pi-1.3.0-20261018`
remains intact. It also passed installed dummy gates and a bounded cloud smoke before
the Qwen3.8 request. Those logs are retained under the evidence directory's
`pre-qwen-default/`. Final installed logs are `installed-*`; rendered screens are in
the final trusted installation's `test-results/terminal-evidence` directory.

The existing `/Users/Taylor/bin/pi-dual` launcher remains unchanged. To use the
verified upgrade directly, run:

```sh
runtime=/Users/Taylor/.local/share/pi-dual/runtime-pi-1.3.0-qwen3.8-20261018
"$runtime/bin/node" "$runtime/dist/src/index.js" repl /Users/Taylor/pi-dual-agent-coordinator --no-mcp
```

No launcher switch, push, publication, or PR was performed. Live model switching
was not run because it changes LM Studio state. The deterministic suite covers
loading, cancellation, rollback, and failed restoration. No long-running live
A-to-B workflow, live configured MCP server, or inference benchmark was claimed.

## Rollback

Keep the original checkout and previous trusted snapshot. Switch back only with
its matching Node runtime and matching pre-upgrade workspace-state backup. Do not
point old Pi at newly written sessions based on the unchanged version number.
The native Keychain account remains keyed to the canonical original workspace.
No credential is exported or copied into the backup.

Before live checks, 15 existing state/config files were backed up and hash-verified
privately at `/Users/Taylor/.local/share/pi-dual/state-backups/pi-upgrade-20261018T205114Z`.
The backup manifest records exact original paths and hashes. It contains no exported
Keychain credential. The existing launcher still points to
`/Users/Taylor/.local/share/pi-dual/runtime-response-repair-20261018T200415Z`.

This continuation's shell resolves Node 24.14.0 and npm 11.9.0; no global toolchain
was changed by the migration. The current launcher uses `node` from PATH. Its
Node executable was copied and hash-verified as `previous-host-node` inside the
state backup, with provenance in `previous-node.json`. The initial old-stack
baseline above was run under the earlier session's Node 24.10.0/npm 11.6.0.
All candidate gates use the explicitly scoped 24.22.0/12.2.0 toolchain.

To roll back, stop coordinator processes first. Preserve the current config and
`~/.pi/dual-agent-coordinator/projects/6613200899766f20` under new archive names.
Restore `config.json` and `workspace-state` from the private backup to their
original paths recorded in `backup-manifest.json`. This preserves any newer
history separately instead of feeding it to the old SDK. Then use the matching
saved Node executable and old runtime:

```sh
backup=/Users/Taylor/.local/share/pi-dual/state-backups/pi-upgrade-20261018T205114Z
"$backup/previous-host-node" /Users/Taylor/.local/share/pi-dual/runtime-response-repair-20261018T200415Z/dist/src/index.js repl /Users/Taylor/pi-dual-agent-coordinator --no-mcp
```

The original source checkout is still clean at `7d245c1a1a690d891016eb138ed077dfa03d1dfa`.
The upgrade remains on its isolated branch/worktree. The current launcher already
points at the preserved old runtime; the command above also pins its saved Node.

## Dependency API audit follow-up

Completed on 18 October 2026. Application changes are commit
`05ed53401b8530d99c3a2dbec36bd844a8f842d0` on `codex/pi-upgrade-20261018`.
The [API coverage record](dependency-api-audit.md) maps all upgraded dependencies
to their callers, current public contracts, retained security adapters, and tests.
The fresh official registry check found no stable delta beyond the frozen versions
listed earlier. No package or lockfile change was required for this follow-up.

The follow-up corrects MCP shutdown ownership, preserves native Pi tool-error and
structured-result fields, validates worker JSON, collects paginated metadata,
validates structured MCP output including cached tools, and forwards cancellation
to metadata/resource/prompt requests. Cached protocol data is validated with SDK
schemas. Empty caches no longer share mutable state; completed and failed write
queues are released correctly. Unsupported task-only tools fail closed.

Deprecated Zod URL, strict-object, issue-code and error-option usage is migrated.
Configuration types derive from schemas; tool adapters and model-display types
use public SDK generics. Broker callback failures settle through Pi's assistant
stream protocol. Type-only imports and unused code are enforced alongside the
existing strict NodeNext checks. The dependency guard covers the Vitest config
and known legacy patterns. Existing roles, sandbox restrictions, history,
workflow ownership, and the requested Qwen3.8 default remain intact.

### Final source evidence

Evidence directory: `/Users/Taylor/pi-api-audit-evidence-20261018`.
The final sequential command script is `verify-final-source.sh`. All commands
used scoped Node 24.22.0 and npm 12.2.0; builds did not overlap tests.

| Gate | Result |
| --- | --- |
| Normal `npm ci` | Passed, 244 packages, prepare and native build completed |
| `npm ls --all` | Passed, no invalid resolution or peer errors |
| `npm run verify:dependencies` | Passed, 172 files and 9 imported external package names |
| Lifecycle-script inventory | No unreviewed scripts |
| `npm run check` | Passed, including new type-only and unused-code checks |
| `npm test` | 58 files, 384 tests passed in 62.73 seconds |
| `npm run build` | Passed |
| `npm run verify:isolation` | 341 dummy assertions and 2 security tests passed |
| `PI_TUI_SCREEN_CAPTURE=1 npm run verify:terminal` | 445 PTY assertions passed, TUI/plain and rendered capture |
| `npm audit --json` | Zero vulnerabilities |
| Working and staged diff checks | Passed |

Logs are `final-*`. The earlier passing sequence, before the last API cleanup,
is retained under `before-final-api-cleanup/`. Development failures and corrected
test assumptions are documented in the API audit; no tests, assertions, or
existing five-second Vitest limits were disabled or relaxed. Source terminal
screens and ANSI traces remain in the worktree's `test-results/terminal-evidence`.

### Installed and bounded live evidence

The new trusted installation is:

`/Users/Taylor/.local/share/pi-dual/runtime-pi-1.3.0-api-audit-20261018`

It was copied from clean commit `05ed534` with an empty source diff. It contains
its own Node 24.22.0/npm 12.2.0 and a manifest covering 26,631 files/symlinks and
executable modes. All copy hashes matched. The snapshot was never rebuilt or
edited after installation; verification output is confined to excluded test
artifacts. Installed logs are `installed-*` in the evidence directory above.

The separate gates ran in this order:

1. All 26,631 manifest entries verified.
2. Installed dependency guard passed.
3. Installed dummy isolation passed all 341 assertions.
4. Installed rendered terminal verification passed all 445 PTY assertions.
5. Every manifest entry still matched.
6. Doctor passed against the canonical original workspace with MCP disabled.
7. One-request OpenAI smoke passed using GPT-6 Luna/high through the trusted
   broker. It returned exactly `LOCAL_API_OK` in 2,064 ms, using 1,573 input and
   7 output tokens. The existing 1,024-output-token cap, 40-second broker deadline,
   45-second session abort, empty tool registry, and disabled project resources
   remained in force. No credential was exported or supplied to editable source.
8. The local verifier passed under its 120-second bound using the already-loaded
   `lm-studio/qwen/qwen3.8-27b`. This run invoked real sandboxed `write` and `read`
   tools and verified `LOCAL_EXECUTOR_OK` on disk. The disposable workspace was
   removed. This run did not invoke `bash`; the earlier Qwen acceptance did.
9. LM Studio inventory, loaded IDs and context lengths matched before/after:
   five downloaded LLMs, only Qwen3.8 loaded at 65,536 tokens. No load/unload or
   download request was made.
10. All 26,631 installed manifest entries still matched after live checks. Both
    earlier upgrade snapshots also passed their complete manifests, with 26,617
    and 26,760 entries respectively.

Preservation checks still verify 252 original application/doc hashes, 20 excluded
calculator/demo files, 15 private backup files, 16 older runtime entry points,
existing workspace history, saved defaults, and the launcher hash. During this
follow-up, an unrelated untracked `docs/agent-prompt-qa-plan.md` appeared in the
original checkout. It was left untouched, excluded from migration, and recorded
in `concurrent-original-work.json`. The original tracked checkout remains at
`7d245c1`; its status now includes that concurrent planning document. This is
separate from the clean migration branch.

### Use, rollback and remaining limits

Use the verified artifact directly:

```sh
runtime=/Users/Taylor/.local/share/pi-dual/runtime-pi-1.3.0-api-audit-20261018
"$runtime/bin/node" "$runtime/dist/src/index.js" repl /Users/Taylor/pi-dual-agent-coordinator --no-mcp
```

The existing launcher was not switched. The upgrade is committed in its isolated
worktree; the original branch was not merged, pushed, or published. All previous
runtime paths remain available. The earlier Qwen3.8 candidate can still be invoked
with its own `bin/node` and `dist/src/index.js`.

For a full pre-Pi rollback, stop the coordinator, archive current config/history,
restore the matching private backup at
`/Users/Taylor/.local/share/pi-dual/state-backups/pi-upgrade-20261018T205114Z`,
and use the saved Node plus old runtime command in the rollback section above.
Do not rely on a launcher change alone to downgrade newer session files. This
follow-up did not change real config or persisted workspace history.

The dependency exceptions remain Pi's nested TypeBox 1.3.27 and pinned vendor
constraints, including the transitive `node-domexception@1.0.0` deprecation. No
new exception or audit finding was introduced. Current direct versions are all
listed in the frozen-versions section.

Live model switching, a long-running live A-to-B workflow, third-party configured
MCP servers, and coding-quality benchmarks remain unverified. MCP contracts and
workflow/lifecycle behavior were tested with deterministic real SDK sessions;
cloud and local connectivity were verified only by the bounded checks described
above. These limits do not imply broader live verification.
