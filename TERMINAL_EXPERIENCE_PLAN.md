# Terminal experience plan

The main branch targets a readable, reliable terminal experience built on the Pi SDK
and `@mariozechner/pi-tui`. Keep the plain terminal fallback usable alongside the TUI.

Step 0 is a mandatory prerequisite. Complete its implementation, isolation tests, and live API check
before starting Steps 1-6. Missing credentials or unavailable verification do not waive this requirement.
Preparation and checks needed to deliver Step 0 belong to Step 0.

## Architecture and scope

- Keep workflow decisions, cancellation, runtime replacement, and persistence in the coordinator.
  Share those operations through the interactive service used by both terminal interfaces.
- Preserve the role split. Agent A plans and reviews with read-only tools. Agent B executes changes.
- Recognize workflow machine blocks only at stable `turn_end` boundaries.
  Rendering and partial streamed text must never trigger workflow transitions.
- Use discriminated unions for operation outcomes and lifecycle states where applicable.
  Keep the existing strict TypeScript settings and ESM import conventions.
- Reuse Pi's editor, Markdown, completion, selection, overlay, and keyboard APIs before adding custom equivalents.
  Check APIs against the installed version and lockfile. The reviewed baseline uses Pi `0.67.68`.
- Preserve setup, MCP support, activity history, and workflow persistence.
  Use OpenAI API-key authentication throughout this plan. ChatGPT subscription access is outside this work.
- Keep browser development on `feature/browser-experience`. Browser restoration and automatic
  continuation of interrupted coordinator workflows are outside this plan.

## Step 0: Create, isolate, and verify API credentials

Status: complete. Secure entry/storage, 284 dummy isolation assertions, required checks, and the live Pi-backed OpenAI API-key request passed. Agent A uses `openai/gpt-6-luna` at high reasoning. See `docs/step-0-verification.md` for evidence and trust limits. Steps 1-6 have not started.

### Define and enforce the credential boundary

- Read the repository instructions, architecture decisions, security model, and installed Pi APIs.
  Record the working tree state and preserve existing changes. Run baseline checks needed for this step.
- Protect the OpenAI key from both agents, their subprocesses, repository-supplied instructions,
  and untrusted tools. The trusted API client may use the key for provider authentication.
  The key must never enter model messages, tool responses, handoffs, or persistent transcripts.
- Put credential retrieval and authenticated requests behind a trusted client or broker separated from agent tools.
  Use an OS-enforced sandbox, separate execution identity, or an equivalent enforceable boundary.
  Document the chosen design and its trust assumptions in `docs/security-model.md`.
- Keep credential files, the credential store, trusted client memory, and its process environment inaccessible
  to agent-controlled file tools, shell commands, process inspection, and credential-store commands.
  A path denylist or shell-command filter alone is insufficient for an unrestricted shell.
- Give agent tools and MCP subprocesses an allowlisted environment without the OpenAI key.
  Prevent bypass through alternate tools, runtime replacement, or project-local extensions running in a trusted process.
  Disable or isolate extensions that cannot meet the boundary.
- Allow authenticated requests only to explicitly trusted provider destinations.
  Reject untrusted endpoint overrides and credential-forwarding redirects. Never offer a raw-secret export operation.
- Fail closed when secure storage, isolation, or credential retrieval is unavailable.
  Report a safe diagnostic instead of falling back to plaintext storage or unrestricted execution.
  Document that a compromised trusted client or privileged host administrator is outside this protection.

### Create and store the project key

- Implement storage and entry with dummy secrets first. Request a real key only after the isolation checks below pass.
- Provide operator instructions to create a dedicated OpenAI project API key with the minimum permissions
  needed by the configured inference endpoint. Record only a non-secret key identifier if needed.
  Set an expiration and document rotation, revocation, and usage monitoring.
  Distinguish spend alerts from any enforced spending limits.
- Have the operator create and enter the real key through a private local flow outside agent-visible capture.
  Never ask for the key in chat or place it in a command argument, shell history, screenshots, or recorded terminal output.
- Store the key in macOS Keychain or an appropriate local secret manager accessible only through the trusted boundary.
  Store references and non-secret configuration in Pi or coordinator config as required by the integration.
  Do not save the literal key in `auth.json`, `.env`, shell startup files, or repository files for this setup.
