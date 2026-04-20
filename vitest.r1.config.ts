/**
 * Vitest config for R1 — E2E API Regression Pack (mock-based, no DB required).
 *
 * Runs API endpoint tests using vi.mock for all repository calls.
 * No DATABASE_URL, no test DB setup. No pool contamination.
 *
 * Usage:
 *   npm run test:r1          — run once
 *   npm run test:r1:watch   — watch mode
 */
import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "tests/api/chat.test.ts",
      "tests/api/evidence.test.ts",
      "tests/api/tasks.test.ts",
      "tests/api/chat-execute.test.ts",
    ],
    // R1 tests run in isolation — no shared state
    // NODE_PATH: force vitest workers to resolve packages from THIS workspace's
    // node_modules. On Windows, NTFS hardlinks cause npm to reuse inodes across
    // workspaces, so without NODE_PATH the worker may load vitest/hono from an
    // older workspace's node_modules — leading to wrong module versions.
    env: {
      NODE_PATH: resolve("node_modules"),
    },
  },
});
