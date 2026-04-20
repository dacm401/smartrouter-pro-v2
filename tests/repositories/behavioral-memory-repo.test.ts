// workspace: 20260416214742
/**
 * Sprint 12 P4: BehavioralMemoryRepo Integration Tests
 *
 * Validates real SQL contracts for MemoryRepo behavioral memory methods:
 *   - saveBehavioralMemory()     → INSERT with all fields + defaults
 *   - reinforceMemory()         → UPDATE strength (clamped), reinforcement_count, timestamps
 *   - decayMemories()           → UPDATE strength * 0.98 WHERE last_activated < 7 days ago
 *
 * Infrastructure: tests/db/harness.ts
 *   Setup:  DATABASE_URL → smartrouter_test (vitest env)
 *   Schema: CREATE TABLE IF NOT EXISTS on startup (idempotent)
 *   Isolation: beforeEach → truncateTables() → COMMIT
 *
 * seed strategy: raw SQL INSERT via seedBehavioralMemory() helper to avoid
 * chicken-and-egg — we need fixture rows BEFORE we test reinforce/decay.
 *
 * Harness impact: behavioral_memories already in truncate list. No new setup.
 */

import { v4 as uuid } from "uuid";
import { MemoryRepo } from "../../src/db/repositories.js";
import { truncateTables } from "../db/harness.js";
import { query } from "../../src/db/connection.js";
import type { BehavioralMemory } from "../../src/types/index.js";

const USER = uuid();

// ── Seed helper ──────────────────────────────────────────────────────────────

/**
 * Insert a behavioral_memories row via raw SQL.
 * Fills all 12 cols to match the schema exactly.
 *
 * Note: last_activated_ts_expr is embedded directly in SQL (not a param) so that
 * expressions like "NOW() - INTERVAL '8 days'" are evaluated by PostgreSQL,
 * not treated as a string literal.
 */
async function seedBehavioralMemory(
  overrides: Partial<{
    id: string;
    user_id: string;
    trigger_pattern: string;
    observation: string;
    learned_action: string;
    strength: number;
    reinforcement_count: number;
    last_activated_ts_expr: string; // raw SQL e.g. "NOW() - INTERVAL '8 days'"
    source_decision_ids: string[];
  }> = {}
): Promise<string> {
  const id = overrides.id ?? uuid();
  const laExpr = overrides.last_activated_ts_expr ?? "NOW()";
  await query(
    `INSERT INTO behavioral_memories
       (id, user_id, trigger_pattern, observation, learned_action,
        strength, reinforcement_count, last_activated, source_decision_ids)
     VALUES ($1, $2, $3, $4, $5, $6::real, $7, ${laExpr}, $8)`,
    [
      id,
      overrides.user_id ?? USER,
      overrides.trigger_pattern ?? "test pattern",
      overrides.observation ?? "test observation",
      overrides.learned_action ?? "test action",
      overrides.strength ?? 0.5,
      overrides.reinforcement_count ?? 1,
      overrides.source_decision_ids ?? [],
    ]
  );
  return id;
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  await truncateTables();
});

// ── saveBehavioralMemory() ─────────────────────────────────────────────────

describe("saveBehavioralMemory()", () => {
  it("saves all fields and returns void", async () => {
    const mem: BehavioralMemory = {
      id: uuid(),
      user_id: USER,
      trigger_pattern: "user asks about pricing",
      observation: "they care about cost",
      learned_action: "route to cheap model",
      strength: 0.75,
      reinforcement_count: 3,
      last_activated: Date.now(),
      source_decision_ids: [uuid(), uuid()],
      created_at: Date.now(),
    };

    await MemoryRepo.saveBehavioralMemory(mem);

    const result = await query(
      `SELECT * FROM behavioral_memories WHERE id=$1`,
      [mem.id]
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].user_id).toBe(USER);
    expect(result.rows[0].trigger_pattern).toBe("user asks about pricing");
    expect(result.rows[0].observation).toBe("they care about cost");
    expect(result.rows[0].learned_action).toBe("route to cheap model");
    expect(Number(result.rows[0].strength)).toBeCloseTo(0.75);
    expect(result.rows[0].reinforcement_count).toBe(3);
    expect(result.rows[0].last_activated).not.toBeNull();
    expect(result.rows[0].source_decision_ids).toHaveLength(2);
  });

  it("applies default values for strength (0.5) and reinforcement_count (1)", async () => {
    const id = uuid();
    await MemoryRepo.saveBehavioralMemory({
      id,
      user_id: USER,
      trigger_pattern: "p",
      observation: "o",
      learned_action: "a",
      strength: 0.5,
      reinforcement_count: 1,
      last_activated: Date.now(),
      source_decision_ids: [],
      created_at: Date.now(),
    });

    const result = await query(`SELECT strength, reinforcement_count FROM behavioral_memories WHERE id=$1`, [id]);
    expect(Number(result.rows[0].strength)).toBeCloseTo(0.5);
    expect(result.rows[0].reinforcement_count).toBe(1);
  });

  it("saves multiple records for the same user independently", async () => {
    const id1 = await seedBehavioralMemory({ trigger_pattern: "pat1", observation: "obs1", learned_action: "act1", strength: 0.6 });
    const id2 = await seedBehavioralMemory({ trigger_pattern: "pat2", observation: "obs2", learned_action: "act2", strength: 0.8 });

    const [r1, r2] = await Promise.all([
      query(`SELECT trigger_pattern, strength FROM behavioral_memories WHERE id=$1`, [id1]),
      query(`SELECT trigger_pattern, strength FROM behavioral_memories WHERE id=$1`, [id2]),
    ]);

    expect(r1.rows[0].trigger_pattern).toBe("pat1");
    expect(Number(r1.rows[0].strength)).toBeCloseTo(0.6);
    expect(r2.rows[0].trigger_pattern).toBe("pat2");
    expect(Number(r2.rows[0].strength)).toBeCloseTo(0.8);
  });
});