- Replace the wizard's current plaintext-storage recommendation for this secure setup.
  Reject unsafe secret entry when a private interactive prompt is unavailable.
  Keep existing unrelated credentials intact and give explicit migration guidance for any legacy plaintext OpenAI key.
- Keep authentication headers and secret-bearing errors out of debug logs and telemetry.
  Redact sensitive arguments and results before model exposure or persistence as an additional safeguard.
  Preserve useful diagnostics without raw request headers, environment dumps, or credential payloads.

### Prove isolation and live access

- Build a repeatable verification command or test suite using unique dummy secrets.
  Exercise the actual tools supplied to Agent A and Agent B, including runtime replacement and configured MCP launch paths.
- Verify that absolute paths, home paths, traversal, symlinks, shell commands, inherited environments,
  process inspection, and credential-store commands cannot recover a dummy protected key.
  Verify normal workspace reads, writes, and test commands still work within each role's permissions.
- Check prompts, tool results, telemetry, session files, ledgers, stdout, stderr, and error paths for dummy-secret leakage.
  Test invalid credentials, unavailable or locked storage, rejected endpoints, redirects, and isolation startup failure.
  Report assertions and counts rather than secret values.
- After dummy-secret checks pass, run one bounded, minimal no-tools request through the installed Pi provider integration
  and the trusted credential path, using the configured OpenAI API model. A direct request that bypasses this integration
  does not prove the app's authentication path works. Disable MCP and project resources for this connectivity check.
- Use a benign prompt such as "Reply exactly LOCAL_API_OK" with bounded output and a timeout.
  Report only the provider, model, outcome, expected response, and safe timing or usage metadata.
  Keep real credential material out of captured output, including on failure.
- Run `npm run check`, `npm test`, and `npm run build`, plus the new isolation verification.
  Update setup documentation and `doctor` so they describe and validate the secure credential path accurately.

Acceptance: all credential isolation checks pass, normal permitted tools still work, and the live Pi-backed
request returns the expected response using API-key authentication. Review the diff and verification output
for secret exposure. Record non-secret evidence and remaining trust limits. A no-tools request alone,
file permissions, an ignored `.env`, Keychain storage alone, or log redaction alone cannot satisfy this step.
If operator key creation or local entry remains pending, leave Step 0 incomplete and do not begin Steps 1-6.

## Step 1: Confirm the completed cleanup and establish a baseline

The terminal cleanup landed in `2290d60`, and `feature/browser-experience` preserves the browser work.
Do not repeat the removal. Verify the current checkout before starting improvements.

- Read `CONTRIBUTING.md`, the architecture decisions, and the security model.
- Record the branch, working tree state, installed dependency versions, and existing failures.
  Preserve unrelated work. Do not require a clean tree by discarding or committing user changes.
- Run `npm run check`, `npm test`, and `npm run build`.
- Verify TUI and plain terminal startup and shutdown using isolated test state.

Acceptance: distinguish passing checks from existing failures and unavailable live prerequisites.
Do not describe unperformed checks as passing.

## Step 2: Make input and live updates dependable

- Separate submission acceptance from completion of the resulting work.
  Clear the submitted text when accepted, then preserve anything typed during the run.
  Preserve or restore rejected input without overwriting a newer draft.
- Allow one work submission at a time. Block additional prompts and workflow-changing commands while busy,
  with a visible explanation. Keep drafts editable and help, status, cancellation, and exit available.
  Do not add implicit steering or follow-up queues.
- Enforce the busy policy in the shared service or coordinator, not only in the TUI.
  Distinguish an idle planning session from an active planning request.
- Publish progress before the prompt promise resolves. Preserve the existing regression test for this behavior.
- Retain completed user-facing assistant messages exactly once, including useful execution and review messages.
  Identify messages by role, session, and an appropriate request or turn identity.
  Reconcile streaming commits with final result entries to avoid duplicates.
- Prefer authoritative completed message text when finalizing a stream.
  Label interrupted output and retain it when useful. Ignore stale events from replaced or cancelled operations.
