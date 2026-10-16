# Design handoff QA

Reviewed 16 October 2026 against the selected option 3, generated mockups, current working-tree source, installed Pi packages, repository README, and terminal/security documentation. This pass changes design artifacts and the implementation handoff. It does not implement or certify the production TUI.

## Findings and corrections

| Finding | Resolution |
| --- | --- |
| Help opened over historical detail discarded that view on close. | Fixed `toggleHelp()` in the generator to restore the previous history view. Verified F1 then Esc with native collaborative-browser input and repeated the return path across all 12 layout/size/role combinations. |
| The original interaction demo and the selected layout mockup had different capabilities, with an ambiguous general description. | The parent README now identifies each prototype's supported interactions and static data. Browser mocks remain evidence of design, not production persistence or terminal behavior. |
| The three-step trail, sample timings and running-only screenshots could be read as literal runtime requirements. | The selected README now marks these as fixtures, distinguishes UI operator turns from Pi model turns, and requires real lifecycle labels and honest idle/approval/terminal states. |
| The compact history control lacked an explicit keyboard path; `/help` was listed as global. | Defined F6 focus and Enter opening for the narrow history control. Scoped `/help` to editor input. Required contextual help to restore its originating view and use the actual binding definitions. These controls remain production requirements, not fully implemented browser behavior. |
| Existing saved-session preview assigns Enter to an explicit runtime-switch action. Reusing it for tool inspection could switch sessions accidentally. | The recommendations and implementation prompt require a separate read-only record inspector and preserve explicit session-switch controls. |
| Pi's session-opening API can modify a file while reading it, and the current safe reader returns built context rather than a complete archive. | Pointed implementation at `src/runtime/session-history.ts`, read-only parsing, branch-aware retained records, and explicit unavailable-data states. The prompt prohibits using session opening as history preview. |
| Runtime/provider assumptions have evolved since the first research snapshot. | Verified that the current repository uses OpenAI for A and fixed local LM Studio models for B. The handoff preserves that split, permissions and broker policies. Role labels remain independent of model names. |
| Generated HTML could drift from its generator. | Added a non-writing `build.mjs --check` mode and an artifact verifier covering generated output, script syntax, selected default, PNG integrity and local documentation links. |

## Verified evidence

- Both installed Pi packages are version 0.67.68. The implementation prompt uses the installed API contract and strict NodeNext TypeScript settings.
- The generator validates 12 combinations: three layouts, two terminal sizes, and two active roles. Each has the exact row count and exact display-cell width using Pi's `visibleWidth`.
- The selected mockup opens option 3. Its 12 browser variants preserve the active-role label and unchanged workspace text across history/help open/close. These are synthetic examples with static drafts and records.
- The comparison loads all 12 expected PNGs across its four size/role selections. Stacked and side-by-side arrangements work.
- The earlier interaction prototype's 39 checks pass again. Those checks validate the earlier demo's folds, inspector, draft handling and other documented synthetic interactions, not the selected layout's missing production behavior.
- All 12 PNG checksums and dimensions match `screenshots.json`. The help-state fix does not change the static `--screen` output, so existing comparison screenshots remain valid.
- Inline JavaScript syntax, local documentation links and generated-artifact consistency pass. The non-writing check detects a deliberately stale generated mockup in an isolated temporary copy.

## Reproduce

From the repository root:

```sh
node docs/research/agent-tui-design/active-turn/build.mjs --check
node docs/research/agent-tui-design/active-turn/verify-artifacts.mjs
```

Serve the repository as described in the parent README. Open `mockups.html` and `comparison.html` in this directory. On each page, run:

```js
await (0, eval)(await (await fetch('verify-browser.js')).text())
```

Run the earlier interaction prototype's verifier on the parent `index.html` using its own `verify-browser.js`.

The existing `baseline.json`, first-party source assets and older screenshots retain their original capture provenance. This QA pass does not recapture or relabel them as current production evidence. No live model inference, credential access, full application suite or isolation suite was performed for this documentation/prototype task. The implementation prompt requires real service and PTY verification for the later product change.

## Handoff

Use [IMPLEMENTATION_PROMPT.md](IMPLEMENTATION_PROMPT.md). It specifies the selected layout, independent retained history, safe inspection, real lifecycle state, contextual controls, provider boundaries and observable acceptance cases. Search and copy/export remain follow-up features from the parent report; they are not prerequisites for this selected-layout implementation. Real spawned-subagent orchestration is also outside this UI task.