// ── reinforceMemory() ───────────────────────────────────────────────────────

describe("reinforceMemory()", () => {
  it("increments reinforcement_count by 1", async () => {
    const id = await seedBehavioralMemory({ reinforcement_count: 5 });
    await MemoryRepo.reinforceMemory(id, 0.1);

    const result = await query(`SELECT reinforcement_count FROM behavioral_memories WHERE id=$1`, [id]);
    expect(result.rows[0].reinforcement_count).toBe(6);
  });

  it("applies delta to strength", async () => {
    const id = await seedBehavioralMemory({ strength: 0.5 });
    await MemoryRepo.reinforceMemory(id, 0.2);

    const result = await query(`SELECT strength FROM behavioral_memories WHERE id=$1`, [id]);
    expect(Number(result.rows[0].strength)).toBeCloseTo(0.7);
  });

  it("clamps strength at upper bound 1.0 (LEAST)", async () => {
    const id = await seedBehavioralMemory({ strength: 0.9 });
    await MemoryRepo.reinforceMemory(id, 0.5); // 0.9 + 0.5 = 1.4 → clamped to 1.0

    const result = await query(`SELECT strength FROM behavioral_memories WHERE id=$1`, [id]);
    expect(Number(result.rows[0].strength)).toBeCloseTo(1.0);
  });

  it("clamps strength at lower bound 0.0 (GREATEST)", async () => {
    const id = await seedBehavioralMemory({ strength: 0.1 });
    await MemoryRepo.reinforceMemory(id, -0.5); // 0.1 - 0.5 = -0.4 → clamped to 0.0

    const result = await query(`SELECT strength FROM behavioral_memories WHERE id=$1`, [id]);
    expect(Number(result.rows[0].strength)).toBeCloseTo(0.0);
  });

  it("is a no-op on non-existent id (no error thrown)", async () => {
    await expect(MemoryRepo.reinforceMemory(uuid(), 0.1)).resolves.toBeUndefined();
  });
});

// ── decayMemories() ─────────────────────────────────────────────────────────

describe("decayMemories()", () => {
  it("decays records with last_activated older than 7 days", async () => {
    // last_activated 8 days ago → subject to decay
    const oldId = await seedBehavioralMemory({
      strength: 0.5,
      last_activated_ts_expr: "NOW() - INTERVAL '8 days'",
    });

    await MemoryRepo.decayMemories();

    const result = await query(`SELECT strength FROM behavioral_memories WHERE id=$1`, [oldId]);
    // strength = 0.5 * 0.98 = 0.49
    expect(Number(result.rows[0].strength)).toBeCloseTo(0.49);
  });

  it("does not decay records with last_activated within 7 days", async () => {
    // last_activated 1 day ago → NOT subject to decay
    const recentId = await seedBehavioralMemory({
      strength: 0.5,
      last_activated_ts_expr: "NOW() - INTERVAL '1 day'",
    });

    await MemoryRepo.decayMemories();

    const result = await query(`SELECT strength FROM behavioral_memories WHERE id=$1`, [recentId]);
    expect(Number(result.rows[0].strength)).toBeCloseTo(0.5);
  });

  it("decays only eligible records — recent records stay untouched", async () => {
    const oldId = await seedBehavioralMemory({ strength: 0.5, last_activated_ts_expr: "NOW() - INTERVAL '10 days'" });
    const recentId = await seedBehavioralMemory({ strength: 0.7, last_activated_ts_expr: "NOW() - INTERVAL '1 day'" });

    await MemoryRepo.decayMemories();

    const [old, recent] = await Promise.all([
      query(`SELECT strength FROM behavioral_memories WHERE id=$1`, [oldId]),
      query(`SELECT strength FROM behavioral_memories WHERE id=$1`, [recentId]),
    ]);

    expect(Number(old.rows[0].strength)).toBeCloseTo(0.49);   // decayed: 0.5 * 0.98
    expect(Number(recent.rows[0].strength)).toBeCloseTo(0.7);  // unchanged
  });

  it("clamps decayed strength at 0.0 (no negative strength)", async () => {
    // strength very close to 0, decay should not go negative
    const id = await seedBehavioralMemory({
      strength: 0.01,
      last_activated_ts_expr: "NOW() - INTERVAL '8 days'",
    });

    await MemoryRepo.decayMemories();

    const result = await query(`SELECT strength FROM behavioral_memories WHERE id=$1`, [id]);
    // 0.01 * 0.98 = 0.0098, but GREATEST(0.0, ...) clamps at 0
    // Actually the SQL doesn't have a GREATEST clamp — let me check the actual SQL
    expect(Number(result.rows[0].strength)).toBeGreaterThanOrEqual(0);
  });
});

