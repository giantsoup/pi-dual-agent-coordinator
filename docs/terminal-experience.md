# Use the terminal coordinator

Start the app from a trusted installation outside the agent workspace. The TUI
opens on a TTY. Use `repl /absolute/project --plain` for readline.

## Test locally from this checkout

Start LM Studio's server on `127.0.0.1:1234` and download the selected Agent B
model. The app loads it with a 65,536-token context during startup if needed.
Agent A uses its Keychain-backed OpenAI credential; B stays local.

Build and copy the current app into a new trusted directory. Run these commands
from the source checkout; keep that checkout separate from the installation:

```sh
pi_dual_runtime="$HOME/.local/share/pi-dual/runtime-terminal-$(date +%Y%m%d-%H%M%S)"
npm run build
npm run secure:install -- "$pi_dual_runtime"
"$pi_dual_runtime/bin/node" "$pi_dual_runtime/dist/src/index.js" doctor "$PWD" --no-mcp
"$pi_dual_runtime/bin/node" "$pi_dual_runtime/dist/src/index.js" repl "$PWD" --no-mcp
```

An existing Keychain credential for this checkout's canonical path is reused.
A missing credential requires the private setup flow in [secure setup](secure-setup.md).
The installation command leaves this checkout's source unchanged. Rebuild
and install to another new directory after source changes. Append `--plain` to
the last command to test readline. Start with MCP disabled to isolate terminal
and provider behavior; enable configured MCP servers separately afterward.

For a quick check, ask A a discussion question, request a small plan, revise it,
then discard it. Confirm no files changed before approval. For an approved coding
check, use a disposable project with its own path-scoped credential. During work,
edit a new draft, try a second submission, then cancel. Check `/status`, `/sessions A`,
`/model A`, `/model B`, and `/thinking A`. Use temporary choices first; append `save` only when
you intend to change restart defaults. Quit with `/quit` and verify normal terminal
input and cursor behavior return.

## Submit and cancel work

Plain text goes to Agent A. A proposed plan waits for `/approve`; `/discard`
clears it. Another prompt revises it. Legacy `pi-execute` output also waits for
explicit operator `/approve`.

Only one request runs at a time. Submitted text clears when the service accepts
it. You can edit the next draft during work. An attempted second submission stays
in the editor with a busy explanation. No steering or follow-up queue is created.
Help, status, history viewing, cancellation, and exit remain available.

Use Esc then x from the editor, `/cancel`, or Ctrl+C during work. The coordinator
aborts Pi, waits for its runtime to become idle, and prevents later execution, review, repair, or handoff
requests. The editor keeps your draft. Completed changes remain on disk.
Cancellation does not roll them back. `/quit` cancels work and exits.

While an idle service modal is open, Ctrl+C closes it before the underlying view.
While Request history is open, idle Ctrl+C dismisses it and preserves the draft.
Otherwise, idle Ctrl+C clears a TUI draft. On an empty editor, press Ctrl+C twice
within 1.2 seconds to exit. Readline also requires a repeated idle Ctrl+C to exit.
Esc closes the current view or dismisses editor completion before opening controls.
Use Esc then e to focus the editor from the base screen. SIGTERM, SIGHUP, and SIGINT
use the supported shutdown path. Startup failures dispose partially created
runtimes. Normal TUI shutdown restores input mode, cursor visibility, and the
main screen.

The default deadline is **600,000 milliseconds, or ten minutes, per submission**.
It measures total time across the request's planning, execution, review, and
repair stages. Time spent waiting for plan approval is outside that deadline;
`/approve` starts a new deadline. Set it with `--timeout-ms N` or
`/config timeout-ms N`. Values must be positive integers no greater than
2,147,483,647. Deadline expiry uses the same abort and cleanup path as cancellation.
The UI keeps showing cancellation until cleanup finishes.

The secure runtime disables Pi's automatic provider retries. The app never
retries a coordinator workflow automatically. After failure, cancellation, or
timeout, inspect any changes and submit an explicit new request. Sandbox tool
workers kill their process group on abort. MCP tool calls receive the abort
signal, but a server may already have completed an external side effect. Other
MCP metadata operations remain subject to the SDK's request deadline. Pi must
finish cleanup before another work request starts.

## Read and navigate the TUI

