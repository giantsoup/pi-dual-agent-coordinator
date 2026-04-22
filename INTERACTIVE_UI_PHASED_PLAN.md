# Phased Plan: Headless Coordinator, Rich TUI First, Web Portal Second

## Status
- Created to preserve the implementation plan in repo history.
- As of 2026-04-20, Phases 1-5 are implemented.
- Phase 5 ships the localhost React SPA on top of the shared interactive service and portal transport.
- As of 2026-04-22, the portal frontend is a Vite + React + TypeScript SPA with Radix Dialog/Tooltip/Tabs primitives, lucide icons, flat operations-console styling, actor/status color tokens, MCP/runtime/metrics inspector panels, and Playwright smoke coverage.
- The portal SSE protocol now includes event ids, timestamps, heartbeat comments, a bounded replay buffer, `Last-Event-ID` handling, client snapshot fallback on replay gaps, POST origin validation, and the existing single-controller mutation lock.

## Summary
Refactor the current readline-driven `repl` into a headless interactive application core with a shared UI state/event contract, then build a production-grade `@mariozechner/pi-tui` interface on top of it. After that shared contract is stable, add a localhost-only web transport and a React SPA portal without rewriting coordinator logic.

## Goals
- Preserve the current coordinator/workflow behavior and session/runtime semantics.
- Make the coordinator UI-agnostic and reusable by both TUI and web clients.
- Upgrade `pi-dual repl` to a rich full-screen TUI by default.
- Keep a plain non-TTY/debug fallback.
- Prepare a clean, secure path to a localhost-only browser portal.

## Non-Goals
- No remote or multi-user control plane in this plan.
- No changes to workflow semantics, machine block contracts, or MCP policy behavior.
- No attempt to reuse telemetry logs as the browser UI protocol.
- No second backend process; the app remains a single local Node process.

## Architecture Decisions
- `Coordinator` remains the domain/core orchestration engine.
- Introduce a new headless interactive service layer between `Coordinator` and any UI.
- Introduce a dedicated UI event/state model. Telemetry remains for logging/metrics, not as the primary UI contract.
- `pi-dual repl` becomes the rich TUI entrypoint for TTY sessions.
- Plain mode remains available via auto-fallback on non-TTY and an explicit `--plain` flag.
- The later browser portal is localhost-only, single-operator, served by the same Node process.
- The later browser UI targets a small TypeScript React SPA.

## Current Integration Points To Preserve
- CLI entry and command routing in `src/index.ts`.
- Current REPL shell seam in `src/app/bootstrap.ts`.
- Current status snapshot contract in `src/types/status.ts`.
- Current coordinator surface in `src/coordinator/coordinator.ts`.
- Current runtime event bridge in `src/coordinator/bind-runtime-events.ts`.

## Public API / Interface Changes
- Extend `ReplCliOptions` with `plainUi?: boolean`.
- Update `parseCliArgs()` and help text so `pi-dual repl` supports `--plain`.
- Keep `Coordinator` public methods stable where possible.
- Add a new UI-facing service interface, for example `InteractiveCoordinatorService`, with:
  - `start()`
  - `dispose()`
  - `dispatch(action)`
  - `getState()`
  - `subscribeState(listener)`
  - `subscribeUiEvents(listener)`
- Add new shared UI types in a dedicated module, for example `src/types/ui.ts`:
  - `InteractiveUiState`
  - `UiConversationEntry`
  - `UiActivityState`
  - `UiAction`
  - `UiEvent`
- Add a web transport contract in a dedicated module, for example `src/app/portal/protocol.ts`:
  - HTTP request/response DTOs for mutating actions
  - snapshot payload DTO
  - streamed event payload DTO
- Do not expose raw Pi session events directly to UI clients.

## Shared UI Contract To Build First
- `InteractiveUiState` must contain:
  - current `CoordinatorStatusSnapshot`
  - conversation history for operator-visible entries
  - live streaming buffer for the active assistant turn
  - pending plan view model
  - command palette / modal state
  - last error / notification state
