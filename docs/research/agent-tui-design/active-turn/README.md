# Three ways to emphasize the active turn

**Selected direction: option 3, current workspace with history rail.** Taylor chose this option after reviewing the screenshots. The mockup now opens with this layout. At 120 columns, history occupies a slim left rail; at 80 columns, it becomes a compact history control. The active turn and current step occupy the main workspace. This records the design decision; production implementation remains separate.

Use the [implementation prompt](IMPLEMENTATION_PROMPT.md) for the coding handoff and the [QA report](QA_REPORT.md) for verified limits and corrections. This README is authoritative for the selected layout. The parent report supplies shared interaction and retention requirements. Options 1 and 2 are comparison material, not additional implementation modes.

This follow-up compares visual hierarchy within the previously recommended turn/history experience. It preserves `Active: A - Senior`, `Active: B - Junior`, the cyan/amber identity colors, the F1 help hint and access to retained tool and agent-run history. All examples use the same synthetic task, calls and outcomes.

Open [the screenshot comparison](comparison.html). It offers all three layouts, both terminal sizes, both active roles, and a side-by-side switch. [The mockup viewer](mockups.html) also includes help and historical-call overlays. Neither artifact executes tools or implements the production TUI.

## The three choices

| Option | What changes | Best use | Tradeoff |
| --- | --- | --- | --- |
| 1. Framed current turn | Older turns stay compact above a clearly separated, tinted current-turn frame. The active step has its own bold, underlined heading. | Balanced reading and monitoring. | The frame uses a few rows; long history still needs a live pointer while browsing. |
| 2. Pinned current-work area | The active turn occupies a fixed upper region. Completed turns occupy a separate lower region. | Watching an ongoing operation and its current tool. | The screen splits the chronological conversation; each region needs independent scrolling. |
| 3. Current workspace with history rail | Previous turns become a slim navigation rail, and the active turn occupies the main workspace. At 80 columns, history becomes a compact control. | Selected default. | Older conversations require more navigation, and the rail reduces text width. |

The screenshots emphasize the turn and the current step separately. A solid role-colored `CURRENT TURN 13` heading identifies the active turn; a `>> STEP 2 OF 3 / RUNNING TESTS` heading identifies what is happening inside it. Senior review changes that to step 3 and explicitly reports that no tool is running. A completed Junior tool stays amber while Senior's active frame becomes cyan.

The three-step trail and durations are fixture values. Real operation can include discussion, approval waiting, repair loops, cancellation, timeout or interruption. Derive labels from real lifecycle events; show numbered progress only when the total is known. A UI turn groups an operator request and its associated work. It is distinct from a Pi model turn, which can end at a tool boundary. Link approved execution to the originating plan explicitly; a role or session ID alone does not identify that group.

## Review screenshots

| Option | Junior, 120 × 40 | Junior, 80 × 24 | Senior, 120 × 40 |
| --- | --- | --- | --- |
| Framed turn | [Open](screenshots/framed-B-120x40.png) | [Open](screenshots/framed-B-80x24.png) | [Open](screenshots/framed-A-120x40.png) |
| Pinned current work | [Open](screenshots/pinned-B-120x40.png) | [Open](screenshots/pinned-B-80x24.png) | [Open](screenshots/pinned-A-120x40.png) |
| History rail | [Open](screenshots/rail-B-120x40.png) | [Open](screenshots/rail-B-80x24.png) | [Open](screenshots/rail-A-120x40.png) |

The comparison also includes the three Senior 80 × 24 captures. Images are exact-size headless browser renders of the generated screen markup, with identical typography and canvas size for every option at a given terminal size. They are not live terminal screenshots. The browser rendering uses conventional monospace cells, ANSI-style colors, bold, underline, ASCII borders and whitespace; it does not propose variable-size terminal fonts.

## Behavior to preserve when implementing

Derive current-turn identity from the coordinator's active operation, and current-step identity from its actual phase. Do not infer either from list position, the latest tool event, or the record the user selected. A running step has elapsed time and no final exit status. Waiting for approval, cancelling, interrupted and completed work need distinct labels.

Do not force the reader back to the active turn on each event. When browsing history, retain selection, folds and an ID-based scroll anchor, and keep a small active-turn pointer visible. In option 2, reserve the active region but scroll its content independently. In option 3, selecting an old turn opens its retained transcript with a clear return-to-current action; it never switches a runtime session. On a new submission, create the next active frame and keep the former turn's outcome and history accessible.

Keep the help hint and draft outside the changing body region. F1 should show contextual controls without discarding a draft or navigation position. Keep F2 for existing activity, F6 for focus, Tab for editor completion and Ctrl+C for existing cancellation semantics. A narrow history control can be accessed through focus and Enter without taking a new global shortcut.

Use F6 and Shift+F6 to cycle through the editor, workspace, history rail or compact history control, and the activity pane when it is visible. Give an open inspector its own focus. At 80 columns, focus the history control and press Enter to open the history list. In history, arrows select records and Enter inspects them. Esc closes one view at a time. F1 opened from history or an inspector returns to that same view, selection and scroll position. `/help` is a typed editor command, not a global key. Generate the help entries and footer hints from the actual command bindings.

When the operation is idle or waiting for approval, show that state instead of an Active badge. Keep the completed turn in the workspace until another accepted request becomes current. Selecting an older turn changes the viewed record, not the active operation. Historical tool and agent inspectors are read-only and separate from explicit session-switch controls.

Implement within the installed `@mariozechner/pi-tui` 0.67.68 component and overlay model. Use `visibleWidth`, `truncateToWidth` and ANSI-aware wrapping for real data. Each rendered row must fit its column budget. Allocate active/history heights from terminal rows and bound the editor as the existing app does. Preserve role labels, borders and step markers when colors are disabled; theme backgrounds and contrast need separate checks for 16-color and light terminals. These proposals require no framework or dependency migration.

## Verification

Run the deterministic generator from the repository root:

```sh
node docs/research/agent-tui-design/active-turn/build.mjs
```

Run `node docs/research/agent-tui-design/active-turn/build.mjs --check` to detect stale generated HTML without rewriting it. Run `node docs/research/agent-tui-design/active-turn/verify-artifacts.mjs` for the artifact integrity checks.

On either `mockups.html` or `comparison.html`, run `await (0, eval)(await (await fetch('verify-browser.js')).text())` in the browser console to repeat the corresponding interaction checks. These exercise the browser examples; they do not substitute for terminal verification.

It checks all 12 combinations of three layouts, two sizes and two active roles with the installed Pi `visibleWidth` function. Every screen has exactly 40 or 24 rows, every row occupies exactly 120 or 80 display cells, and current-turn, current-step and F1 labels remain visible. [layout-checks.json](layout-checks.json) records the result.

Generate the self-contained HTML for a particular screenshot:

```sh
node docs/research/agent-tui-design/active-turn/build.mjs --screen framed 120 B
```

The `--screen` path writes only HTML to standard output. Render that HTML through T3 `html_preview` at 980 pixels for 120-column examples or 668 pixels for 80-column examples. The expected content height is 754 or 466 pixels respectively. Save the returned PNG image block. [screenshots.json](screenshots.json) records image provenance, dimensions and checksums.

The comparison's image loading and selectors were checked in the collaborative browser; headless renders were checked for console errors and visually inspected. No application code, dependencies or runtime configuration changed in this task. The original report's storage, inspection and real-terminal verification work still applies to implementing the selected design.