The current operator request occupies a workspace labelled `CURRENT REQUEST`,
with a role-colored border and bold heading. This number counts operator requests,
not model responses or tool calls. Body text uses the terminal's default foreground and background,
without a colored fill. Its heading and current step report actual operation
state. A is cyan and labelled `A - Senior`;
B is amber and labelled `B - Junior`. Only an unfinished role run during a running
operation displays `Active: A - Senior` or `Active: B - Junior`. Idle, approval
waiting, cancellation and terminal results have separate labels. Inspecting older
work never changes that live identity.

**Current activity** stays immediately above the composer. The panel shows the
role, short model name, and phase in the border. The bold current action occupies
the first body row, followed by its target or cleanup detail and a gray clock. A small marker
animates during work. Thinking, response writing, tool-call preparation, provider
waiting, native tool execution, approval waiting, model setup, and cancellation
cleanup have distinct labels. The labels describe observed events. They do not
expose reasoning or guess model intentions. Safe commands and targets wrap within
the panel budget. Elapsed time keeps its action start across deltas; event age
reports silence without declaring a hang or triggering a retry.

The panel reserves eight rows at larger sizes and seven at 80x24 with a short draft.
Pi's actual editor output determines the remaining body space. A tall draft or
completion menu takes space from the narrative first. Compact mode keeps a short
action summary, draft, cursor, and two contextual footer rows. Recent activity,
operator hints, and secondary metrics yield space before the action. One summary
counts up to three recently settled tool calls from the current request and uses
the panel's current agent color. It includes failed, timed-out, cancelled, and
interrupted outcomes, with the latest failure's safe title and workspace-relative
paths. A full blank row separates the summary from the current action, clock,
and required progress.
If both the blank row and summary cannot fit, the summary is hidden. Individual
calls remain available in the workspace and read-only inspector. Cancellation
controls stay in the footer. Hidden or paused narrative keeps an
unread count and a return hint in the panel. Optional Activity diagnostics use
body space above the panel and contain session and health details.
The body shows both agents' readable responses in order, including planning,
execution updates, check-ins, review, and repair. Earlier responses remain visible
when another role starts. Committed responses reload from the read-only Pi archive.
Private reasoning and raw workflow blocks stay hidden; validated plan, check-in,
completion, and review fields use the existing readable summaries.
Displayed plans separate the summary, execution steps, and review notes with one
blank line. Acceptance criteria appear as spaced bullets in their own section.
This display formatting preserves stored responses and workflow data.

Uninterrupted tool activity is collapsed into one totals row beneath the response.
A new response, role run, or check-in starts a separate group. Failures, cancellation,
timeouts, and running calls remain visible in the totals. Focus the workspace with
Esc then w, select a role run, and press Right or Space to show its individual calls.
Enter on a run or call opens the existing read-only inspector. Left collapses calls
without hiding the agent's response. Long responses show a marked 24,000-character
preview; the run inspector provides the full retained output.

During execution, `B turns` shows completed model turns for the current handoff
and the next Agent A check, or that A is checking the current boundary. One model
response and its tool results count as one turn, even if it calls several tools.
This uses the execution supervisor's counter, including completion repair, and
resets for each new handoff. A terminal response goes to final review instead of
a process check. Counts and check state are retained with request history;
older records without this telemetry do not invent a model-turn count.

The displayed request uses the full body width at every terminal size. Press
Esc then r, or F4, to open the temporary **Request history** pane. It lists past
operator requests followed by **Current request**, or **Current conversation · empty**.
Opening history dismisses editor completion, including pending suggestions, so the
chooser has room beside a multiline draft. The draft and cursor stay intact.
The composer, Current activity panel, and two-row footer remain visible.

Arrows change the provisional highlight. Enter displays the highlighted request
and closes history. Esc or F4 dismisses history and restores the previous request,
focus, folds, scroll position, and follow state. Selecting a past request pauses
following and labels the body `HISTORY REQUEST`. New prompts always continue the
current conversation. Selection never resumes an agent session or workflow and
never approves a plan. The displayed request's runs and calls remain inspectable.

Inspectors, help, and the controls menu also replace the body. Below 80x24, compact
mode preserves input, resize, cancellation, and exit handling. Pi retains the full
draft, cursor, and editor state. The renderer bounds the editor viewport around
the IME cursor marker when the terminal cannot fit all rendered editor rows.