- `UiConversationEntry` must support:
  - operator message
  - assistant planning response
  - workflow summary
  - plan-ready system entry
  - approval/discard system entry
  - runtime/session switch system entry
  - error entry
- `UiEvent` must support:
  - state changed
  - stream delta appended
  - stream committed
  - activity changed
  - notification raised
  - fatal error
- Telemetry continues unchanged for logs/metrics, but the UI layer gets its own event stream.

## Phase 1: Extract a Headless Interactive Application Core
1. Create a new interactive service module that owns UI-facing state and wraps `Coordinator`.
2. Move slash-command dispatching out of the readline loop and into a reusable action dispatcher.
3. Rename the current REPL bootstrap into a plain-shell implementation, for example `bootstrapPlainRepl()`.
4. Add a state reducer/store that derives operator-visible history and live stream state.
5. Extend runtime/coordinator event plumbing so the headless service can observe enough raw session information to build a transcript:
   - capture assistant `text_delta` content for the active turn
   - commit completed assistant text on `turn_end`
   - keep activity/progress separate from transcript
6. Keep `CoordinatorStatusSnapshot` intact, but stop treating it as the full UI model.
7. Ensure every mutating user action goes through one shared `dispatch(action)` path.

### Phase 1 Deliverables
- Shared interactive service and UI state types.
- Plain-shell client rewritten to consume the shared service.
- Existing behavior preserved for `/help`, `/status`, `/approve`, `/discard`, `/sessions`, `/handoff`, `/new`, `/switch`, `/quit`.
- No visual redesign yet.

### Phase 1 Acceptance Criteria
- Existing CLI workflows still pass unchanged in plain mode.
- Headless service can drive the current plain REPL without coordinator-specific logic in the shell.
- UI state contains enough information to render a transcript plus live activity without reading logs.

## Phase 2: Build the Production TUI and Make It the Default `repl`
1. Add `@mariozechner/pi-tui` as a direct dependency.
2. Implement a full-screen TUI app under `src/app/tui/`.
3. Use a fixed layout:
   - top header with phase, active role, workflow id, iteration, model badges, health
   - main transcript pane
   - right activity pane for live tool/MCP/workflow state
   - footer with command hints, pending-plan badge, repair count, session info
   - overlay/modals for sessions, handoff details, confirm flows, status JSON
4. Support keyboard behavior:
   - `Enter` submit
   - `Esc` close modal/cancel transient UI
   - `Ctrl+C` clear editor, double `Ctrl+C` or explicit quit to exit
   - slash commands remain first-class
5. Render planning responses and plan-ready states in structured cards.
6. Render active streaming assistant text in the transcript pane while separate activity widgets show tool/workflow progress.
7. Keep non-TTY and `--plain` behavior using the plain shell implementation.
8. Update `pi-dual repl` so:
   - TTY + no `--plain` => rich TUI
   - non-TTY or `--plain` => plain shell
9. Add a project-local theme file strategy only after the TUI shell is stable; do not hardcode ANSI styling.

### TUI Conventions
- No duplicated sources of truth between panes.
- No lossy UI-only parsing of rendered strings.
- No hidden critical states behind overlays.
- Resize-safe, alt-screen-safe, cleanup-safe on crash/exit.
- Degrade cleanly when terminal capabilities are limited.

### Phase 2 Acceptance Criteria
- `pi-dual repl` launches the rich TUI by default on TTY.
- Operator can complete the full planning → approve → execution → review/finalize flow entirely in the TUI.
- Session switching, pending-plan approval, and handoff inspection are all accessible without dropping to raw JSON unless explicitly requested.
- Plain mode remains functional and tested.

## Phase 3: Hardening and Production Readiness for Shared UI Core
1. Audit for lifecycle correctness:
   - startup failure
   - runtime replacement during active workflow
   - malformed machine-block repair loops
   - interrupted sessions and disposal
