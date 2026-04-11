/**
 * Integration test harness — IT-001 / Sprint 10
 *
 * Design:
 *   1. vitest.config.ts sets DATABASE_URL to `smartrouter_test` via `env`.
 *      This is read BEFORE any app modules are imported, so the app's
 *      pool (connection.ts) is already pointing at the test DB.
 *
 *   2. setupFiles runs the schema setup once on vitest startup.
 *
 *   3. Per-test isolation:
 *        truncateTables() opens a dedicated client, TRUNCATE CASCADE + COMMIT.
 *        Then the test body runs normally (reads/writes commit as usual).
 *      Use beforeEach + truncateTables() for reliable isolation.
 *        DO NOT use withTx() or withTxClient() — the app's pool issues
 *        separate connections per query, so BEGIN...ROLLBACK on one client
 *        does NOT isolate writes from reads inside the same test.
 *
 *   4. For tests that need guaranteed transaction semantics (e.g. checking
 *      intermediate state), use withTxClient() but note that the app's
 *      ExecutionResultRepo calls will NOT participate in that transaction
 *      (they use the shared pool, not the transaction client).
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import pg from "pg";

const { Pool } = pg;

export const TEST_DB_NAME = "smartrouter_test";

function getAdminUrl(): string {
  if (process.env.TEST_ADMIN_URL) return process.env.TEST_ADMIN_URL;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  try {
    const u = new URL(url);
    // Connect to the default 'postgres' db (always exists) for DDL operations
    return `${u.protocol}//${u.username}:${u.password}@${u.host}/postgres`;
  } catch {
    throw new Error(`Cannot derive TEST_ADMIN_URL from DATABASE_URL="${url}"`);
  }
}

async function ensureTestDb(): Promise<void> {
  const adminPool = new Pool({ connectionString: getAdminUrl(), max: 1 });
  try {
    const check = await adminPool.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [TEST_DB_NAME]
    );
    if (check.rows.length === 0) {
      console.log(`[harness] Creating database "${TEST_DB_NAME}"...`);
      await adminPool.query(`CREATE DATABASE "${TEST_DB_NAME}"`);
      console.log(`[harness] Database "${TEST_DB_NAME}" created.`);
    } else {
      console.log(`[harness] Database "${TEST_DB_NAME}" already exists.`);
    }
  } finally {
    await adminPool.end();
  }
}

async function loadSchema(): Promise<void> {
  const schemaPath = resolve(__dirname, "../../src/db/schema.sql");
  const sql = readFileSync(schemaPath, "utf-8");
  const testPool = new Pool({ connectionString: process.env.DATABASE_URL!, max: 1 });
  try {
    const client = await testPool.connect();
    try {
      await client.query(sql);
      console.log(`[harness] Schema loaded into "${TEST_DB_NAME}".`);
    } finally {
      client.release();
    }
  } finally {
    await testPool.end();
  }
}

/**
 * Run once on vitest startup (via setupFiles in vitest.config.ts).
 */
export async function setupTestDatabase(): Promise<void> {
  console.log(`[harness] Initializing test database...`);
  await ensureTestDb();
  await loadSchema();
  console.log(`[harness] Test database ready.`);
}

// ── Per-test helpers ──────────────────────────────────────────────────────────

let _testPool: Pool | null = null;

function getTestPool(): Pool {
  if (!_testPool) {
    _testPool = new Pool({ connectionString: process.env.DATABASE_URL! });
  }
  return _testPool;
}

export async function closeTestPool(): Promise<void> {
  if (_testPool) {
    await _testPool.end();
    _testPool = null;
  }
}

/**
 * TRUNCATE CASCADE all app tables in dependency order.
 * Commits immediately so subsequent reads see the empty state.
 *
 * Usage: call in beforeEach to reset state between tests.
 *
 * NOTE: TRUNCATE commits even inside an explicit transaction block
 * in PostgreSQL (it cannot be rolled back).  This is why we open a
 * dedicated short-lived client just for the truncate, then close it
 * before running the test body.
 */
export async function truncateTables(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL!, max: 1 });
  try {
    const client = await pool.connect();
    try {
      // TRUNCATE in reverse FK-dependency order; CASCADE handles children
      await client.query(`
        TRUNCATE TABLE
          feedback_events,
          execution_results,
          task_traces,
          task_summaries,
          tasks,
          memory_entries,
          behavioral_memories,
          growth_milestones,
          sessions,
          identity_memories,
          decision_logs
        CASCADE;
      `);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

/**
 * Reset the app pool in-place using connection.ts#resetPool().
 * Call in beforeEach (after truncateTables) to guarantee a clean connection
 * state when switching between integration test files that share the same
 * module-level pool.
 */
export async function resetAppPool(): Promise<void> {
  const { resetPool } = await import("../../src/db/connection.js");
  await resetPool();
}

/**
 * Run fn() inside a BEGIN...ROLLBACK transaction on a dedicated client.
 * All writes performed by fn (via the app's query() helper) are rolled back.
 *
 * NOTE: The app's query() uses a SHARED pool — each call may grab any
 * available connection from that pool.  If the app issues MULTIPLE queries
 * within fn, they will NOT share the same transaction unless they happen
 * to be assigned the same physical connection from the pool (non-deterministic).
 *
 * Prefer truncateTables() for isolation; use withTxClient() only when
 * you specifically need to verify that multiple writes are visible to each
 * other within the same test (use withTxClient instead, passing the client
 * explicitly to all DB operations).
 */
export async function withTx<T>(fn: () => Promise<T>): Promise<T> {
  const pool = getTestPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn();
    await client.query("ROLLBACK");
    return result;
  } finally {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    client.release();
  }
}

/**
 * Run fn(client) inside BEGIN...ROLLBACK, passing the dedicated client to fn.
 * Only use this when fn explicitly routes all DB calls through `client`.
 * The app's ExecutionResultRepo will NOT use this client (it uses the shared pool).
 */
export async function withTxClient<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const pool = getTestPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("ROLLBACK");
    return result;
  } finally {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    client.release();
  }
}
