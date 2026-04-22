import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  expect: {
    timeout: 5_000
  },
  fullyParallel: false,
  outputDir: "../../test-results/web",
  reporter: [["list"]],
  testDir: "../../test/web-e2e",
  timeout: 30_000,
  use: {
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 }
      }
    }
  ]
});
