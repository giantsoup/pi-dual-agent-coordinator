# Agentic TUI research evidence

Researched 2026-10-16 using first-party documentation and first-party repositories. This is a selected comparison of established agentic coding TUIs, not a popularity ranking or a claim that one product is objectively best. Documentation describes current behavior. Promotional screenshots show the design at the time the publisher captured them and may lag current releases. No competitor application was installed or interactively tested.

## Codex CLI

The [official OpenAI developer command reference](https://learn.chatgpt.com/docs/developer-commands#built-in-slash-commands) documents `/agents` as an agent command center and `/subagents` for selecting a subagent thread. `/ps` shows background terminals and recent output. `/statusline` configures footer fields, `/keymap` remaps TUI shortcuts, `/raw` changes scrollback presentation, and `/export` exports the conversation. The reference describes filtering the slash-command popup by typing.

Interpretation: borrow discoverable commands, a dedicated agent picker and compact configurable status. These commands do not establish independent expansion of an arbitrary historical tool result. Do not copy a global key combination from another agent without checking this application's editor bindings. No Codex screenshot or installed-app interaction was used as evidence here.

## Claude Code

The clearest direct precedent for inspecting current and past tools is [fullscreen rendering](https://code.claude.com/docs/en/fullscreen). Clicking a collapsed tool result expands its call and result together; clicking again collapses them. The docs explicitly include old truncated shell results and the live progress row. Only rows with hidden content accept the action. Fullscreen uses the alternate screen buffer, a fixed input area and rendering limited to visible messages. Native terminal search and selection have corresponding application controls. Fullscreen is labeled a research preview, so treat it as version-sensitive.

The [interactive-mode reference](https://code.claude.com/docs/en/interactive-mode) documents `Ctrl+O` for the transcript viewer, including detailed tool execution. In fullscreen transcript view, `{` and `}` jump between user prompts, `[` exports to native terminal scrollback, and `v` opens the conversation in an external editor. `Ctrl+E` to show all content is explicitly classic-renderer-only. The compact transcript can group repeated MCP calls into one summary line.

The [subagents reference](https://code.claude.com/docs/en/sub-agents#observe-and-steer-running-forks) documents a panel below the prompt, arrow-key selection, `Enter` to open an agent transcript, and `Esc` to return to the main prompt. Nested agents appear as a tree with descendant counts and a path back to `main`. Successful background agents leave the panel immediately; `/tasks` exposes them as done for 30 seconds. Failed or stopped rows remain for 30 seconds. Agent transcript files persist separately from the main transcript. This distinction matters: brief on-screen retention is not durable, discoverable historical navigation.

Interpretation: borrow compact rows, tree relationships and focused inspection. For this coordinator, preserve access to finished agent history through its originating turn instead of relying on a temporary live-task list.

## OpenCode

[The TUI reference](https://docs.opencode.ai/docs/tui/#details) documents `/details` to toggle tool execution details. [The keybind reference](https://docs.opencode.ai/docs/keybinds/) documents `Ctrl+P` for commands, `Ctrl+X` then `g` for the session timeline, and `Ctrl+X` then `b` for the sidebar. The tool-details action has no default shortcut in the published map. Do not imply `/details` has a universal preassigned key.

For subagent sessions the defaults are `Ctrl+X` then `Down` to enter the first child, `Right` and `Left` to cycle children, and `Up` to return to the parent. These are session-navigation controls; they are not commands to expand an arbitrary tool row. The [agents documentation source](https://github.com/anomalyco/opencode/blob/c77e748dbf7c4d2c75515bcc2db7740d0552634b/packages/web/src/content/docs/agents.mdx#L117-L136) corroborates these controls. The repository was pinned at `c77e748dbf7c4d2c75515bcc2db7740d0552634b` for this research; the published keybind page reports an update date of 2026-10-16.

Interpretation: retain a clear path into a child transcript and back. Keep global detail toggles as a secondary capability; individual expansion better supports reading one event without opening every event.

## Gemini CLI

The [keyboard shortcut reference](https://geminicli.com/docs/reference/keyboard-shortcuts/) documents `Ctrl+O` to expand/collapse content blocks **when not in alternate buffer mode**. The same combination expands pasted-content placeholders when the cursor is over one. `Page Up`/`Page Down`, `Ctrl+Home`/`Ctrl+End`, and shifted arrow keys navigate content. `F9` toggles copy mode in the alternate buffer, while `Ctrl+S` toggles mouse capture. These distinctions make renderer mode part of the interaction contract. The page reports an update date of 2026-05-07.

The [subagent documentation](https://geminicli.com/docs/core/subagents/) describes a separate context loop and specialist agents exposed to the main model as tools. It establishes delegation semantics, but this research did not establish a documented per-agent expandable historical transcript control. Do not infer that feature from the existence of subagents.

Interpretation: status, the tool name and its target should remain readable in a bounded card. Preserve an obvious copy/export path when full output is opened. Avoid overloading a shortcut without a visible indication of the active focus.

## Crush

The [first-party key map](https://github.com/charmbracelet/crush/blob/78b6edb353f3fb11178c7e38bbac762772dfb8b0/internal/ui/model/keys.go#L209-L295) binds `Tab` to focus changes, `Space` to expand/collapse the selected chat item, `Ctrl+D` to details, `Ctrl+B` to sidebar visibility and `Ctrl+T` to tasks. `Shift+Up`/`Shift+Down` move by item; `Page Up`/`Page Down` navigate the chat.

[Chat selection and click handling](https://github.com/charmbracelet/crush/blob/78b6edb353f3fb11178c7e38bbac762772dfb8b0/internal/ui/model/chat.go#L993-L1003) implement expansion on the selected expandable item. [The click handler](https://github.com/charmbracelet/crush/blob/78b6edb353f3fb11178c7e38bbac762772dfb8b0/internal/ui/model/chat.go#L1110-L1130) avoids toggling while text is highlighted or when the click misses the expandable region. [Bash rendering](https://github.com/charmbracelet/crush/blob/78b6edb353f3fb11178c7e38bbac762772dfb8b0/internal/ui/chat/bash.go#L69-L108) preserves the command and uses expansion for the output body. These are source-code observations at the pinned commit, not a compatibility promise.

Interpretation: this is the strongest keyboard-first precedent for selecting one historical row and expanding it in place. Keep the command identifiable even while output is folded.

## Downloaded first-party screenshots and demo

These images are reference evidence, not new captures of installed competitor applications. Preserve attribution if incorporated into a comparison page. No external redistribution rights beyond each publisher's terms were evaluated.

| File | Provenance and exact download URL | What it demonstrates | Caveat |
| --- | --- | --- | --- |
| [OpenCode official screenshot](assets/opencode-official.png) | [Pinned first-party README](https://github.com/anomalyco/opencode/blob/c77e748dbf7c4d2c75515bcc2db7740d0552634b/README.md) links [this PNG](https://raw.githubusercontent.com/anomalyco/opencode/c77e748dbf7c4d2c75515bcc2db7740d0552634b/packages/web/src/assets/lander/screenshot.png). 1824 × 1488. | Compact Grep/Glob/Read rows between prose, visible active state and fixed-looking composer. | Publisher capture date unknown; the image does not demonstrate expansion or subagent navigation. |
| [Crush official demo](assets/crush-official-demo.gif) and [derived still](assets/crush-official-still.png) | [Pinned first-party README](https://github.com/charmbracelet/crush/blob/78b6edb353f3fb11178c7e38bbac762772dfb8b0/README.md) embeds [this GIF](https://github.com/user-attachments/assets/58280caf-851b-470a-b6f7-d5c4ea8a1968). 1600 × 900. | The still shows a Multi-Edit tool and side-by-side diff with collapsed additional lines. The animation also shows the optional right sidebar and command palette. | Capture date/version unknown. The still is extracted locally from the official animation, not independently captured live. |
| [Gemini CLI official screenshot](assets/gemini-cli-official.png) | [First-party repository PNG](https://raw.githubusercontent.com/google-gemini/gemini-cli/ed96faedfd5571f055c44f2c9509d62321d1138d/docs/assets/gemini-screenshot.png), pinned at `ed96faedfd5571f055c44f2c9509d62321d1138d`. 1089 × 582. | Bordered tool result card with success mark, tool name, file target and content. | Historical visual: the image explicitly shows `gemini-2.5-flash`; it is not evidence of the latest UI or subagent controls. |

No Claude screenshot is included because the three above already provide first-party visual references, while Claude's current tool-expansion behavior is better established by its documentation than by an older screenshot.

## Recommendations to test locally

These are design recommendations, not competitor feature claims.

1. Keep a small live-work region above the composer with the active tool, elapsed time, agent identity and a count of other running jobs. Avoid duplicating complete outputs there.
2. Make the conversation a persistent sequence of turns. Each turn retains compact tool and agent rows with counts, state and target. A finished agent remains discoverable under its originating turn.
3. Let one selected tool or agent row expand independently. Use a focused detail view for long logs and child-agent transcripts, with an explicit breadcrumb back to the parent turn.
4. Treat hidden display content and discarded data differently. Folding should keep complete arguments and output available; hard truncation and evicting older events cannot support later expansion.
5. Freeze the reading position while reviewing history and show an unread-activity count. Resume following only through an explicit action. Retain selection and expansion when the terminal resizes.
6. Scope navigation shortcuts to a focused history region so arrow keys, space and text continue to edit the composer normally. Show the currently available controls in the footer. Pair status colors with readable state labels.
7. Verify with a long tool result, a failed call, concurrent agents, a finished agent, many turns, narrow terminal widths, resize during streaming and scrolling away from the live edge. Inspect the actual terminal behavior, not only a rendered mockup.

## Asset integrity

Full source URLs, pinned revisions, retrieval date, byte sizes and SHA-256 values are recorded in [the asset manifest](assets/sources.json). The Crush still uses frame 60, zero-based, of the 149-frame official GIF. All three source assets returned HTTP 200 and an image content type on retrieval.
