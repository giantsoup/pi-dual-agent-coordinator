# Pi upgrade implementation prompt

Copy the following prompt into an LLM coding session with access to this repository:

```text
Implement the Pi and dependency upgrade in /Users/Taylor/pi-dual-agent-coordinator.

Read docs/pi-upgrade-plan.md in full and follow its phases and acceptance gates. Also read applicable AGENTS.md instructions, CONTRIBUTING.md, docs/security-model.md, docs/architecture-decisions.md, docs/execution-check-ins.md, docs/secure-setup.md, and docs/research/pi-upgrade-source-notes-2026-10-18.md. The plan is authoritative for scope; verify its dated facts against the current checkout and official sources.

The researched stable target is @earendil-works Pi 1.3.0, replacing @mariozechner 0.67.68. Recheck official stable releases at execution start, inspect any additional delta, freeze exact versions, and record them. Upgrade the directly imported Pi family, canonical TypeBox, MCP SDK, Zod, Node/npm declarations, TypeScript, Vitest, and its Vite peer as specified. Preserve Pi's own published transitive constraints. Complete and document the TypeBox compatibility checkpoint; never hide an exception or assume latest means compatible.

Preserve all existing work. This checkout contains substantial uncommitted terminal, model-picker, local-provider, runtime, test, and docs changes. Use an isolated migration branch/worktree containing the intended current application, with an inventoried and hash-verified WIP baseline. A worktree at HEAD alone is insufficient. Do not stash/reset/clean, commit everything, or include unrelated demo directories. Establish and record the old-version baseline before migrating.

Migrate through public target APIs. Address asynchronous ModelRuntime and credential ownership, metadata-only model catalogs, sandboxed executable tools, canonical schemas, system/tool transcripts, session restoration, awaited turn supervision, final settlement and abort/drain, model replacement, TUI contracts, and deterministic provider fixtures. Remove obsolete integrations in the same change. Keep strict TypeScript and NodeNext ESM; do not mask errors with any, unsafe assertions, ignored diagnostics, disabled tests, or relaxed checks.

Preserve A's read-only planning/sign-off, B's local execution, the approved workflow, model-picker behavior, retained history, and all credential/endpoint/sandbox restrictions. Disable new discovery, native MCP/codemode/tool-search registration, telemetry, catalog networking, and cache warming as the plan specifies. codemode.mode="off" is invalid. No subagent implementation or unrelated redesign belongs in this task.

Use real Pi sessions, deterministic providers, actual sandboxed tools, and PTY verification. Run builds and build-dependent tests sequentially. Prove the fresh lockfile install, strict check, full tests, build, extended dummy-secret isolation, terminal behavior, session compatibility, and cancellation. Review dependency/audit findings without force-based fixes. Add the rerunnable dependency checks and exact verification record described in the plan.

After dummy gates pass, prepare and verify a new separate trusted installation, preserving the old one. Follow the plan's credential-safe bounded cloud smoke and local verification gates. Never expose credentials, use real credentials from editable source, download models, or silently change loaded-model state. Report unavailable prerequisites and unverified paths precisely.

Continue through all executable phases without routine confirmation requests. Do not push, publish, or create a PR unless requested. Finish with changed files, exact versions and dependency exceptions, commands/results and evidence, the trusted artifact path, any launcher change, rollback instructions, and remaining limits. Claim only what the recorded checks prove.
```
