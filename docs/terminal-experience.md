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
node "$pi_dual_runtime/dist/src/index.js" doctor "$PWD" --no-mcp
node "$pi_dual_runtime/dist/src/index.js" repl "$PWD" --no-mcp
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
clears it. Another prompt revises it. An explicit request to start immediately
can still use the existing `pi-execute` workflow.

Only one request runs at a time. Submitted text clears when the service accepts
it. You can edit the next draft during work. An attempted second submission stays
in the editor with a busy explanation. No steering or follow-up queue is created.
Help, status, history viewing, cancellation, and exit remain available.

Use `/cancel` or Ctrl+C during work. The coordinator aborts Pi, waits for its
runtime to become idle, and prevents later execution, review, repair, or handoff
requests. The editor keeps your draft. Completed changes remain on disk.
Cancellation does not roll them back. `/quit` cancels work and exits.

While idle, Ctrl+C clears a TUI draft. On an empty editor, press Ctrl+C twice
within 1.2 seconds to exit. Readline also requires a repeated idle Ctrl+C to exit.
Esc closes an overlay, returns focus to the editor, or dismisses editor completion. SIGTERM, SIGHUP, and SIGINT
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
work never changes that live identity. The current phase follows the tool list,
and live activity is the last line below the workspace and optional Activity panel.
Records follow event order, including tools executed after a senior check-in.

During execution, `B turns` shows completed model turns for the current handoff
and the next Agent A check, or that A is checking the current boundary. One model
response and its tool results count as one turn, even if it calls several tools.
This uses the execution supervisor's counter, including completion repair, and
resets for each new handoff. A terminal response goes to final review instead of
a process check. Counts and check state are retained with request history;
older records without this telemetry do not invent a model-turn count.

Previous turns occupy a slim left rail when at least 104 columns and 14 body rows
are available. The rail takes 22% of the width, capped at 28 cells. At 80 columns,
a compact History control replaces the rail. Focus it with F6 and press Enter to
open the same record list in the body. Inspectors also replace the body, leaving
the live pointer, composer and F1 hint visible. Below 80x24, a compact notice
preserves input, resize, cancellation and exit handling. Pi retains its existing
bounded multiline editor viewport and IME cursor marker.

- F1 opens contextual help from any pane or overlay. F1 or Esc restores the
  previous view, focus, record selection and inspector position. `/help` is the
  typed editor fallback. The footer and shortcut help use the binding definitions.
- F6 and Shift+F6 cycle visible panes. Normally these are editor, workspace,
  history and activity when shown. An open body inspector cycles with the editor
  and visible activity. Opening an inspector focuses it explicitly.
- F2 shows or hides activity diagnostics.
- Wheel or trackpad scrolling over the request pane moves through its records
  and visible prose. PageUp/PageDown scrolls a page and Shift+Up/Down scrolls a
  line, even while the composer has focus. The pane shows counts of lines above
  and below the viewport, its scroll controls, and Following or Paused status.
  Scrolling pauses following so incoming events do not pull the view away.
  End returns to the current request and resumes following. The request heading,
  operation status and draft stay visible. Long prose previews remain bounded;
  select a run and inspect its retained output to read beyond that preview.
- After F6 focuses the workspace, Up/Down selects semantic records and brings
  the selected record into view. In history, PageUp/PageDown also pages through
  records. Home selects the beginning. End returns to the current
  turn and resumes following. Space toggles one fold; Right expands; Left
  collapses or selects the parent. Enter opens read-only inspection.
- Turn folds expose role runs. Run folds expose individual calls. Tool output
  stays folded by default, with names, targets, states, counts and failure markers
  visible. Each planning, execution, review and protocol-repair run has its own ID.
- In the focused inspector, 1 selects summary, 2 safe request or objective,
  3 retained output or visible assistant prose, and 4 identity/status metadata.
  Up/Down, PageUp/PageDown and wheel scrolling over the inspector scroll
  independently; Home/End reaches the output
  edges. Printable inspector shortcuts never intercept editor typing.
- Mouse reporting is enabled only during the TUI session. Use your terminal's
  Shift+drag selection gesture to select text while mouse reporting is active.
- Esc closes one view at a time, then returns to the editor. Closing help over
  inspection restores inspection first.
- Editor Enter submits, Shift+Enter inserts a newline, and bracketed paste keeps
  multiline input. Tab retains Pi completion. Alt+Up opens prompt history while
  saving the draft; Down returns toward that draft. Busy submissions retain it.

Browsing pauses following and anchors the reader to a record ID. New output,
completion and resize retain that record. An unread activity count and End action
provide a path back to current work. Completed results remain current until a new
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

Role labels, live pointers, headings and borders use standard ANSI cyan for A and
yellow/amber for B. Workspace and inspector prose use the terminal's default
colors. These styles work with the basic 16-color palette and need no truecolor
support or `COLORFGBG` guess. `NO_COLOR` and `TERM=dumb` disable role color.
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

F3 opens the model picker. A/B chooses the agent; Up/Down chooses a model;
Left/Right selects Low, Medium, or High reasoning for A; Enter applies the choice.
S toggles Remember after restart (on by default), R refreshes, and Esc returns
to the draft. These controls are shown inside the picker.

A offers GPT-6.1 Sol, GPT-5.6 Terra, and GPT-6 Luna. This manual list is maintained
in `src/security/models.ts`. B lists downloaded LM Studio LLMs, marks readiness,
and explains when a model lacks tool calling or the required context support.
When B changes, the app unloads the previous model, loads the selection, and waits
for readiness. A compact progress panel shows the stage and elapsed time; a
notification confirms readiness. Esc or Ctrl+C requests cancellation and restores
the previous model after any pending LM Studio operation settles. Q quits after
cleanup. Failed restoration marks B unavailable until a model is selected again.

`/model A` and `/model B` open the same picker. In plain mode they print the choices
and commands. `/thinking A` lists Low, Medium, and High; `/thinking B` lists Off.
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
