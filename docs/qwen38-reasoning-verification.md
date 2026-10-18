# Qwen3.8 reasoning

Qwen3.8 27B now defaults to `xhigh` in the application. F3 → B exposes Off,
Low, Medium and Xhigh, with left/right selection and the existing Remember
control. `/thinking B xhigh save` and `--thinking-b xhigh` use the same runtime
setting. Existing explicit saved choices and CLI overrides remain authoritative.
Other local models retain their existing Off-only policy.

The exact loaded model is `qwen/qwen3.8-27b`. On 18 October 2026, the local
LM Studio `/api/v1/models` response advertised `off`, `low`, `medium`, `xhigh`
and `on`, with `xhigh` as its default. The app exposes the explicit effort levels;
it does not map High or Minimal to a different level silently. The
[official Qwen chat template](https://huggingface.co/Qwen/Qwen3.8-27B/blob/main/chat_template.jinja)
defines Low, Medium and Xhigh, with thinking disablement handled separately.

Pi's public `thinkingLevelMap` and `supportsReasoningEffort` declare the supported
settings. The broker validates and forwards `reasoning_effort` for the logical
Qwen3.8 model before substituting the verified loaded-instance ID. Off maps to
`none` in the OpenAI-compatible request. The previous unconditional `none`
override is removed for Qwen3.8. Endpoint, model, credential and role restrictions
are unchanged. No LM Studio load, unload, template edit or download is required.

Tests cover all four serialized request values through real Pi sessions, rejected
unsupported levels, forged broker requests, saved settings, retained conversation,
and reasoning changes without model reload. The rendered PTY check selects and
applies Xhigh from Agent B's picker. The local verifier reports the effective
thinking level and whether reasoning blocks occurred, without printing reasoning.

Execution evidence is under `/Users/Taylor/pi-qwen-reasoning-evidence-20261018`.
The source, installed and bounded live acceptance results are recorded below.

## Source acceptance

The sequential fresh install, dependency tree/guard, strict check, full tests,
build, isolation and terminal gates passed under Node 24.22.0/npm 12.2.0.
The full suite passed 392 tests in 58 files in 63.63 seconds. Isolation passed
341 assertions plus two security tests. Rendered terminal verification passed
458 assertions, including Qwen3.8 reasoning choices and applying Xhigh from F3.
The dependency audit reported zero vulnerabilities. Exact dependency versions
remain those frozen in the Pi upgrade record. Evidence files are `final-*` in
the directory above.

## Trusted installation and live acceptance

The installed source commit is `39a7bbfc43d25d7a63463e7d0d6c017106d4301d`.
The immutable installation is:

```text
/Users/Taylor/.local/share/pi-dual/runtime-pi-1.3.0-qwen-xhigh-20261018
```

It includes its own Node 24.22.0/npm 12.2.0 and Pi 1.3.0. All 26,632 manifest
entries passed byte/mode/link verification before and after installed checks,
after live verification, and after the ordinary-launcher terminal check. Installed
dummy-secret isolation passed 341 assertions; installed rendered PTY verification
passed 458 assertions. These ran sequentially before accessing live credentials.
The installed dependency guard and canonical-workspace doctor also passed.
Evidence is in `installed-*` logs.

Separate bounded live checks then passed:

- The cloud smoke check returned `LOCAL_API_OK` using GPT-6 Luna/high in 1,839 ms,
  with 1,573 input tokens and seven output tokens.
- The local executor used `lm-studio/qwen/qwen3.8-27b`, reported `thinking: xhigh`
  and `reasoningObserved: true`, and used write, read and bash. The expected
  `LOCAL_EXECUTOR_OK` file was verified in a disposable workspace, then removed.
- Read-only LM Studio inventories before and after verification matched: the
  same Qwen3.8 instance remained loaded with a 65,536-token context. No model
  loading, unloading, download or template mutation was performed.

Reasoning content and credentials were not printed in the verification results.
The dependency versions and exceptions remain those in the
[Pi upgrade record](pi-upgrade-verification.md); this change introduced no new
dependency or exception.

## Saved default and active launcher

The existing global config now saves `thinkingB: xhigh` for the existing canonical
Qwen3.8 model. Every other config field was preserved. The pre-change config is
privately backed up at:

```text
/Users/Taylor/.local/share/pi-dual/state-backups/pi-upgrade-20261018T205114Z/config-before-qwen-xhigh.json
```

`/Users/Taylor/bin/pi-dual` now executes this installation's absolute `bin/node`
and `dist/src/index.js`, retaining its canonical working directory and argument
forwarding. The launcher was replaced atomically, retaining mode 0755. Its prior
contents are backed up alongside the config as `launcher-before-qwen-xhigh`.
Global Node/npm were not changed. Restart an existing coordinator to use the new
runtime and saved setting.

The actual ordinary launcher passed doctor and a real 120×30 terminal run with
the saved config. F3 → B displayed Xhigh selected and Off, Low, Medium and Xhigh
choices. `/quit` exited successfully and restored terminal flags. This final
check submitted no inference prompt and used disposable session state. Evidence:
`launcher-terminal-final.log` and `launcher-qwen-xhigh.screen.txt`. Two earlier
driver attempts used incorrect startup readiness assumptions; those failed logs
are retained. Waiting for the ready workspace before F3 resolved the driver
timing without application changes or relaxed assertions.

Final preservation checks verified 252 original source/documentation files,
20 excluded demo files, 16 older runtime entry points and 15 backed-up state files.
The original checkout and concurrent untracked planning document were preserved.
An external append to the existing coordinator log was preserved, with its prior
bytes verified as an exact prefix and a private copy retained. The intended
persistent changes are the saved reasoning setting and launcher target.

## Rollback and remaining limits

To disable reasoning while retaining the upgrade, use `/thinking B off save`,
or select Off in F3 → B with Remember enabled. To revert this implementation,
stop the coordinator and archive the current global config first. Restore
`config-before-qwen-xhigh.json` to
`~/.pi/dual-agent-coordinator/config.json`, then invoke the preceding Pi 1.3.0
artifact with its own Node:

```sh
runtime=/Users/Taylor/.local/share/pi-dual/runtime-pi-1.3.0-api-audit-20261018
"$runtime/bin/node" "$runtime/dist/src/index.js" repl /Users/Taylor/pi-dual-agent-coordinator --no-mcp
```

The launcher backup points to the pre-Pi runtime. A full pre-Pi rollback requires
the matching archived workspace state and saved Node, following the
[original rollback procedure](pi-upgrade-verification.md#rollback). Preserve
newer history separately before restoring that state. If restoring the launcher
backup, restore its original executable mode 0755; the private backup is mode
0600. All old artifacts remain available.

The bounded live run proves reasoning and tool execution with Xhigh. It does not
benchmark reasoning quality, long-running workflows, or third-party configured
MCP servers. No merge into the original checkout, push or publication was made.
