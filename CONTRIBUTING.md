# Contributing

## Development setup

1. Install Node.js `>=20.6.0`.
2. Run `npm install`.
3. Copy the example Pi config files from [`examples/pi-agent/`](./examples/pi-agent/) if you need a local working setup.
4. Run `npm run doctor -- . --no-mcp` to confirm the local environment is wired correctly.

## Common commands

```bash
npm run build
npm run check
npm test
```

Use `npm run repl -- . --model-a ... --model-b ...` for interactive testing.

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