Narrative milestones come from correlated planning and workflow events. Run
headings show execution outcomes and available timestamps. B's continuation after
an A check-in keeps the original run identity. A revision or approval label requires
coordinator decision evidence; runtime completion alone does not imply sign-off.
Restart restores unfinished requests and pending approvals as interrupted history.
It does not resume work or recreate a pending operator approval.

A failed runtime retains its role, execution phase, and safe stopping reason in
Current activity and read-only history. This includes B failures after a completed
A check-in. The plain interface prints the same reason. Narrow terminals reserve
space for the failed role and cause before secondary progress or recent entries.
Partial streamed tool arguments remain preparation, not execution evidence.

### Keyboard controls

From the editor, workspace, or activity pane, press **Esc**, then choose a letter
from the visible controls menu. Press the keys separately; there is nothing to hold
down and the menu does not time out. Fast Esc-then-letter input also works in legacy terminals. The menu
supports Up/Down and Enter, and keeps your draft and cursor intact. Esc dismisses
completion or closes the current view before it opens controls on the base screen.

| Menu key | Action |
| --- | --- |
| h | Open help with the full command and shortcut list |
| m | Choose models and reasoning settings |
| a | Show or hide activity diagnostics |
| w | Focus the workspace records |
| r | Choose the displayed request in Request history |
| e | Return to the editor |
| p | Browse previous prompts with Up/Down; Down returns toward your saved draft |
| l | Jump to the current request and resume following output |
| n | Insert a newline at the draft cursor |
| x | Cancel running work while preserving your draft |
| q | Ask to quit; y confirms, n or Esc returns without exiting |

In the editor, **Enter submits** and **Tab completes text**. Bracketed paste
preserves multiline input. Letter shortcuts do not intercept ordinary typing.
Pasting into the controls menu or quit confirmation does not activate actions.

While browsing the workspace, activity, or an inspector:

- Tab cycles visible panes, including the editor. Once back in the editor, Tab
  returns to text completion. Esc closes one view at a time, then opens controls.
  Esc then e focuses the editor. Closed history is absent from focus cycling.
- h opens contextual help and Esc restores your previous view and position.
- Up/Down selects records or scrolls inspector/activity text. Left/Right
  collapses or expands a record. Space toggles the selected fold. Enter opens
  read-only inspection.
- u/d moves up or down a page. g goes to the beginning. l returns to the current
  request and resumes following in the workspace, or goes to the end of
  the focused inspector/activity output.
- In an inspector, 1 selects summary, 2 safe request or objective, 3 retained
  output or visible assistant prose, and 4 identity/status metadata.

While Request history is open:

- Up/Down highlights one request. PageUp/PageDown or u/d moves by the visible
  request count. Home or g highlights the first request. End highlights Current.
- Enter displays the highlighted request. l selects Current and resumes following.
- Esc or F4 dismisses the pane. h or F1 opens help and preserves the highlight.
  While idle, Ctrl+C closes help first, then history on another press.
- Tab, F6, F2, F3, typing, and paste stay inside history without editing the draft.
- Ctrl+C cancels running work and preserves the draft. When idle, it dismisses
  history without clearing the draft or exiting.
- Wheel input inside the history body moves the highlight without selecting.
  Hidden live output retains unread activity until you return to visible live output.

Wheel or trackpad scrolling over the request pane moves through its records and
visible prose. Scrolling pauses following so incoming events do not pull the
view away. The pane shows the lines above and below, and Following or Paused.
Use Esc then l from the editor to return to current work. Long prose previews
remain bounded; select a run and inspect its retained output to read beyond the
preview. Run disclosure exposes individual calls with names, targets, states,
and failure markers. Their short previews start folded. Collapsing a run's calls
keeps its narrative responses visible.

Mouse reporting is enabled only during the TUI session. Use your terminal's
Shift+drag gesture to select text. Existing F1/F2/F3/F4/F6, Shift+F6, PageUp/PageDown,
Home/End, Shift+Up/Down, Shift+Enter, Alt+Up, and Ctrl+C bindings remain optional
aliases. The controls menu provides paths that do not require those keys.

