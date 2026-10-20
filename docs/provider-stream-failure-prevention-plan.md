# Provider stream failure and prevention plan

Investigation date: 20 October 2026. The source implementation now includes the
deadline fix, retained failure attribution, regressions, and prepared-artifact
gate. The incident evidence below describes the original failure. Current
acceptance results are recorded in [provider stream verification](provider-stream-verification.md).

The coordinator aborted Agent B's active LM Studio response after a fixed
120-second deadline. B was still receiving tokens and preparing a `write` call.
The broker then destroyed its downstream response, so Pi reported only
`terminated`. The workflow stopped before that write executed.

An older trusted runtime contains the intended inactivity-timeout behavior.
The running installation, current launcher target, and current source lack it.
This is both a timeout defect and a delivery gap in preserving a previously
working change. Increasing the outer workflow timeout does not fix it.

## Incident evidence

The screenshot matches these private, read-only records. Times below are PDT.
Coordinator JSONL timestamps use UTC, seven hours ahead.

- Project state: `~/.pi/dual-agent-coordinator/projects/6613200899766f20/`.
- Request: `a783fa43-4b91-428f-afdf-36a68077edc4`.
- Operator turn: `367ebd2a-83c4-44da-8fd9-5a0631d3c171`, displayed as request 33.
- Workflow: `d682d45e-c5e7-4f15-9e22-919b9e672689`.
- B session: `B/2026-10-20T19-30-22-398Z_01a15acb-1a3e-700d-98c4-7e5ec3dace97.jsonl`.

The retained timeline establishes the failure sequence:

1. At 12:40:34, the approved workflow starts B. `logs/coordinator.jsonl`
   lines 275702 and 275706 record the workflow and execution run.
2. At 12:42:16, A completes its check-in with `decision: continue` after B's
   tenth successful turn. Lines 276747 through 276750 record success.
   A's failed attempt to read the absent `package.json` did not fail the check-in.
3. At 12:44:14.267, B finishes turn 12. Its last command reports npm `ENOTFOUND`
   while checking Playwright availability. B then continues generating a response.
   B archive lines 30 and 31 retain the command and result.
4. At 12:44:14, LM Studio accepts the next chat completion and starts streaming.
   Its server log records a conversation with 27 messages and approximately
   22,429 cached and uncached prompt tokens combined.
5. At 12:46:14.234, B is still receiving `toolcall_delta` events, recorded at
   coordinator log line 279239. At 12:46:14.282, its archive records an assistant
   error with `errorMessage: terminated`. The last token precedes failure by
   about 48 milliseconds.
6. At the same second, LM Studio reports
   `Client disconnected. Stopping generation...` in
   `~/.lmstudio/server-logs/2026-10/2026-10-20.1.log`, line 19461.
7. The coordinator records `response.stopping` with reason `terminated`, then
   `workflow.blocked` and `ui.turn_finished` with outcome `failed`.
   These are coordinator log lines 279246, 279247, and 279250.
   Ledger line 111 retains the blocked outcome.

B's archive line 32 contains a partially generated `write` call with ID
`357238588`. There is no corresponding `tool_execution_start` or tool result.
The request's observed B native starts are six `bash` calls and six `read` calls.
The partial arguments are diagnostic evidence and must never be executed.

The running process, observed during investigation, started at 12:29 and uses
`runtime-local-servers-20261020T182729Z` under `~/.local/share/pi-dual/`.
`~/bin/pi-dual` selects that same installation. Its manifest identifies source
commit `5bdbd48f919777a808b542e651c5829e3dd17a36` plus a nonempty source diff hash.
The current checkout is on `main` at `5d3967c14a1c45ad59bdd6ab730fbe4fb200575a`
with unrelated uncommitted compaction and TUI work.

## Cause and contributing defects

In the failing version of [provider-broker.ts](../src/security/provider-broker.ts),
`createProviderBroker` created one timer before forwarding a request:

```js
const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
```

That is an absolute request deadline for both providers. Stream activity never
refreshes it. The failing local request runs from 12:44:14 to 12:46:14, which
matches this deadline. When the abort interrupts an already-started SSE response,
the catch handler calls `res.destroy()`. The downstream client sees a broken
connection and produces `terminated` instead of the broker's actual cause.

[RuntimeEventBridge](../src/coordinator/bind-runtime-events.ts) rejects the
assistant error at `turn_end`. [response-repair.ts](../src/coordinator/response-repair.ts)
records a stopping failure rather than attempting format repair. Stopping is
appropriate for an interrupted provider response. Automatic handoff replay would
risk repeating previously completed mutations.

