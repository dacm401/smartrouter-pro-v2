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
import { resolve } from "path";

const testDbUrl =
  process.env.DATABASE_URL?.replace(/\/[^/]+\?/, "/smartrouter_test?") ??
  `postgresql://postgres:postgres@localhost:5432/smartrouter_test`;

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Use threads pool with single-thread-per-worker for complete test isolation.
    // Each worker thread has its own module state and connection pool.
    pool: "threads",
    poolOptions: {
      threads: {
        minThreads: 1,
        maxThreads: 1,
        singleThread: true,
      },
    },
    // Give slow DB tests enough time; avoids false timeouts on cold Docker I/O.
    testTimeout: 30_000,
    // Only repo integration tests — runs in its own process.
    include: ["tests/repositories/**/*.test.ts", "tests/features/**/*.test.ts"],
    // No exclude needed — this is a standalone config.
    env: {
      DATABASE_URL: testDbUrl,
      // Force Node module resolution to find packages from THIS workspace's node_modules.
      // On Windows, NTFS hardlinks cause npm to reuse inodes across workspaces,
      // so realpath() resolves vitest packages to the original workspace path.
      NODE_PATH: resolve("node_modules"),
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
