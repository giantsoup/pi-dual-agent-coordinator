# Implement narrative TUI history

Use this prompt from the repository root:

```text
Implement docs/tui-narrative-history-plan.md in this repository. Complete the feature, tests, documentation, and verification; the deliverable is working application code.

First read the plan in full, applicable AGENTS.md files, CONTRIBUTING.md, and the architecture/security/terminal documents linked by the plan. Inspect the current working tree and installed Pi interfaces before editing. The plan was grounded in Pi 0.67.68 and a heavily modified checkout. Preserve existing work and incorporate compatible changes that have landed since the investigation. A worktree from HEAD alone may omit required uncommitted behavior. Keep this task scoped to the history feature; dependency upgrades, trusted installation, commits, and pushes require separate authorization.

The user-visible contract is:

1. Show chronological narrative output from both Agent A and Agent B, including A planning, check-ins, review, and repairs, with clear attribution. Preserve B -> A check-in -> resumed B ordering.
2. While reasoning, show one message-scoped Thinking placeholder. Cycle four frames ("Thinking", "Thinking.", "Thinking..", "Thinking..."), then repeat from zero dots. Use 500 ms frames and reserve three dot cells. Keep all partial reasoning out of the UI. Replace the placeholder atomically with the completed eligible provider summary, using the plan's preview/expansion rules. Ordinary response text still streams.
3. Reuse the existing TUI refresh timer for truthful active-task labels. Animation is presentation-only: no new history events, transcript revisions, unread increments, scroll movement, repeated Markdown work, or deadline resets. Settle promptly and clean up timers. Plain readline and TERM=dumb remain static.
4. Place one expandable totals row per contiguous tool batch between narrative updates. Count unique executed calls exactly, preserve failures, and split groups at message/role/run/check-in boundaries. Retain detailed read-only inspection.
5. Use Pi archives for committed bodies, ordered metadata references for replay, and bounded live overlays. Preserve stable message/block identity, atomic stream/commit/archive reconciliation, read-only archive access, and explicit legacy/unavailable states.

Follow the plan's implementation sequence. Prove identity, grouping, safe display, Thinking-only behavior, and replay with focused fixtures before replacing the renderer. Keep workflow approval, role permissions, response repair, cancellation, B-turn supervision, broker security, and runtime replacement behavior intact. Preserve existing editor, scroll, inspector, help, mouse, color, and terminal-restoration behavior. Keep Agent B's current reasoning configuration unchanged.

Exercise the real TUI with the existing actual-Pi dummy-provider/PTY harness at 80x24 and 120x40, plus wider and below-minimum resize cases. Verify prolonged Thinking animation, atomic summary replacement, tool totals, both agents, A/B interleaving, cancellation, restart, and paused scrolling. Use controlled clocks for animation unit checks. Keep fixture writes confined to disposable workspaces and use dummy secrets for security checks.

Run the appropriate focused checks during development, then npm run check, npm test, npm run build, npm run verify:isolation, npm run verify:terminal, and git diff --check. Inspect captured output and review the complete diff. Fix failures caused by this work and distinguish existing failures or unavailable prerequisites with exact evidence. Credential-backed verification must use the established trusted installation/broker flow; never expose credentials through tools, logs, prompts, or screenshots.

Continue through implementation and verification, making routine reversible choices autonomously. If current source invalidates a detail of the plan, document the evidence and preserve the user-visible contract. Stop only for a required missing prerequisite or consequential ambiguity that prevents safe progress, and state exactly what remains.

Finish with a concise report of the implemented behavior, files changed, checks actually run, observed results, and remaining limitations. Distinguish dummy-provider/PTY evidence from live-provider evidence. Do not claim installation, delivery, full-suite success, or production readiness beyond what was verified.
```
