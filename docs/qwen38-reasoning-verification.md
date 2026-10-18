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
The source and installed acceptance results are recorded below after their
separate gates complete.

## Source acceptance

The sequential fresh install, dependency tree/guard, strict check, full tests,
build, isolation and terminal gates passed under Node 24.22.0/npm 12.2.0.
The full suite passed 392 tests in 58 files in 63.63 seconds. Isolation passed
341 assertions plus two security tests. Rendered terminal verification passed
458 assertions, including Qwen3.8 reasoning choices and applying Xhigh from F3.
The dependency audit reported zero vulnerabilities. Exact dependency versions
remain those frozen in the Pi upgrade record. Evidence files are `final-*` in
the directory above.
