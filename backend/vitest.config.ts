import { defineConfig } from "vitest/config";
import { resolve } from "path";

const testDbUrl =
  process.env.DATABASE_URL?.replace(/\/[^/]+\?/, "/smartrouter_test?") ??
  `postgresql://postgres:postgres@localhost:5432/smartrouter_test`;

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: [
      // Repo integration tests run in SEPARATE vitest processes (npm run test:repos).
      // Reason: each repo test file needs its own worker to avoid module-level
      // pool contamination (connection.ts _pool is shared across files in same worker).
      "tests/repositories/**",
      // API integration tests run in SEPARATE vitest process (npm run test:api).
      // They use real repos + real DB and must not share a worker with mock tests.
      "tests/api/**",
      // Feature tests (detectImplicitFeedback / recordFeedback / learnFromInteraction wiring)
      // run in SEPARATE vitest process (npm run test:repos) with DB isolation.
      "tests/features/**",
    ],
    env: {
      // Override DATABASE_URL before any app module is loaded.
      // The harness connects to smartrouter_test and loads the schema.
      DATABASE_URL: testDbUrl,
    },
    // Runs once before all tests — creates test DB and loads schema.
    // setupFiles runs in a separate VM context BEFORE the test bundle,
    // so process.env changes here affect how app modules initialize.
    setupFiles: ["./tests/db/setup.ts"],
    // Runs once after all tests — closes the test connection pool.
    globalTeardown: "./tests/db/teardown.ts",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/services/**/*.ts"],
      exclude: [],
    },
  },
});
