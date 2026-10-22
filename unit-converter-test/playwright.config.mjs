import { defineConfig } from '@playwright/test';

/**
 * Local-only Playwright configuration for the unit converter page.
 *
 * A dependency-free `python3 -m http.server` serves this folder on
 * 127.0.0.1:4173 for the duration of the test run and is torn down by
 * Playwright after the run finishes. No external services or network access
 * are required beyond the Playwright installation itself.
 */
export default defineConfig({
  testDir: '.',
  testMatch: ['browser.test.mjs'],
  timeout: 30_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    trace: 'off',
  },
  webServer: {
    command: 'python3 -m http.server 4173 --bind 127.0.0.1 --directory .',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: false,
    timeout: 15_000,
  },
});
