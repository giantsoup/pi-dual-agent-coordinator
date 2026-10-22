# Set up isolated OpenAI API authentication

Use macOS, Node.js 24.22.0 LTS, npm 12.2.0, and Apple Command Line Tools. Keep the trusted
installation outside every workspace that agents can edit. Secure mode supports
approved `openai` Responses models for Agent A, with API-key authentication, and
downloaded tool-capable LM Studio models for Agent B without cloud credentials.

Start LM Studio's server on `127.0.0.1:1234` and download `qwen/qwen3.8-27b`.
The app loads it with a 65,536-token context when needed. The CLI commands are in the
[README](../README.md). Agent B defaults to `lm-studio/qwen/qwen3.8-27b` and API
thinking off. Doctor checks the downloaded model and its tool/context capabilities
through LM Studio's `/api/v1/models` endpoint; startup waits for loaded readiness.
An unavailable local model blocks startup; there is no cloud fallback.

## Prepare without a real key

1. Select the frozen project toolchain, verify its versions, and run `npm ci` and `npm run verify:dependencies` in the source checkout.
2. Run `npm run check`, `npm test`, and `npm run verify:isolation`.
3. Confirm that verification reports `outcome: passed` and assertion counts. It
   creates unique dummy credentials, checks the native secure entry dialog, and
   deletes its temporary Keychain item. A logged-in desktop and unlocked Keychain
   are required. Never waive a failed or unavailable check.
4. Prepare a fresh trusted installation outside the target workspace:

   ```sh
   npm run secure:install -- "$HOME/.local/share/pi-dual/runtime-1"
   ```

   Existing installation directories are never overwritten. Use a new directory
   when updating. Do not let an agent run against this installation or its parent
   as its workspace. The copy includes source, compiled app, native helper, lockfile, dependencies, Node 24.22.0, npm 12.2.0, and `installation-manifest.json`. It verifies copied bytes and executable modes. Run `bin/node scripts/verify-installation.mjs` inside the snapshot before using credentials.
   Installation runs a fresh build and checks the copied compiled provider broker
   with injected OpenAI and LM Studio streams. Active-stream, idle, and
   absolute-deadline results are bound to the broker hash in the manifest. A failed
   check leaves an incomplete snapshot without a success manifest. Do not activate that snapshot.
   Rerun `bin/node scripts/verify-provider-stream-deadlines.mjs` inside a verified
   snapshot to repeat the credential-free check.
5. Run doctor from that installation against the target workspace:

   ```sh
   "$HOME/.local/share/pi-dual/runtime-1/bin/node" "$HOME/.local/share/pi-dual/runtime-1/dist/src/index.js" doctor /absolute/project --no-mcp
   ```

   Missing credentials are expected before entry. Other failed checks need repair.
   Credential availability does not prove live API access.

## Create a dedicated project key

