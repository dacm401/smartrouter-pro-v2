/**
 * Per-test-file isolation helper.
 *
 * Problem:
 *   vitest caches modules in the same worker.  If chat-execute.test.ts (which
 *   does NOT use this helper) runs first, it may lazily create the app pool
 *   before DATABASE_URL is correctly propagated to this worker, causing all
 *   subsequent repo tests to use a pool pointing at the wrong DB.
 *
 * Solution:
 *   Detect the calling file via the stack; on the FIRST call from each new
 *   file, call drainPool() so the next query() creates a fresh pool reading
 *   DATABASE_URL at that moment.
 *
 *   Within a file: truncateTables() alone is sufficient isolation.
 *
 * Usage:
 *   import { withFileIsolation, truncateTables } from "../db/per-file-isolation.js";
 *   beforeEach(withFileIsolation(async () => { await truncateTables(); }));
 */

import { truncateTables } from "./harness.js";
import { drainPool } from "../../src/db/connection.js";

export { truncateTables };

let _currentFile = "";

export function withFileIsolation(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const stack = new Error().stack ?? "";
    const fileMatch = stack.match(/tests[/\\]([^:\s]+)/);
    const file = fileMatch ? fileMatch[1]! : "";

    if (file !== _currentFile) {
      _currentFile = file;
      await drainPool();
    }

    await fn();
  };
}
