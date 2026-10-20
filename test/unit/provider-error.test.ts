import { expect, it } from "vitest";
import { isProviderContextOverflow } from "../../src/security/provider-error.js";
it("classifies bounded context errors without classifying other provider failures", async () => {
  expect(await isProviderContextOverflow(new Response('tokens to keep from the initial prompt is greater than the context length', { status: 400 }))).toBe(true);
  for (const status of [401, 403, 429, 503]) expect(await isProviderContextOverflow(new Response('context_length_exceeded', { status }))).toBe(false);
  expect(await isProviderContextOverflow(new Response('invalid argument', { status: 400 }))).toBe(false);
  expect(await isProviderContextOverflow(new Response('context_length_exceeded' + 'x'.repeat(8192), { status: 400 }))).toBe(false);
});
