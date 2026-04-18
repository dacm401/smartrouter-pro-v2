// workspace: 20260416214742
/**
 * Vitest setup file — runs BEFORE the test bundle is loaded.
 *
 * Because this file runs in a separate VM context (before module resolution),
 * any process.env changes here affect how app modules initialize.
 *
 * We need DATABASE_URL to already point to `smartrouter_test` before
 * src/db/connection.ts is imported anywhere in the test bundle.
 * This is guaranteed by vitest.config.ts `env.DATABASE_URL`.
 *
 * This setup file calls the harness to:
 *   1. Create the `smartrouter_test` database if it doesn't exist.
 *   2. Load schema.sql into it.
 */
import { setupTestDatabase } from "./harness";

await setupTestDatabase();