- Keep workflow machine blocks out of ordinary prose presentation without changing their validated persistence.
- Show idle, running, waiting for approval, cancelling, completed, failed, and cancelled outcomes accurately.
  Publish approval and execution-start feedback when execution begins, rather than after the entire run finishes.

Acceptance: while a delayed request runs, progress remains visible and a new draft survives completion,
failure, and cancellation. Repeated submit attempts do not start concurrent work or lose input.
Committed assistant text remains visible exactly once, including when a response has no text deltas.

## Step 3: Add cancellation and define recovery behavior

- Add a coordinator-owned cancellation operation, exposed through both terminal interfaces and `/cancel`.
  Use the Pi session cancellation API through the runtime abstraction.
- Stop the active run and prevent later automatic execution, review, repair, or handoff work from starting.
  Settle pending prompt and turn waiters, release busy state, and handle late events safely.
  Make repeated cancellation requests harmless.
- During active work, Ctrl+C requests cancellation and preserves the draft.
  Esc closes the active overlay or returns focus to the editor.
  While idle, retain clear-draft and deliberate repeated-Ctrl+C exit behavior with accurate hints.
  Keep `/quit` available during work and route it through cancellation and cleanup.
- Record cancellation and timeout outcomes durably. Preserve compatibility with existing ledgers and replay.
  An interrupted run must not appear completed or restart automatically after recovery.
- Separate provider retries from rerunning a coordinator workflow.
  Keep provider retry behavior aligned with Pi settings. Require an explicit operator action to rerun work
  that may already have changed files or invoked mutation-capable MCP tools.
- Define and document timeout configuration, its default, and whether it measures total duration or inactivity.
  Route deadline expiry through cancellation and cleanup. Reject timeout implementations that leave work running
  after the UI reports failure. Explain any tool-specific cancellation limits.
- Distinguish viewing saved history, switching a role's Pi session, and starting a fresh session.
  Session switching restores that role's conversation context. It does not resume a coordinator workflow.
  Retain the current fresh-start policy for unfinished recovered workflows and make supersession visible.
- Keep all runtime replacements coordinator-owned and rebind session subscriptions and extensions afterward.
- Restore terminal input mode, cursor visibility, and the main screen on normal exit, handled errors,
  and supported shutdown signals. Clean up partially initialized services after startup failure.

Acceptance: cancel during planning, Agent B execution, and Agent A review. No next stage starts afterward,
and a subsequent request works. Test repeated cancellation, cancellation racing with completion, timeout,
prompt failure before `turn_end`, and restart from interrupted work. Exit and failure paths release resources
and restore the terminal. Cancellation preserves completed file changes and does not claim to roll them back.

## Step 4: Improve transcript readability and layout

- Render Markdown and fenced code with the existing terminal toolkit.
- Give the conversation most of the screen and make diagnostic details optional.
- Support at least `80x24` and `120x40` terminal sizes with the editor and next action visible.
  Cap the multiline editor height so conversation and controls remain usable.
- Below `80x24`, use a compact layout or a clear size notice that preserves resize and exit handling.
  Bound panels and overlays to the actual available rows and columns.
- Preserve the reader's transcript position while new output arrives.
  Follow new output automatically only when the reader is already at the end, with a way to return there.
- Use display-cell and ANSI-aware sizing for Unicode, emoji, wrapped prose, and code.
  Preserve cursor and focus behavior across resizing and overlay changes.
- Use Pi's `matchesKey` and `Key` helpers for application shortcuts.
  Support both traditional escape sequences and the Kitty keyboard protocol.
- Define input precedence: global cancellation and exit, active overlays, focused controls, then the editor.
  Reserve Tab for editor completion and use a separate documented shortcut for pane focus.
  Keep keyboard hints specific to the current context.
- Cache completed message layouts by content and width, and reflow active content as needed.
  Keep typing and scrolling responsive during long streams.

Acceptance: verify the supported sizes, smaller windows, repeated resizing, long transcripts, multiline drafts,
fenced code, wide Unicode characters, bracketed paste, and overlay focus restoration.
Opening an overlay or receiving output must not erase input or move a reader away from older messages.

## Step 5: Finish everyday terminal controls

- Add slash-command completion and prompt history through the existing editor APIs.
  Keep completion suggestions consistent with the commands actually accepted by the shared parser.
  Preserve the current draft when navigating back out of history. In-memory history is sufficient initially.