2. Add structured notification/error handling in the UI state model.
3. Add snapshot serialization boundaries so web transport can reuse the same DTOs.
4. Add compatibility shims so the plain shell and TUI can coexist without feature skew.
5. Finalize a versioned internal UI protocol for future browser use.

### Phase 3 Acceptance Criteria
- No UI-specific state leaks into `Coordinator`.
- No renderer depends on direct access to private coordinator internals.
- TUI and plain shell produce equivalent operator outcomes for the same action sequence.

## Phase 4: Add Localhost Web Transport Without Building the Full Portal Yet
1. Add a new top-level command, `pi-dual portal`, for the browser mode.
2. Run the same headless interactive service inside a local HTTP server.
3. Bind by default to `127.0.0.1` only.
4. Use:
   - HTTP POST endpoints for actions
   - HTTP GET endpoint for initial snapshot
   - WebSocket or SSE for streamed UI events
5. Add a per-process random auth token injected into the initial launch URL and required on all mutating requests.
6. Enforce single-operator semantics:
   - one active controller session
   - new browser tabs can observe
   - only the locked controller can mutate state
7. Reuse the exact same `InteractiveUiState` and `UiAction` contracts as the TUI.

### Portal Transport Endpoints
- `GET /api/state`
- `POST /api/actions`
- `GET /api/events`
- `GET /healthz`
- Static asset serving for the SPA

### Phase 4 Acceptance Criteria
- Browser client can fully drive the headless service through the shared protocol.
- No browser-specific behavior is added to `Coordinator`.
- Local-only security defaults are enforced by code, not documentation.

## Phase 5: Build the Local React SPA Portal
1. Create `ui/web/` as a small TypeScript React app.
2. Build a control-console layout mirroring the TUI information architecture:
   - header
   - transcript
   - activity pane
   - command/input area
   - modal drawers for sessions/handoff/status
3. Hydrate from `GET /api/state`, then subscribe to streamed UI events.
4. Use optimistic UI only for local transient controls; authoritative state always comes from the shared service.
5. Keep browser-specific concerns isolated to the SPA:
   - reconnect handling
   - token storage in memory only
   - focus management
   - keyboard shortcut mapping

### Phase 5 Acceptance Criteria
- The browser portal can perform the same operator workflows as the TUI.
- TUI and web render from the same state/event model.
- No duplicated orchestration logic exists in the frontend.
- The production web UI is split into a portal client, session hook, internal component layer, feature panels, and token/layout/component CSS files under `ui/web/src`.
- Browser QA is available through `npm run web:e2e`, which builds the Vite assets and runs Playwright against a mock portal protocol server.

## Test Plan
- Unit:
  - CLI parsing for `--plain` and `portal`
  - action dispatcher behavior for all slash commands
  - UI state reducer and transcript assembly
  - streaming delta commit/reset logic
  - portal auth token and single-controller lock logic
- Integration:
  - plain shell against shared service
  - TUI bootstrap selection logic
  - runtime replacement while workflow active
  - pending plan approve/discard flow through shared service
  - restart recovery reflected correctly in UI state
- End-to-end:
  - planning-only conversation
  - plan-ready then approve
  - execution with live tool activity
  - malformed response requiring repair
  - `/new` and `/switch` from TUI
  - browser reconnect during active execution
- Regression:
  - existing REPL tests adapted to plain-shell mode
  - status snapshot parity
  - no loss of metrics/logging behavior

## Rollout Order
1. Land headless interactive service and keep current plain REPL behavior.
2. Switch plain REPL to use shared service.
3. Land rich TUI behind the existing `repl` command with `--plain` fallback.
4. Stabilize and harden shared UI contracts.
5. Land `portal` command and transport.
6. Land React SPA.

## Assumptions and Defaults
- Web UI scope is localhost-only, single operator.
- `pi-dual repl` is the long-term rich interactive command.
- `--plain` is the explicit fallback switch.
- React SPA is the eventual browser choice.
- Shared UI contracts are internal and versioned within the repo before any externalization.
- Telemetry/logging remains separate from UI transport.
- No repo-wide migration to another UI framework or language is in scope.
