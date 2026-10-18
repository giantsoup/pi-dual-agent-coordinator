import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    maxWorkers: 2,
    include: ["test/**/*.test.ts"]
  }
});
