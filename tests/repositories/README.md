# Repository Integration Tests — Infrastructure Notes

## Overview

Repo integration tests validate real SQL contracts against `smartrouter_test` PostgreSQL database. No mocking of `pg.Pool` or repository code.

## Running Tests

```bash
# Main suite (mock-only tests, no DB access)
npm run test:run

# Repo integration tests (each file = separate process)
npm run test:repos

# Full suite
npm run test:run && npm run test:repos
```

## Why Each Repo Test File Must Run in Its Own Process

### The Problem

`src/db/connection.ts` holds a **module-level** `pg.Pool` instance:

```typescript
let _pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!_pool) { _pool = makePool(); }
  return _pool;
}
```

vitest **caches modules across test files within the same worker**. If two repo test files run in the same vitest worker:

1. `execution-result-repo.test.ts` runs first → triggers `getPool()` → creates pool pointing at `smartrouter_test`
2. `task-repo.test.ts` runs in the same worker → its `beforeEach` calls `truncateTables()`
3. `truncateTables()` uses its **own** dedicated short-lived `Pool` → `TRUNCATE` commits
4. `task-repo.test.ts` now calls `TaskRepo.create()` → `TaskRepo` uses `connection.ts`'s `getPool()`
5. **But** `connection.ts`'s `_pool` was created in worker context where `process.env.DATABASE_URL` may not have propagated correctly → pool may point at wrong DB → read returns nothing

The root cause: **multiple modules (`connection.ts` pool, `TaskRepo`, `ExecutionResultRepo`) are all initialized lazily, and the order of lazy initialization + pool state is non-deterministic across files in the same worker.**

### The Solution

Each repo test file runs in a **completely separate Node.js process**:

```
vitest --config vitest.repo.config.ts  tests/repositories/execution-result-repo.test.ts
     → separate Node process, fresh module cache, fresh pool
vitest --config vitest.repo.config.ts  tests/repositories/task-repo.test.ts
     → separate Node process, fresh module cache, fresh pool
```

This is orchestrated in `package.json`:

```json
"test:repos": "npx vitest run --config vitest.repo.config.ts tests/repositories/execution-result-repo.test.ts && npx vitest run --config vitest.repo.config.ts tests/repositories/task-repo.test.ts"
```

### Why `vitest.repo.config.ts` Exists

`vitest.repo.config.ts` is a minimal config **without `globalSetup`/`globalTeardown`** (which manage the container lifecycle). Repo tests use the **already-running** container from when `docker compose up -d` was executed. Only the test DB must exist.

## Test Files

| File | Coverage | Commit |
|---|---|---|
| `execution-result-repo.test.ts` | ExecutionResultRepo 17 cases | IT-001 |
| `task-repo.test.ts` | TaskRepo 26 cases | IT-002 |
| `memory-entry-repo.test.ts` | MemoryEntryRepo 28 cases | IT-003 |