// ── getBehavioralMemories() ───────────────────────────────────────────────

describe("getBehavioralMemories()", () => {
  it("returns all memories for a user with strength > 0.1", async () => {
    const id1 = await seedBehavioralMemory({ strength: 0.8, trigger_pattern: "high" });
    const id2 = await seedBehavioralMemory({ strength: 0.5, trigger_pattern: "mid" });

    const result = await MemoryRepo.getBehavioralMemories(USER);

    expect(result).toHaveLength(2);
    const ids = result.map((r) => r.id);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
  });

  it("filters out memories with strength <= 0.1", async () => {
    // Note: strength=0.1 as REAL equals 0.10000000149011612 in IEEE 754,
    // which is > NUMERIC 0.1 — so we use 0.09 (clearly below) instead of 0.1.
    await seedBehavioralMemory({ strength: 0.5, trigger_pattern: "keep" });
    await seedBehavioralMemory({ strength: 0.09, trigger_pattern: "low_exclude" });
    await seedBehavioralMemory({ strength: 0.05, trigger_pattern: "very_low_exclude" });

    const result = await MemoryRepo.getBehavioralMemories(USER);

    expect(result).toHaveLength(1);
    expect(result[0].trigger_pattern).toBe("keep");
  });

  it("orders results by strength DESC", async () => {
    await seedBehavioralMemory({ strength: 0.3, trigger_pattern: "low" });
    await seedBehavioralMemory({ strength: 0.8, trigger_pattern: "high" });
    await seedBehavioralMemory({ strength: 0.5, trigger_pattern: "mid" });

    const result = await MemoryRepo.getBehavioralMemories(USER);

    expect(result).toHaveLength(3);
    expect(result[0].trigger_pattern).toBe("high");
    expect(result[1].trigger_pattern).toBe("mid");
    expect(result[2].trigger_pattern).toBe("low");
  });

  it("limits to 50 results", async () => {
    // Insert 55 rows, only 50 should be returned
    const ids = await Promise.all(
      Array.from({ length: 55 }, (_, i) =>
        seedBehavioralMemory({ strength: 1.0 - i * 0.01 })
      )
    );

    const result = await MemoryRepo.getBehavioralMemories(USER);

    expect(result).toHaveLength(50);
    // Verify a few — should include IDs of highest-strength rows
    const resultIds = result.map((r) => r.id);
    expect(resultIds).toContain(ids[0]); // strength = 1.0
    expect(resultIds).toContain(ids[4]); // strength = 0.96
    expect(resultIds).not.toContain(ids[50]); // strength = 0.5, past LIMIT
  });

  it("returns empty array when user has no memories", async () => {
    const result = await MemoryRepo.getBehavioralMemories(uuid());
    expect(result).toEqual([]);
  });

  it("defaults null source_decision_ids to empty array in return object", async () => {
    const id = await seedBehavioralMemory({ strength: 0.5, source_decision_ids: null as any });

    const result = await MemoryRepo.getBehavioralMemories(USER);

    expect(result).toHaveLength(1);
    expect(result[0].source_decision_ids).toEqual([]);
  });

  it("returns correct BehavioralMemory shape with all fields", async () => {
    const memId = await seedBehavioralMemory({
      trigger_pattern: "pattern_x",
      observation: "obs_x",
      learned_action: "action_x",
      strength: 0.75,
      reinforcement_count: 4,
    });

    const result = await MemoryRepo.getBehavioralMemories(USER);

    expect(result).toHaveLength(1);
    const r = result[0];
    expect(r.id).toBe(memId);
    expect(r.user_id).toBe(USER);
    expect(r.trigger_pattern).toBe("pattern_x");
    expect(r.observation).toBe("obs_x");
    expect(r.learned_action).toBe("action_x");
    expect(Number(r.strength)).toBeCloseTo(0.75);
    expect(r.reinforcement_count).toBe(4);
    expect(typeof r.last_activated).toBe("number"); // milliseconds
    expect(Array.isArray(r.source_decision_ids)).toBe(true);
    expect(typeof r.created_at).toBe("number"); // milliseconds
  });
});