- Select saved sessions by role without typing file paths. Show enough identity and project context
  to distinguish sessions. Keep existing path-based commands available in the plain terminal.
  Viewing history must not change runtime bindings until the operator selects a session.
- Provide terminal controls for each role's model and supported thinking level, plus coordinator defaults
  already owned by the app. Discover available models through Pi's configured registry.
- Allow model, session, and configuration changes only while idle.
  State whether each choice affects the next operation, the current session, or saved defaults.
  Make saving defaults an explicit choice. Preserve Step 0's credential boundary and Pi's provider configuration.
- Validate model and authentication availability before applying a selection.
  A failed selection leaves the prior usable configuration intact.
- Preserve role tool permissions and coordinator ownership when applying model or session changes.
- Give the plain terminal command equivalents for workflow-affecting controls.
  Update help, the README, and relevant examples alongside behavior changes.

Acceptance: completion and pane navigation both work. History navigation preserves drafts.
Session and model selection are unambiguous, reject changes during a run, and recover from invalid choices.
Verify both temporary choices and explicitly saved defaults across restart.

## Step 6: Verify complete terminal workflows

Verification accompanies every step. Use this final step to check the combined behavior.

- Add focused regression tests for each changed behavior before proceeding to the next step.
  Prefer the real store, service, event bridge, and terminal components with controllable runtimes.
  Add terminal or PTY coverage for input, sizing, and restoration that helper-function tests cannot prove.
- Exercise planning, revision, approval, execution, review, and final output through the running TUI.
- Cover plan discard, provider failure, tool failure, review caps, cancellation, timeout, session replacement,
  restart, and clean shutdown. Check that Agent A stays read-only and failed or cancelled work cannot bypass approval.
- Verify plain terminal parity for workflow outcomes, cancellation, errors, recovery, and persistent state.
  Identical screen presentation and interactive selectors are not required.
- Use isolated session roots and temporary workspaces for automated and live mutation checks.
  Keep real credentials out of fixtures, logs, and committed artifacts.
- Run `npm run check`, `npm test`, and `npm run build` after the completed changes.
  Run focused checks after each step, then the full checks at integration boundaries.
- Validate at least one real Pi planning session and one approved execution-and-review cycle with configured models.
  Record models and observed results without secrets. If credentials, endpoints, or terminal access are unavailable,
  report the exact unverified cases and complete all independent checks.

Acceptance: report the checks actually run, their results, and any remaining limitations.
Keep the plan's progress and user documentation consistent with the delivered behavior.
Do not mark a step complete solely because the code compiles or simulated runtimes pass.

## Implementation starting points

- `src/app/setup.ts`, `src/app/doctor.ts`, and `src/app/coordinator-config.ts`: private credential setup and non-secret defaults.
- `src/tools/create-role-tools.ts`, `src/mcp/client-pool.ts`, and `src/runtime/create-role-runtime.ts`:
  credential isolation across tools, subprocesses, extensions, and model requests.
- `src/telemetry/event-normalizer.ts`, `src/telemetry/logger.ts`, and `docs/security-model.md`:
  secret handling, diagnostics, and documented trust boundaries.
- `src/app/tui/app.ts` and `src/app/tui/bootstrap.ts`: editor, input routing, rendering, and terminal lifecycle.
- `src/app/interactive/service.ts`, `store.ts`, and `presentation.ts`: shared actions, state, stream commits, and transcript entries.
- `src/app/plain-repl.ts`, `cli.ts`, and `repl-progress.ts`: plain terminal behavior, command parsing, and help.
- `src/coordinator/coordinator.ts`, `bind-runtime-events.ts`, and `workflow-orchestrator.ts`: operation ownership and handoff lifecycle.
- `src/runtime/create-role-runtime.ts` and `src/runtime/rebind-runtime.ts`: session capabilities and runtime replacement.
- `src/persistence/` and `src/types/`: durable outcomes, replay compatibility, and lifecycle contracts.
- `test/unit/tui-app.test.ts`, `test/unit/interactive-service.test.ts`, and `test/unit/runtime-event-bridge.test.ts`:
  existing focused coverage. Extend integration and replay coverage where behavior crosses those boundaries.
