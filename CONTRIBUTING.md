# Contributing

## Development setup

1. Select project-scoped Node.js `24.22.0` and npm `12.2.0`. Supported Node is `>=24.22.0 <25`. Do not change global defaults. Verify the actual versions before installing.
2. Run `npm ci`, then `npm run verify:dependencies`. Normal installation runs the native TypeScript build and macOS helper build. Keep optional platform packages enabled.
3. On macOS, install Apple Command Line Tools. Run `npm run verify:isolation` with an unlocked Keychain and a logged-in desktop. Only dummy secrets are used.
4. Prepare a trusted installation outside the target workspace with `npm run secure:install -- /new/trusted/path`. Follow [secure setup](docs/secure-setup.md). Do not run credential-backed sessions from code the agents can edit.

npm 12 uses the checked-in `allowScripts` policy. Only the reviewed Google SDK
preinstall and protobufjs postinstall are approved, at exact versions. The optional
fsevents rebuild is denied; its shipped macOS binary is verified separately.
Review new lifecycle scripts explicitly when changing dependencies.

## Common commands

```bash
npm run build
npm run check
npm test
npm run verify:isolation
npm run verify:terminal
```

Use the separate trusted installation for interactive testing, with an approved OpenAI Responses model for Agent A and an approved local LM Studio model for Agent B. Agent A defaults to GPT-6 Luna with high reasoning; B defaults to Qwen3.8 27B with API thinking off. Agent A requires API-key authentication; environment keys, plaintext Pi auth, and subscription auth are not accepted. Start LM Studio and load the selected executor before running doctor or the REPL. See the [local executor setup](README.md).

The PTY verifier requires Python 3. It drives both interfaces with real Pi runtimes,
dummy provider responses, and isolated mutation workspaces. Live API verification
is separate. See [terminal verification](docs/terminal-verification.md).

## Change expectations

- Keep changes scoped to the requested behavior.
- Preserve the role split: Agent A plans and reviews, Agent B executes.
- Add or update tests for behavior changes when practical.
- Keep README and example configs in sync with the actual CLI behavior.
- Do not commit secrets, local auth files, or machine-specific paths.

## Pull requests

- Summarize the user-visible change.
- List the verification you ran.
- Call out any follow-up work or known limitations.

The frozen direct dependencies and TypeBox compatibility checkpoint are recorded
in [Pi upgrade verification](docs/pi-upgrade-verification.md). Run build-dependent
checks sequentially because they replace `dist`. Vitest uses two fork workers to support tests that change cwd and to bound
concurrent sandbox subprocess startup. Keep that worker cap when running the suite. Keep its default mock cleanup and strict NodeNext
TypeScript checks enabled.

The [dependency API audit](docs/dependency-api-audit.md) records current public
integrations and the security reasons for retaining application adapters. Run
`npm run verify:dependencies` with the scoped toolchain when changing imports or
compiler settings.