The footer shows controls for the current view. The menu and help share the same
action definitions. `/help`, `/history`, `/model A`, `/model B`, `/cancel`, and
`/quit` remain available as typed commands. `/quit` exits directly; menu q asks
for confirmation. `/history` still opens the service's textual retained-record
view in either interface; `/inspect ID` still opens retained detail. These commands
are separate from the TUI's presentation-only request chooser.

Transcript browsing pauses following and anchors the reader to a record ID. New output,
completion and resize retain that record. An unread activity count and the
latest-output action provide a path back to current work. Completed results remain current until a new
request is accepted. Approval continues the originating plan's operator turn.
A Pi model turn ending at a tool boundary does not create another operator turn.

## Inspect retained work safely

`/history` lists retained operator turns, role runs and calls in either interface.
`/inspect ID [summary|request|output|metadata] [line-offset]` reads a range of up to
100 source lines in plain mode. Copy the ID from `/history`. For example:

```text
/history
/inspect RECORD_ID output 200
/inspect RECORD_ID metadata
```

The shared service indexes identity and outcome metadata from the existing private
coordinator telemetry. Prompt-time markers associate Pi archive entries with each
role run and branch. Full message bodies stay in Pi session files. The read-only
archive reader includes inactive branches and messages before compaction; it does
not call `SessionManager.open()`. Inspection does not write logs, repair files,
submit prompts, approve, rerun tools, resume work or change runtime bindings.
The saved-session preview remains separate and still offers its explicit Enter
session-switch action.

The recent activity pane retains eight summaries; the record inspector can access
all indexed calls. Restart marks unfinished records interrupted rather than
successful. Completed, failed, cancelled and timed-out results remain terminal.
History from the previous UI lacks run markers and cannot acquire associations
retroactively. A warning identifies that gap. Replaced memory sessions, missing or
invalid archives, and absent results have explicit unavailable reasons. Historical
approval-wait records describe the old plan; restart does not restore approval.

Output inspection returns bounded line ranges. Each request currently parses its
Pi session file in full, then projects the requested range. Large archive files
can therefore incur disk/parse cost, although the TUI renders only a viewport and
caches bounded visible prose. It never rebuilds all historical Markdown on each
token. Tool result limits imposed by Pi remain limits: the inspector labels
upstream truncation and does not open arbitrary external full-output paths.
Safe request fields omit mutation bodies and environment values; existing command
and pattern sanitizers may shorten them. Credential redaction and terminal-control
stripping apply to expanded text. Hidden reasoning and raw workflow blocks stay
out of prose. Validated completion/review fields appear as reported results and
reported verification, rather than inferred test success.

Role labels, activity labels, headings and borders use standard ANSI cyan for A and
yellow/amber for B. The activity clock uses ANSI white for secondary gray text,
and the recent-call summary uses amber. Workspace and inspector prose use the terminal's default
colors. These styles work with the basic 16-color palette and need no truecolor
support or `COLORFGBG` guess. `NO_COLOR` and `TERM=dumb` disable role color. `TERM=dumb` also uses a static
activity marker.
Text labels, state words, borders and selection markers retain meaning without
color. Search, copy/export and future spawned-subagent execution remain outside
this interface.

## Choose sessions and models

`/sessions` shows current bindings. `/sessions A` and `/sessions B` list saved
sessions for that role and project, including identity, project, timestamp, and
first message. Selecting a session opens history first. Press Enter in history
to switch; viewing alone leaves runtime bindings unchanged. In plain mode, copy
the listed path into `/switch A PATH` or `/switch B PATH`.

`/new` starts a new conversation with empty sessions for both agents and a blank
current view. Previous work remains in History, including after restart.
`/new A` and `/new B` reset only that role and open the blank current view; the
other role retains its context. Use `/new` when both agents need a fresh start.
`/switch` restores that role's Pi conversation context. In memory mode, repeated
`/new` stays in memory and saved-session switching is unavailable. History
previews never repair or rewrite session files; malformed or cyclic history is
rejected. Failed switches preserve the current conversation. None of these commands resumes an interrupted
coordinator workflow. Startup replays saved outcomes and supersedes unfinished
workflows with fresh sessions. Status reports that supersession. Cancelled,
timed-out, and failed operations remain terminal after replay. Session and model
changes clear a pending plan, so ask for a new plan before approving work.

