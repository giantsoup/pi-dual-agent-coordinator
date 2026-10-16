# Step 0 verification

This is the historical Step 0 record. Later terminal work is recorded in
[terminal verification](terminal-verification.md).

Date: 2026-10-16. Scope: credential creation, storage, tool isolation, and API
connectivity only. Steps 1-6 have not started. No commit, push, or PR was made.

## Working tree and baseline

The checkout was `main`. The only pre-existing change was
`TERMINAL_EXPERIENCE_PLAN.md`. Its updated content was preserved; this work changes
only Step 0's status line. No repository or ancestor `AGENTS.md` was present.
`CONTRIBUTING.md`, the architecture decisions, and the security model were read.

Installed Pi packages are 0.67.68, including `pi-coding-agent`, `pi-ai`,
`pi-agent-core`, and `pi-tui`. Dependencies and the lockfile remain unchanged.
Baseline typecheck, all 135 original tests, and build passed.

The first added regression test failed against the original tools: a protected
dummy outside the workspace was recoverable through a role read tool. The new
sandbox closes that path. Verification also caught the high-level Pi factory
rebuilding local tools; the implementation now uses `baseToolsOverride`.

## Latest completed checks

- `npm run check`: passed.
- `npm test`: 34 files, 133 tests passed. Obsolete subscription/plaintext setup
  tests were replaced with secure setup and doctor tests.
- `npm run build`: TypeScript and native Objective-C Keychain helper passed.
- `npm run verify:isolation`: passed, including 284 assertions and two focused
  security tests. All fixtures used unique dummy values.
- `git diff --check`: passed.

The assertion counts are storage 5, leakage 96, private entry 2, tools 42,
protected paths 16, role separation 7, startup 5, process inspection and task
ports 4, MCP 22, environment 3, provider policy 43, actual Pi runtime 18,
extension suppression 7, Luna/high-reasoning compatibility 13, and working-directory
cleanup 1.

The verifier uses actual role tools, the native Keychain helper and secure dialog,
Seatbelt subprocesses, configured stdio MCP launch paths, both Pi sessions,
direct/proxy MCP calls, coordinator-owned new/switch operations, session files,
telemetry, caches, and the ledger. It checks permission denials alongside normal
workspace reads, B writes/edits/test commands, and A listings. Captured artifacts
are scanned without printing dummy values. Temporary Keychain entries are deleted.

Invalid-credential responses exercise both actual Pi runtimes. Missing storage
is real; the locked-storage failure case is simulated through a failing backend.
The operator's login Keychain is never locked by tests. Redirect tests verify
`redirect: error` and rejection of 3xx responses. No live OpenAI call is used in
dummy verification.

## Operator prerequisites and live proof

A separate trusted installation was prepared outside the editable checkout.
Its initial compiled verifier independently repeated 265 assertions. Doctor
identified a legacy `openai` entry, a missing secure credential, and an unsupported
saved Agent B model. The operator completed private migration and native entry.
Subsequent doctor checks retrieved the credential successfully without exposing it.
The initial live Pi smoke using `gpt-5.4` returned `LOCAL_API_OK` in 1,927 ms,
with 1,021 input tokens and 7 output tokens.

At the operator's request, Agent A now uses `openai/gpt-6-luna` at high reasoning.
Agent B remains `openai/gpt-5.4`. Other saved defaults were preserved. Official
OpenAI model and pricing pages were fetched on 2026-10-16. Pi 0.67.68 has no Luna
catalog entry, so the app adds a fixed trusted descriptor. The installed Responses
provider was verified to serialize high reasoning. No dependency upgrade, arbitrary
model file, or endpoint override was enabled.

The updated trusted runtime is installed locally at
`~/.local/share/pi-dual/runtime-step0-luna-20261016`. It independently repeated all
284 dummy assertions. Its native credential helper is byte-identical to the first
verified installation, so private entry did not need to be repeated.

The live request through this updated installation passed:

```json
{"provider":"openai","model":"gpt-6-luna","thinking":"high","outcome":"passed","expected":"LOCAL_API_OK","expectedResponseReceived":true,"elapsedMs":1740,"inputTokens":1021,"outputTokens":7}
```

This was the app's actual Pi provider integration and trusted credential broker,
with tools, MCP, project resources, and compaction disabled. It permitted one
upstream request, at most 1,024 output tokens including reasoning, a 40-second
broker deadline, and a 45-second session abort deadline. No tool-enabled live
workflow was started.

A private in-process audit compared the stored credential and its common encodings
against 865 files in the workspace, coordinator persistence, and updated trusted
runtime. It found zero files containing the credential and zero unreadable files.
It skipped `.git` and `node_modules`; there were no skipped symlinks. The audit
reported counts only. Keychain contents and request authentication were never
printed or captured. The final diff check passed.

Step 0 is complete for this host and tested configuration. Steps 1-6 remain
unstarted. This verifies credential isolation and bounded connectivity, not Luna's
performance on planning/review tasks or a complete coding workflow.

## Trust limits

See [the security model](security-model.md) for the complete boundary. This is a
macOS-specific restriction on agent-controlled tools, not protection against a
compromised trusted client, same-account unsandboxed host software, administrator,
OS/kernel, or dependency. It is not a proof of absence of sandbox vulnerabilities.
It must be reverified on the deployment host after relevant changes.

Tools have no network access. HTTP/SSE MCP peers and executable Pi resources are
rejected. Sandboxed stdio MCP remains supported. These compatibility restrictions
are deliberate fail-closed behavior. They are not silently bypassed for a failed
test or an unavailable provider. Live smoke verification disables all MCP
and project resources regardless of the operator's normal configuration.
