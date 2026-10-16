# Contributing

## Development setup

1. Install Node.js `>=20.6.0`.
2. Run `npm install`.
3. On macOS, install Apple Command Line Tools. Run `npm run verify:isolation` with an unlocked Keychain and a logged-in desktop. Only dummy secrets are used.
4. Prepare a trusted installation outside the target workspace with `npm run secure:install -- /new/trusted/path`. Follow [secure setup](docs/secure-setup.md). Do not run credential-backed sessions from code the agents can edit.

## Common commands

```bash
npm run build
npm run check
npm test
npm run verify:isolation
```

Use the separate trusted installation for interactive testing, with approved `openai` Responses models for both roles. Agent A defaults to GPT-6 Luna with high reasoning. API-key authentication is required; environment keys, plaintext Pi auth, and subscription auth are not accepted.

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
