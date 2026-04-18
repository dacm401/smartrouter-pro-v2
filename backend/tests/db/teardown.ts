// workspace: 20260416214742
/**
 * Vitest global teardown — runs after all tests complete.
 * Closes the shared test connection pool.
 */
import { closeTestPool } from "./harness";

await closeTestPool();
