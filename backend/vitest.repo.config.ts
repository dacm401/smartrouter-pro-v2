/**
 * Vitest config for Repository Integration Tests (Sprint 10).
 *
 * Runs in a SEPARATE vitest process from the main suite.
 * This guarantees complete process isolation — no module-level pool contamination.
 *
 * Usage:
 *   npm run test:repos        — run once
 *   npm run test:repos:watch  — watch mode
 */
import { defineConfig } from "vitest/config";

const testDbUrl =
  process.env.DATABASE_URL?.replace(/\/[^/]+\?/, "/smartrouter_test?") ??
  `postgresql://postgres:postgres@localhost:5432/smartrouter_test`;

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Only repo integration tests — runs in its own process.
    include: ["tests/repositories/**/*.test.ts", "tests/features/**/*.test.ts"],
    // No exclude needed — this is a standalone config.
    env: {
      DATABASE_URL: testDbUrl,
    },
    setupFiles: ["./tests/db/setup.ts"],
    globalTeardown: "./tests/db/teardown.ts",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/services/**/*.ts"],
      exclude: [],
    },
  },
});