1. Create or select a dedicated project in [OpenAI Platform settings](https://platform.openai.com/settings/).
2. Create a project API key, with restricted permissions. Allow the permission
   needed to create responses at `POST /v1/responses` and count input tokens at
   `POST /v1/responses/input_tokens`, and deny unrelated endpoints.
   The app filters Pi's bundled model catalog to approved IDs and does not need to list OpenAI models,
   upload files, manage assistants, or administer the organization. Ensure that
   the owning identity's project role permits model requests and Responses access.
3. Set an expiration date. Record the key's dashboard identifier and expiry, never
   its literal value, in your operator records.
4. Review project model access, rate limits, and billing. Configure spend alerts
   for notifications. To stop traffic at a configured cap, enable an available
   **hard spend limit** explicitly. Alerts alone do not stop requests. Enforcement
   can lag tracked spend, so even a hard limit is not an exact instantaneous cap.

These instructions follow OpenAI's [production guidance](https://developers.openai.com/api/docs/guides/production-best-practices),
[permission model](https://developers.openai.com/api/docs/guides/rbac), and
[spend controls](https://developers.openai.com/api/docs/guides/spend-limits).

## Enter the key privately

Close terminal recording, screen sharing, and screenshots before entry. Use your
own local terminal, outside an agent-controlled capture. Do not enter the key in
chat, a shell argument, shell history, an environment variable, or a file.

Run this non-secret command from your own terminal:

```sh
"$HOME/.local/share/pi-dual/runtime-1/bin/node" "$HOME/.local/share/pi-dual/runtime-1/dist/src/index.js" setup /absolute/project
```

Setup reruns dummy isolation verification before opening a native macOS dialog.
Paste the real key only into that dialog's `NSSecureTextField`, then select
**Store in Keychain**. The native helper stores the key directly. The terminal
receives only a success or failure message. Cancel leaves the previous item intact.
Piped entry and noninteractive entry fail closed. Fixture entry modes accept only
strings beginning with `dummy-`; they cannot store a real OpenAI key.

The Keychain service is `com.pi-dual.openai.v1`. Its account is the SHA-256 hash of
the workspace's canonical path. Moving the workspace requires setup for the new
path. `auth.json` is never written. Non-secret coordinator defaults are saved in
`~/.pi/dual-agent-coordinator/config.json`. Existing unrelated credentials stay intact.

## Verify live access

Normal A requests also require access to Responses input-token counting. From a
verified installation, check that capability without generating model output:

```sh
bin/node scripts/verify-openai-context.mjs /absolute/credential-project
```

An optional second argument is a session JSONL path. The verifier reads a disposable
copy, counts its projected input, and checks the A budget without inference or tool
execution. It never changes the original archive. Counting access failure blocks
normal A requests; it does not fall back to byte-triggered compaction.

Run doctor again. Then run the bounded smoke check from the trusted installation:

```sh
"$HOME/.local/share/pi-dual/runtime-1/bin/node" "$HOME/.local/share/pi-dual/runtime-1/dist/src/security/smoke.js" /absolute/project
```

The smoke check uses the saved Agent A model and reasoning level, Pi 1.3.0's OpenAI Responses
provider, and the same private credential broker as normal runtimes. It disables
all tools, MCP, project resources, compaction, and coordinator workflow execution.
It permits one upstream request, at most 1,024 output tokens including reasoning, a 40-second broker
request deadline, and a 45-second session abort deadline. SDK retries cannot
create another authenticated upstream request. It reports only provider, model,
outcome, expected-response match, token counts, and elapsed time.

Step 0 is complete only when isolation checks pass and the live result is `passed`
with `expectedResponseReceived: true`. A missing key, inaccessible Keychain, failed
sandbox, or unavailable live request leaves Step 0 incomplete. Do not start later
terminal-plan steps on the strength of a mocked request.

## Migrate legacy plaintext credentials

Secure mode ignores Pi auth entries and blocks setup when `auth.json` contains an
`openai` entry. No auth command or `!` shell reference is evaluated.

1. Revoke any old literal OpenAI key that was stored in `auth.json`, a workspace,
   shell files, `.env`, logs, or transcripts. Remove copies privately.
2. Remove only the `openai` entry from `auth.json` using your own local editor.
   Preserve other provider entries. Do not print the file into an agent session.
3. Remove OpenAI API keys and endpoint overrides from the environment that starts
   this app. Do not unset or rewrite unrelated credentials.
4. Repeat dummy verification and private setup with a new project key.

Old `openai-codex` subscription entries remain untouched but are not used. Custom
`models.json` endpoints and executable auth references are not supported by this
secure path. The old model examples are reference material for standalone Pi,
not instructions for this app's secure setup.

## Rotate, revoke, and monitor

Create a replacement before expiry and run `auth /absolute/project` from the
trusted installation. Verify the replacement with the smoke check, then revoke
the old key in the OpenAI dashboard. Review per-key project usage in the
[usage dashboard](https://platform.openai.com/usage). Revoke immediately if exposure
is suspected. Delete a retired project's item using the macOS Keychain Access UI,
identified by service and the non-secret project account hash. The app provides
no secret-export command.

See [the security model](security-model.md) for supported tools and trust limits.

## Agent A model for Step 0

Agent A, the planner and reviewer, uses `openai/gpt-6-luna` with `thinkingA: "high"`.
The [official Luna model page](https://developers.openai.com/api/docs/models/gpt-6-luna)
identifies `gpt-6-luna` as the current snapshot and supports high reasoning through
Responses. Pi 1.3.0 supplies the descriptor and serializes effective reasoning
through request reasoning or transcript configuration updates. `src/security/models.ts`
filters the bundled catalog by approved IDs without loading arbitrary `models.json`
entries or endpoint overrides.
The bundled descriptor supplies context limits, compatibility flags, and pricing
tiers. Smoke output reports tokens rather than an exact bill. Cache warming,
install telemetry, and analytics are disabled. No cache warmer is constructed.

## Upgrade and rollback

Install every upgrade into a new snapshot. Keep the previous snapshot and its
Node runtime. Before allowing the new runtime to write real sessions, back up the
workspace-specific coordinator state and non-secret defaults privately. Do not
copy or export Keychain entries. Test old sessions on disposable copies first.

Rollback restores the previous snapshot, its matching Node environment, and the
matching pre-upgrade state backup. A launcher rollback alone does not downgrade
sessions written by Pi 1.3.0. Session version 3 does not establish downgrade
compatibility. See [the upgrade record](pi-upgrade-verification.md).