The current activity model then reports only `Request failed`. Its terminal
branch uses the latest-created role run to choose the phase. A's later-created
check-in remains that run even though B resumed and failed. This explains the
misleading `Coordinator / Check-in` label in the screenshot. The failure reason
is retained in response progress but is not shown by the terminal activity action.

The older installation `runtime-stream-deadline-20261019T035045Z-ready` has separate
local idle and absolute timers, safe streamed error messages, and
`test/integration/provider-stream-deadlines.test.ts`. Those changes and that test
are absent from the current source. Comparing the installed files proves the
delivery gap. The evidence does not identify the exact edit or integration step
that omitted the older work. Do not attribute it to a particular merge without
additional evidence.

Several other explanations do not fit this incident:

- LM Studio stopped because its client disconnected, and the injected-provider
  reproduction fails without LM Studio running at all.
- An inactivity timeout cannot explain a stream that delivers a token about
  48 milliseconds before failure.
- The outer workflow ran for about 340 seconds and records `blocked`, rather
  than the coordinator's `timed_out` outcome. Its default total limit is
  600 seconds. The broker's independent two-minute cutoff is the reproduced cause.
- There is no context-overflow error or compaction event in the failure sequence.
  The approximately 22,429 prompt tokens also do not suggest a 65,536-token
  context overflow for this request.
- npm's network failure precedes the next successful provider stream. Public
  network denial is an intentional tool boundary. It is a separate verification
  prerequisite problem, not the request's terminal cause.

## Reproduce without credentials or live inference

[diagnose-provider-stream-deadline.mjs](../scripts/diagnose-provider-stream-deadline.mjs)
imports an existing compiled broker and injects an SSE fixture. It emits data at
30-second-equivalent intervals through a 150-second-equivalent response.
It scales the known broker deadlines by 100 and uses real Node timeout objects
so `refresh()` retains its actual behavior. It opens only a loopback broker,
never loads a credential, never contacts a provider, and makes one upstream
fixture call. A five-second downstream deadline bounds diagnostic failures.

Run it with the project Node 24.22.0 toolchain:

```sh
node scripts/diagnose-provider-stream-deadline.mjs /absolute/trusted/runtime/dist/src/security/provider-broker.js
```

For a built checkout, omit the argument to inspect its existing `dist` artifact.
Rebuild first when testing changed source. The script does not compile source.

Observed differential result with the final diagnostic:

- Running installation: exits 1 at 120,000 simulated milliseconds with
  `downstream.error: terminated`, despite a chunk every 30,000 milliseconds.
- Older stream-deadline installation: exits 0 after 150,000 simulated milliseconds
  and receives `[DONE]`. Both make exactly one fixture request.

This is a fast diagnostic, not proof of real-time two-minute inference or the
security of the older runtime. Do not activate that older snapshot wholesale.
It predates newer broker port restrictions and other current capabilities.

## Implementation plan

