# Verification benchmark

These two book-list files preserve the investigation's 30-test snapshot. They are
independent of the app in `reading-list-test/`. Two test cases fail deliberately.
Four expectations are wrong across five assertions in those cases; two wrong
assertions are hidden behind the first failure in the composition case.

Run `node scripts/verify-agent-b-expectations.mjs` to audit all five assertions.
The failing command exits 1 with 30 tests, 28 passing and 2 failing. The passing
command uses `passing.test.mjs` and exits 0 with one passing test.

No real session archive or private reasoning is included. Benchmark history is
created using native sandboxed tools and fixture inference, then projected on
in-memory copies with Pi's public APIs. Seed results are historical context,
never evidence that the current handoff ran a check.
