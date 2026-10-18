# Terminal implementation verification

Date: 2026-10-16. Branch: `main`. The initial working tree was clean, including
the updated terminal plan. No repository or ancestor `AGENTS.md` was present.
The cleanup in `2290d60` and browser branch were verified, not repeated.
No commit, push, or pull request was made.

The implementation followed Steps 1 through 6. Step 0 remained complete. Its
historical evidence is in [Step 0 verification](step-0-verification.md).
Installed and locked Pi packages remain `0.67.68`; dependencies were not upgraded.
The installed `AgentSession.abort`, session construction and restoration,
Markdown, Editor, completion, SelectList, overlay, and key APIs were checked.

## Baseline

`npm run check`, all 133 original tests, and `npm run build` passed before changes.
Both terminal interfaces started and exited in an isolated PTY harness. The first
TUI probe sent Enter before initialization and was inconclusive. Waiting for
terminal initialization produced a successful `/quit` and screen restoration.

## Delivered behavior

The shared service accepts one work request, preserves new and rejected drafts,
and publishes progress before completion. Completed assistant prose is retained
once, including execution and review text. Final authoritative output replaces
partial text. Workflow machine blocks stay hidden from prose presentation.

Cancellation and deadlines belong to the coordinator. They abort Pi, stop later
stages, wait for cleanup, and record durable terminal outcomes. Completed changes
remain on disk. Session switching restores context without resuming coordinator
work. Recovery retains the fresh-start supersession policy.

The TUI uses Pi Markdown, completion, editor history, selectors, overlays, and
key matching. It supports the planned terminal sizes, a compact notice below
those sizes, optional activity details, transcript scrolling, and draft-preserving
history navigation. Session, model, thinking, review-cap, and timeout controls
have plain terminal equivalents. Saving defaults requires an explicit command.

## Repeatable checks

Final results:

- `npm run check`: passed with the repository's strict TypeScript settings.
- `npm test`: 39 files and 174 tests passed, including the original streaming-progress regression.
- `npm run build`: TypeScript and the native Keychain helper passed.
- `npm run verify:isolation`: passed all 284 dummy assertions and focused security tests.
  The compiled verifier was also repeated after integration and passed all 284 assertions.
- `npm run verify:terminal`: passed 44 PTY assertions across both interfaces,
  shutdown signals, repeated Ctrl+C, and partial startup failure.
- `git diff --check`: passed.
- A private in-process credential audit scanned 820 workspace and live-verification
  files. It found zero files containing the key or its common encodings, zero
  unreadable files, and no skipped symlinks. `.git` and `node_modules` were excluded.

The repeatable commands are:

```sh
npm run check
npm test
npm run build
npm run verify:isolation
npm run verify:terminal
```

The regression suite covers busy rejection, progress before completion,
authoritative stream reconciliation, stale session events, draft survival,
planning/execution/review cancellation, repeated cancellation, deadlines,
provider rejection before `turn_end`, cancellation recovery, model preparation
failure, session restoration, explicit default saving, and MCP request abort.
Existing workflow tests cover revision, repair, review limits, and replay.

The PTY verifier runs actual Pi sessions against dummy Responses fixtures and
uses real sandboxed tools in disposable workspaces. It exercises planning,
revision, discard, approval, execution, review, exact file contents, transcript
retention, delayed progress, busy rejection, draft survival, cancellation during
planning, bash execution, and review, deadline expiry, provider and tool failure,
review caps, resizing, paste, selectors, and exit during active work. It also
checks repeated idle Ctrl+C, SIGTERM, SIGHUP, SIGINT, partial terminal startup
failure, raw input restoration, cursor visibility, and alternate-screen cleanup.
Dummy provider fixtures are not live API evidence. The input-mode check compares
terminal flags and control characters while ignoring macOS's transient `PENDIN`
retype flag. Startup-failure coverage caught Pi's 150 ms keyboard fallback firing
after cleanup. The final cleanup drains input before stopping the terminal and
checks that the fallback protocol is disabled afterward.

## Initial live Pi API workflow (before the local B migration)

