# Terminal experience plan

The main branch targets a readable, reliable terminal experience built on the Pi SDK
and `@mariozechner/pi-tui`. Keep the plain terminal fallback usable alongside the TUI.

## Step 0: Keep the main branch focused on the terminal

- Preserve the browser implementation and in-progress changes on `feature/browser-experience`.
- Remove the browser frontend, HTTP server, transport protocol, assets, and browser tests from main.
- Remove browser-only workspace, settings, and timeline services and their unused contracts.
- Keep terminal activity history, setup and authentication, MCP support, and workflow persistence.
- Check types, run the remaining tests, build the CLI, and verify terminal startup and shutdown.
- Commit the cleanup and leave the main worktree clean before starting terminal improvements.

The archive branch includes the original implementation plan and browser dependencies.
Terminal authentication may still open a browser for subscription login.

## Step 1: Make input and live updates dependable

- Publish progress while prompts are running.
- Preserve drafts typed during execution.
- Keep useful assistant messages after streaming ends.
- Show accurate running, waiting, finished, and failed states.

## Step 2: Improve transcript readability and layout

- Render Markdown and code clearly using the existing terminal toolkit.
- Give the conversation most of the screen and make diagnostic details optional.
- Keep the editor and next action visible at supported terminal sizes.
- Bound overlays to the available screen and keep keyboard hints concise.

## Step 3: Add controls for running and recovering work

- Stop active work without closing the app.
- Define timeout, retry, and failure recovery behavior.
- Explain the difference between viewing history, resuming work, and starting fresh.

## Step 4: Finish everyday terminal controls

- Add command completion and prompt history.
- Select sessions without typing session file paths.
- Make model and configuration choices accessible from the terminal.

## Step 5: Verify complete terminal workflows

- Exercise planning, revision, approval, execution, review, and final output through the TUI.
- Test resizing, keyboard handling, streaming, draft preservation, cancellation, and clean shutdown.
- Verify the plain fallback produces equivalent workflow outcomes.
- Validate real Pi sessions and models in addition to deterministic simulated runtimes.
