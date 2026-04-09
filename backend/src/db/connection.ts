import pg from "pg";
import { config } from "../config.js";

const { Pool } = pg;

/** Always read DATABASE_URL fresh — safe for vitest where env is set before pool use. */
function makePool(): pg.Pool {
  const url = process.env.DATABASE_URL ?? config.databaseUrl;
  const p = new Pool({ connectionString: url, max: 20, idleTimeoutMillis: 30000 });
  p.on("error", (err) => {
    console.error("Unexpected database error:", err);
  });
  return p;
}

// Lazy pool — replaced by drainPool() in tests, recreated on next query().
let _pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!_pool) {
    _pool = makePool();
  }
  return _pool;
}

// Backward-compatible accessor.
export const pool = { get value() { return getPool(); } };

/**
 * End the current pool and null it.  Next query() creates a fresh pool.
 */
export async function drainPool(): Promise<void> {
  if (_pool) {
    try { await _pool.end(); } catch { /* ignore */ }
    _pool = null;
  }
}

export async function resetPool(): Promise<void> {
  await drainPool();
}

export async function query(text: string, params?: any[]) {
  const start = Date.now();
  const result = await getPool().query(text, params);
  const duration = Date.now() - start;
  if (duration > 100) {
    console.log(`Slow query (${duration}ms):`, text.substring(0, 80));
  }
  return result;
}