A separate trusted snapshot of the implementation ran in a real 120x40 PTY,
with an isolated workspace and session root. The trusted verification runner
retrieved the existing project's Keychain credential only inside the broker.
It used the trusted runtime test seam to select that account while confining
tools to the temporary workspace. Normal CLI credentials remain path scoped.
No new credential entry, plaintext key, or credential export was created.
MCP and project resources were disabled for the live check.

Observed results:

- Agent A: `openai/gpt-6-luna`, high thinking.
- Agent B: `openai/gpt-5.4`, medium thinking.
- Planning returned a pending plan. No file existed before approval.
- `/approve` started B execution, followed by A review.
- The workflow completed. `greeting.txt` contained exactly
  `TERMINAL_LIVE_OK` followed by one newline.
- Elapsed time: 17,166 ms for planning, approved execution, and review.
- Exit code: 0. Main screen and input mode restoration passed.

The live request used the installed Pi OpenAI Responses integration and trusted
broker. Later presentation and cleanup corrections were checked by deterministic
and PTY regressions. The live test was one bounded coding cycle, not a measure of
model quality on general tasks.

## Follow-up QA

A standards and specification review found and fixed the following defects:

- Pi preflight could outlive cancellation and issue a late request. A managed
  prompt now owns preflight, agent events, and post-turn compaction until cleanup.
- Pi's generic `/new` converted memory sessions to workspace files. Fresh managers
  now preserve the selected storage mode through resets and model replacement.
- History preview could repair corrupt files in place. It now parses without writes,
  rejects invalid or cyclic ancestry, and leaves current bindings usable on failure.
- Escape was swallowed before Pi completion could dismiss its menu. Multiline
  history cursor movement also skipped newer entries. Both have editor regressions.
- One cleanup failure could skip the second role or strand configuration ownership.
  Cleanup now attempts every owned release and always releases configuration state.
  Installing a new model clears the old pending plan before disposing the previous runtime.
- Pi resource reload discarded the initial retry setting, and the OpenAI SDK had
  a separate HTTP retry path. Seeded memory storage and broker response policy now
  preserve explicit-retry behavior. A real HTTP 503 regression checks one upstream
  request, durable failure, and a successful explicit retry.
- Execution status now waits for the durable workflow record; a regression
  deliberately delays persistence to verify the status transition.
- Rejected command copy no longer claims an active operation was stopped.
- Abort failures drain both roles and record a durable failure. Invalid saved
  review limits and deadlines now produce configuration warnings.
- The no-tools verification path preserves Agent A's explicit reasoning setting;
  a regression verifies high reasoning in the actual Responses request payload.

The QA regressions use real installed Pi runtimes, dummy Responses fixtures, and
isolated workspaces. They include real post-turn compaction cancellation and
verify that cancellation remains pending while preflight drains. Both terminal
interfaces passed the complete 44-assertion PTY suite after these fixes. The
required TypeScript checks, complete test suite, native build, and isolation suite
were repeated in an isolated copy after the LM Studio migration settled. The
source, test, script, and native-file hashes matched the checkout during the
final run. Local launch instructions are in [terminal controls](terminal-experience.md).

## Final combined live workflow and local readiness

After the user-directed LM Studio migration settled, the final source matched
all 134 files in the verification manifest. A separate verification copy ran
checks sequentially so concurrent builds could not remove active sandbox workers.
Strict TypeScript checks, 174 tests across 39 files, native builds, 284 isolation
assertions, and all 44 PTY assertions passed. The Pi dependencies and lockfile
remain unchanged.

A fresh trusted installation passed doctor against the existing checkout,
including Keychain availability and the loaded local executor's 65,536-token
context. The existing path-scoped credential was reused; no setup or key entry
was repeated. The live 120x40 terminal cycle used the same private broker seam
described above to confine file mutations to a temporary workspace:

- A: `openai/gpt-6-luna`, high reasoning.
- B: `lm-studio/qwen3.6-35b-a3b`, API thinking off, fixed loopback endpoint.
- Planning waited for approval and made no file changes.
- Approved B execution and A review completed in 18,994 ms.
- `greeting.txt` contained exactly `TERMINAL_LIVE_OK` and one newline.
- Exit code 0; main screen and terminal input mode restored.

