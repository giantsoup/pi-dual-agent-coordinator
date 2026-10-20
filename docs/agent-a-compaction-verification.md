# Agent A compaction verification

Source implementation dated 2026-10-20, based on `5d3967c`. This checkout has
uncommitted compaction changes; the existing launcher has not been activated.

## Delivered behavior

A separate tools-disabled A capability summarizes both histories with A's selected
approved model. Pi still prepares and persists checkpoints. The coordinator
resolves the current A binding for each B job; the capability has an independent
broker lifetime and is drained when its binding is disposed. Summary inference
uses low reasoning where supported, separately from normal A reasoning settings.

Owned preflight and an awaited between-tool-turn admission check inspect actual
serialized payloads without inference. An oversized between-turn payload asks
Pi's existing preparation hook to compact with a smaller retained tail, then
restores the configured token settings. Final dispatch checks late input again.
Configured output headroom is retained even if the SDK heuristic clamps its
serialized cap; the allowance is sent only after verified admission.
B text/tool requests use the loaded LM Studio template and tokenizer, with a
broker check that the admitted instance still matches. A text uses a conservative
byte allowance. Private B reasoning stays archived and is omitted from replay.

Failures abort and drain, stop later requests, and preserve completed writes.
Empty, truncated, aborted, and native-tool summary responses cannot become
checkpoints. Summary jobs have bounded chunking, request count, output, and time.
Cumulative file operations and summary usage survive repeated compaction.

Compaction has an explicit Current activity action, elapsed time, cancel hint,
and history milestones. Source role and A's model are distinct from workflow
ownership. Cancellation works while browsing history. Plain mode emits lifecycle
lines without a repeated timer.

## Evidence

The failing-before regressions reproduced lost overflow classification,
continuation after a failed summary, and a hook-metadata exception allowing local
B fallback. They pass after the implementation. Additional fixtures cover
underreported usage with a large Unicode native tool call, repeated checkpoints
and file-operation inheritance, giant previous summaries, malformed summaries,
format-only repair lifetime, cancellation, and stale/duplicate UI events.

Source checks use Node 24.22.0 and npm 12.2.0. The pinned LM Studio SDK adds no
lifecycle scripts; npm's allowScripts policy is unchanged. Installation reported
zero vulnerabilities.

- Strict TypeScript and dependency guard passed. Full suite: 83 files, 590 tests
  passed. Build passed; isolation: 373 assertions and 42 security tests passed.
- Full real Pi PTY run with screen capture: 1,159 assertions passed in both
  interfaces. Includes A-to-A/B-to-A compaction, completion/failure/cancellation,
  narrow layouts, and cancellation from request history.
- After the final payload-admission and native-content-array refinements, the
  focused compaction PTY scenarios passed all 123 assertions again.
- The captured 120x80 and 40x12 compaction screens were rendered and inspected.
  Screen text, colors, and HTML are under `test-results/terminal-evidence/`.
- Local counting-only verifier passed using the saved loaded Qwen3.8 model:
  Unicode/tool-history inputs counted at 426 and 469 tokens; a 50,413-token input
  was refused with output headroom. No inference was performed by that check.

## Trusted live verification

The source candidate was copied and hash-verified to
`/Users/Taylor/.local/share/pi-dual/runtime-compaction-20261020T192207Z`.
The installation verifier passed for 27,757 files. Credential-backed checks ran
only from that snapshot; the workspace source was not run with real credentials.

`bin/node scripts/verify-local-executor.mjs` passed with the saved loaded
`lm-studio/qwen/qwen3.8-27b` model and thinking off. Native write/read/bash tools
succeeded, and the actual written file was verified.

`bin/node scripts/verify-compaction.mjs /Users/Taylor/pi-dual-agent-coordinator`
passed with `openai/gpt-6-luna` summarizing and Qwen3.8 executing. It recorded two
started/completed checkpoint pairs. Both continuations performed successful native
write/read operations; both proof files contained the expected bytes. All six tool
results succeeded. Across eight requests, admitted input ranged from 20,173 to
22,140 tokens and actual provider input ranged from 20,137 to 22,104 tokens.
Actual input was consistently 36 tokens below the admitted estimate; every request
retained the configured 16,384-token output allowance within the loaded window.

The live check uses temporary workspaces and removes them afterward. It does not
activate this snapshot or modify the installed launcher.

## Operational limits

Unsupported image accounting fails before inference. This release does not claim
verified vision-token counts. A's byte allowance may compact or refuse earlier
than exact tokenization. Uncountable or indivisible oversized requests stop with
an actionable error; they are not silently truncated or routed to a cloud fallback.
The original suspected historical overrun remains unidentified.

Existing sessions and the installed launcher are unchanged. A verified snapshot
must be selected and the application restarted to use this source candidate.