Esc then m from the editor opens the model picker. a/b chooses the agent;
Up/Down chooses a model; Left/Right selects Low, Medium, or High reasoning for A
and Off, Low, Medium, or Xhigh for Qwen3.8. Enter applies the choice. s toggles Remember after restart (on by default),
r refreshes, h opens help, and Esc returns to the draft. These controls are shown
inside the picker.

A offers GPT-6.1 Sol, GPT-5.6 Terra, and GPT-6 Luna. The approved IDs are maintained
in `src/security/models.ts`; Pi supplies the model metadata. B lists downloaded LM Studio LLMs, marks readiness,
and explains when a model lacks tool calling or the required context support.
When B changes, the app unloads the previous model, loads the selection, and waits
for readiness. A compact progress panel shows the stage and elapsed time; a
notification confirms readiness. Esc or Ctrl+C requests cancellation and restores
the previous model after any pending LM Studio operation settles. q asks to quit;
y confirms exit after cleanup, while n or Esc returns to loading. Failed
restoration marks B unavailable until a model is selected again.

`/model A` and `/model B` open the same picker. In plain mode they print the choices
and commands. `/thinking A` lists Low, Medium, and High; `/thinking B` lists the
levels supported by the selected local model.
Qwen3.8 supports Off, Low, Medium, and Xhigh; other local models remain Off.
Selections apply to that role's current conversation and next operation.
Model changes retain conversation context and rebuild the isolated runtime.
They also work before a role has written its first response to disk.
Model metadata, endpoint policy, and credential retrieval are validated before
the replacement is installed. Failed selections restore the previous runtime and
local model when possible. Registry availability does not certify project access to every model.
The API can still reject an inference request.

All model, session, and configuration mutations require idle work. Agent A
remains read-only after every replacement. The secure provider configuration
and credential boundary remain in force.

Use the same commands in either terminal interface:

```text
/model A openai/gpt-6-luna
/thinking A high
/model B lm-studio/qwen3.6-35b-a3b
/thinking B off
/config review-rounds 3
/config timeout-ms 600000
```

Explicit command choices are temporary unless you append `save`:

```text
/model A openai/gpt-6-luna save
/thinking B off save
/config review-rounds 3 save
/config timeout-ms 600000 save
```

Saving updates only the corresponding non-secret coordinator defaults. Other
settings remain intact. CLI overrides take precedence on restart. The picker
saves when Remember after restart is checked; toggle S for a temporary choice.

## Verify changes

Run `npm run check`, `npm test`, `npm run build`, and `npm run verify:isolation`.
Run `npm run verify:terminal` for real PTY coverage. It requires Python 3, macOS,
and the existing secure runtime prerequisites. It creates isolated workspaces
and state, uses unique dummy credentials with installed Pi Responses and Chat Completions fixtures,
and deletes the fixtures afterward. It makes no live inference requests.

After building, `node scripts/verify-model-picker.mjs` verifies a real LM Studio
switch to downloaded Gemma 4 E4B, readiness and one bounded local inference. It
requires exactly one loaded model and restores that model in cleanup. Pass a
different downloaded model key as its argument when needed. It uses no OpenAI key.

See [current workspace verification](current-workspace-verification.md) for
this implementation's results and real PTY evidence. The earlier
[terminal verification](terminal-verification.md) retains its separate live API
workflow and historical evidence.

## Installed skills

Use `/skills` to ask A for the installed catalog, or `/skill:NAME [request]` to
request one skill. Both commands create ordinary operator turns. They do not
approve execution or change the active workflow. Both roles can read installed
Pi skill instructions through the sandboxed `skills` tool.

## Compaction pauses

Current activity shows `Agent A is compacting Agent A's history` or
`Agent A is compacting Agent B's history`, elapsed time, and `Ctrl+C cancel`.
Execution pauses while the summary is created and committed. The indicator is
shared by the TUI and plain REPL and does not require activity diagnostics.
Cancellation takes precedence until cleanup drains. Narrow layouts retain a
short compaction label and cancel hint.

Start and terminal milestones remain in request history even for a quick
compaction. Completion reports that history was compacted; the next real activity
shows whether execution continued. Failure reports that execution stopped and
preserves completed edits and the archive. Summary requests are not displayed
as A planning/review runs or tool calls.
