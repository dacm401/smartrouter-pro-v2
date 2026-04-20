/**
 * Vitest config for API Integration Tests (Sprint 11 SI-001).
 *
 * Runs in a SEPARATE vitest process from the main suite and repo suite.
 * This guarantees complete process isolation — no pool contamination with
 * repo tests or mock suite.
 *
 * Usage:
 *   npm run test:api         — run once
 *   npm run test:api:watch  — watch mode
 */
import { defineConfig } from "vitest/config";

const testDbUrl =
  process.env.DATABASE_URL?.replace(/\/[^/]+\?/, "/smartrouter_test?") ??
  `postgresql://postgres:postgres@localhost:5432/smartrouter_test`;

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/api/**/*.test.ts"],
    // API integration tests share a real DB; run files sequentially to prevent
    // one file's beforeEach truncateTables() from racing another file's seeding.
    fileParallelism: false,
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