1. **Restore local stream deadlines in the current broker.** Keep a 120-second
   upstream inactivity limit and an independent 30-minute absolute cap for B.
   Keep A's existing absolute deadline and the coordinator's total operation
   deadline. Start local inactivity accounting when the upstream request begins,
   refresh it when headers arrive and on nonempty upstream chunks, and clear
   both timers on every terminal path. Downstream rendering and animation must
   never refresh either timer. Validate any new timer option at its configuration
   boundary. Use Node's existing `Timeout.refresh()` API for the idle timer.
   [Node timer documentation](https://nodejs.org/docs/latest-v24.x/api/timers.html#timeoutrefresh)
   describes how refresh resets the timer's start time without allocating another
   timer. Retain the current reserved-port policy and request validation.

2. **Retain a safe, specific terminal cause.** Distinguish idle timeout, absolute
   deadline, upstream interruption, operator cancellation, and broker shutdown.
   Use an internal discriminated type and fixed messages, without exposing raw
   upstream errors, credentials, headers, or request bodies. Before SSE headers,
   return a bounded JSON error with HTTP 504 for broker timeout and retry disabled.
   During local SSE, terminate with a complete error frame understood by the
   installed Chat Completions SDK. Discard an incomplete buffered SSE line before
   emitting that frame. Preserve whole-line redaction and response-size limits.
   Do not attempt to write an error after the client disconnects. Clear timers
   before terminal completion so late callbacks cannot replace the cause.

3. **Attribute and display the failure from coordinator evidence.** Carry the
   bounded failure reason and B's run identity through existing response events,
   retained history, and the shared activity model. Update
   [current-activity.ts](../src/app/interactive/current-activity.ts), its UI types,
   and the TUI renderer to show the cause and failed role after B resumes from
   an A check-in. Keep transitions in the coordinator. Preserve existing replay
   records and show a safe generic fallback for older records without metadata.
   Display the reason in plain mode and narrow terminals too. Preserve the
   distinction between a prepared tool call and a started call.

4. **Add regression coverage before changing production behavior.** Restore the
   relevant older timeout tests as reviewed tests against the current APIs.
   Add an active-stream test that exceeds 120 seconds with fake timers that
   support refresh. Cover silence before headers, silence during streaming,
   repeated chunks that never extend the absolute cap, interrupted partial tool
   arguments, cancellation, disconnect, broker close, and normal completion.
   Assert one upstream request, cleared timers, safe errors, and no automatic
   replay. Add real Pi fixture sessions that complete a native write once, then
   stream beyond two minutes or fail during continuation. Independently verify
   the file and correlated result, and ensure incomplete later tool calls never
   execute. Add the exact A-check-in/B-resume/failure sequence to shared activity,
   history replay, and PTY coverage. Keep Vitest's two-fork-worker limit.

5. **Make the fix survive runtime delivery.** Integrate the reviewed broker change
   and regression tests into the source branch used for future installations.
   Preserve the existing uncommitted compaction changes rather than replacing
   runtime files wholesale. Add a fixture-based release check that exercises the
   prepared installation's compiled broker before launcher activation. Associate
   its result with the existing installation manifest and artifact hashes.
   Assert active-stream survival, idle termination, and absolute-cap termination.
   Check source/build correspondence with a fresh build. Integrity hashes alone
   establish byte identity, not correct timeout behavior. Restart sessions after
   activation and verify the running executable and launcher select the tested
   installation. Recovery must continue to leave interrupted work stopped.

Use [secure setup](secure-setup.md) for release and live-provider verification.
`server.requestTimeout = 125_000` bounds reception of the incoming HTTP request,
not generation of the upstream response. Do not remove it to fix this issue.
The [Node HTTP documentation](https://nodejs.org/docs/latest-v24.x/api/http.html#serverrequesttimeout)
defines that separate request-reception limit.

## Acceptance and release checks

The fix is acceptable when an active B stream survives beyond two minutes,
silence and absolute deadlines still stop it, and cancellation drains promptly.
An interrupted response must retain completed edits and execute no partial call.
Both interfaces must name B and show the bounded reason after the check-in.
Restart must retain the failure without resuming execution.

Run the checks with scoped Node 24.22.0 and npm 12.2.0. For implementation,
start with `npm ci`, then run `npm run verify:dependencies`, `npm run check`,
the focused timeout/runtime/activity tests, `npm test`, and `npm run build`.
Run `npm run verify:isolation` and `npm run verify:terminal` sequentially because
they rebuild `dist`. Inspect the rendered terminal failure and retained history.
Finally, create a fresh external trusted installation, verify it with
`bin/node scripts/verify-installation.mjs`, and run the prepared-artifact fixture
gate before activation.

Keep live inference separate. From that verified trusted installation, run
`bin/node scripts/verify-local-executor.mjs` with the saved already-loaded model.
Also use a separately bounded live task that generates a response lasting more
than 120 seconds with observed chunks. Verify actual native results and workspace
state. The normal local smoke alone does not prove survival beyond two minutes.
Any required OpenAI smoke follows its separately bounded secure-setup procedure.
Record each gate against the exact installed artifact. If live prerequisites
are missing, report the missing live gate explicitly.

## Checks completed during this investigation

- Read the matching coordinator log, B archive, ledger, LM Studio log, launcher,
  process executable, installation manifests, current source, and older broker.
- Reproduced the timeout with the final injected-provider diagnostic and obtained
  the differential pass against the older implementation.
- Verified Node 24.22.0 and npm 12.2.0 using the existing trusted toolchain.
- `node --check scripts/diagnose-provider-stream-deadline.mjs` passed.
- `npm run check` passed. Local document links and whitespace checks passed.
- `npm run verify:dependencies` passed across 227 source files.
- Focused existing tests passed: four files, 39 tests covering local execution,
  runtime event bridging, current activity, and current activity rendering.
  These tests passing alongside the reproduction demonstrates the coverage gap.

At the investigation-only stage, no application source, dependencies,
configuration, launcher, saved session, or provider state was changed. That stage
added this plan and its diagnostic script. The subsequent implementation,
full-suite, isolation, PTY, and live-provider results are recorded in
[provider stream verification](provider-stream-verification.md).