A private post-run audit scanned 485 checkout and live-check files with zero
credential or encoded-credential findings, zero unreadable files, and zero
unexpected symlinks. Git metadata, dependencies, and the trusted runtime link
were excluded. Temporary live files were removed after verification. The trusted
installation remains available for local testing; no commit, push, or PR was made.

## Limits

External MCP side effects cannot be rolled back or certified by the local
fixture. Cancellation waits for Pi and tool cleanup; server cooperation and SDK
request deadlines limit metadata cancellation. Registry availability does not
prove API access to every listed model. Only the configured OpenAI and LM Studio models above were
verified through live inference. External MCP servers and their side effects
were not exercised by this final live cycle.

The macOS isolation and trusted-client limits from the security model still
apply. Other operating systems fail closed. Browser restoration, automatic
workflow continuation, steering, and submission queues remain outside scope.

## Selected current-workspace implementation

The later option 3 implementation starts from the dirty 174-test/44-PTY baseline
described in [current workspace verification](current-workspace-verification.md).
That report records the delivered history rail/control, durable read-only
inspection, contextual help, additional checks and current limitations. The
historical live-provider evidence above was not rerun or relabelled as part of
this fixture-backed UI task.

## Portable controls verification, 2026-10-18

Implemented on `codex/portable-controls` in an isolated worktree from `main` at
`0ebeefa`. The original checkout remains clean on `main`. No merge, push, or
trusted-runtime installation was performed.

The editor's Esc menu exposes help, models, activity, workspace, request history,
previous prompts, latest output, newline insertion, cancellation, and confirmed
quit. Contextual footers, picker hints, README, and the terminal guide describe
the controls. Existing function-key bindings remain optional aliases.

Final checks on the feature code:

- `npm run check`: passed.
- `npm run build`: passed, including the native helper.
- `npm test`: 371 tests across 54 files passed.
- `PI_TUI_SCREEN_CAPTURE=1 python3 scripts/verify-terminal.py`: 498 assertions
  passed across TUI and plain modes, using an isolated Python environment with
  `pyte` and `wcwidth`. Captured 35 terminal screens, including the new menu at
  80x24 and 40x12, with dimensions, control visibility, and color checks.
- `git diff --check`: passed.

New regressions exercise separate, combined legacy, and Kitty-encoded keys;
newline insertion at the cursor; ordinary typing; completion dismissal;
prompt-history restoration; pane navigation; help restoration; scrolling;
resizing; pasted commands; cancellation; and quit confirmation. A real PTY run
caught model-picker input arriving before its first render. Input now initializes
the picker from the current modal state before dispatching the key, and a
regression covers that ordering. Screen checks allow Pi's editor caret while
rejecting inverse text outside the editor.

The PTY run uses installed Pi runtimes, dummy provider fixtures, and disposable
workspaces. It does not certify live-provider behavior or physical keyboard
handling in every terminal. Screen evidence is generated under
`test-results/terminal-evidence/` and is not committed.

### Integration with upgraded main

Before delivery, integrated `main` at `3524d25` into the feature branch. Resolved
conflicts by preserving Pi 1.3.0 imports, eager modal initialization, and the
Qwen3.8 Off/Low/Medium/Xhigh reasoning controls alongside the portable shortcuts.

The combined candidate passed a normal `npm ci` and native build using Node
24.22.0/npm 12.2.0, the dependency guard, strict TypeScript checks, all 404 tests
across 58 files, 341 dummy isolation assertions, and 500 rendered PTY assertions
across TUI and plain modes. The supported toolchain and lockfile are unchanged
from upgraded main. This supersedes the older dependency-specific verification
counts above for the delivered integration.

Delivery rebuilds `dist` from scratch and creates a new immutable trusted runtime
for the launcher. Keyboard controls have no persisted asset cache to invalidate;
coordinator history, saved settings, and MCP metadata caches are preserved.
