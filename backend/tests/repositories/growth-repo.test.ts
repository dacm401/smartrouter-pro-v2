/**
 * IT-004: GrowthRepo Integration Tests — Sprint 11
 *
 * Validates real SQL contracts for:
 *   - getProfile()    → aggregates across decision_logs, behavioral_memories,
 *                       growth_milestones; applies GROWTH_LEVELS ladder
 *   - addMilestone()  → inserts into growth_milestones, visible in getProfile
 *
 * Infrastructure: tests/db/harness.ts
 *   Setup:  DATABASE_URL → smartrouter_test (vitest env)
 *   Schema: CREATE TABLE IF NOT EXISTS on startup (idempotent)
 *   Isolation: beforeEach → truncateTables() → COMMIT
 *
 * Seed strategy:
 *   - decision_logs is seeded via raw query (DecisionRepo.save has a
 *     complex payload; raw INSERT is cleaner for test fixtures)
 *   - behavioral_memories seeded via MemoryRepo.saveBehavioralMemory
 *   - growth_milestones seeded via GrowthRepo.addMilestone
 */

import { v4 as uuid } from "uuid";
import { GrowthRepo, DecisionRepo, MemoryRepo } from "../../src/db/repositories.js";
import { truncateTables } from "../db/harness.js";
import { query } from "../../src/db/connection.js";
import { GROWTH_LEVELS } from "../../src/config.js";

// ── Seed helpers ──────────────────────────────────────────────────────────────

/**
 * Insert a minimal decision_log row. Only fills required + commonly-used cols.
 * cost_saved_vs_slow is used by getProfile's total_saved_usd calculation.
 */
async function seedDecision(opts: {
  userId: string;
  sessionId?: string;
  selectedRole?: "fast" | "slow";
  didFallback?: boolean;
  totalCostUsd?: number;
  costSavedVsSlow?: number;
  feedbackScore?: number | null;
  routingCorrect?: boolean | null;
}): Promise<string> {
  const id = uuid();
  const sessionId = opts.sessionId ?? uuid();
  await query(
    `INSERT INTO decision_logs (
      id, user_id, session_id, query_preview, intent, complexity_score,
      input_token_count, has_code, has_math,
      router_version, fast_score, slow_score, confidence,
      selected_model, selected_role, selection_reason,
      context_original_tokens, context_compressed_tokens,
      compression_level, compression_ratio,
      model_used, exec_input_tokens, exec_output_tokens,
      total_cost_usd, latency_ms, did_fallback,
      cost_saved_vs_slow, feedback_score, routing_correct
    ) VALUES (
      $1,$2,$3,'test query','simple_qa',2,
      50,false,false,
      'v1',0.8,0.3,0.9,
      'gpt-4o-mini',$4,'score_above_threshold',
      100,80,'med',0.8,
      'gpt-4o-mini',40,20,
      $5,$6,$7,
      $8,$9,$10
    )`,
    [
      id, opts.userId, sessionId,
      opts.selectedRole ?? "fast",
      opts.totalCostUsd ?? 0.001,
      120,
      opts.didFallback ?? false,
      opts.costSavedVsSlow ?? 0.002,
      opts.feedbackScore ?? null,
      opts.routingCorrect ?? null,
    ]
  );
  return id;
}

// ── Test suites ───────────────────────────────────────────────────────────────

const USER = uuid();

beforeEach(async () => {
  await truncateTables();
});

// ── getProfile() — empty state ────────────────────────────────────────────────

describe("getProfile() — empty state", () => {
  it("returns a valid GrowthProfile when no data exists", async () => {
    const profile = await GrowthRepo.getProfile(USER);

    expect(profile.user_id).toBe(USER);
    expect(profile.total_interactions).toBe(0);
    expect(profile.level).toBe(1);
    expect(profile.level_name).toBe(GROWTH_LEVELS[0].name);
    expect(profile.level_progress).toBeGreaterThanOrEqual(0);
    expect(profile.behavioral_memories_count).toBe(0);
    expect(profile.milestones).toEqual([]);
    expect(profile.recent_learnings).toEqual([]);
    expect(profile.routing_accuracy_history).toEqual([]);
    expect(profile.routing_accuracy).toBe(0);
  });

  it("returns level 1 '初次见面' for 0 interactions", async () => {
    const profile = await GrowthRepo.getProfile(USER);
    expect(profile.level).toBe(1);
    expect(profile.level_name).toBe("初次见面");
  });

  it("satisfaction_rate is 0 when no feedback exists", async () => {
    const profile = await GrowthRepo.getProfile(USER);
    expect(profile.satisfaction_rate).toBe(0);
  });

  it("total_saved_usd is 0 when no decision_logs", async () => {
    const profile = await GrowthRepo.getProfile(USER);
    expect(profile.total_saved_usd).toBe(0);
  });
});

// ── getProfile() — level ladder ───────────────────────────────────────────────

describe("getProfile() — GROWTH_LEVELS ladder", () => {
  it("advances to level 2 at 20 interactions", async () => {
    for (let i = 0; i < 20; i++) await seedDecision({ userId: USER });
    const profile = await GrowthRepo.getProfile(USER);
    expect(profile.level).toBe(2);
    expect(profile.level_name).toBe("开始了解");
  });

  it("advances to level 3 at 50 interactions", async () => {
    for (let i = 0; i < 50; i++) await seedDecision({ userId: USER });
    const profile = await GrowthRepo.getProfile(USER);
    expect(profile.level).toBe(3);
    expect(profile.level_name).toBe("逐渐熟悉");
  });

  it("level_progress is 0 at exactly min_interactions boundary", async () => {
    // At exactly 20 interactions, progress toward level 3 (min 50) is 0%
    for (let i = 0; i < 20; i++) await seedDecision({ userId: USER });
    const profile = await GrowthRepo.getProfile(USER);
    expect(profile.level).toBe(2);
    expect(profile.level_progress).toBe(0);
  });

  it("level_progress reflects correct fraction within a level range", async () => {
    // Level 2 is min=20, Level 3 is min=50 → range is 30
    // At 35 interactions (15 above level 2 floor): progress = round(15/30*100) = 50
    for (let i = 0; i < 35; i++) await seedDecision({ userId: USER });
    const profile = await GrowthRepo.getProfile(USER);
    expect(profile.level).toBe(2);
    expect(profile.level_progress).toBe(50);
  });

  it("counts only the target user's interactions (cross-user isolation)", async () => {
    const OTHER = uuid();
    // OTHER gets 20 interactions (reaches level 2)
    for (let i = 0; i < 20; i++) await seedDecision({ userId: OTHER });
    // USER gets only 5 → stays level 1
    for (let i = 0; i < 5; i++) await seedDecision({ userId: USER });

    const userProfile = await GrowthRepo.getProfile(USER);
    expect(userProfile.level).toBe(1);
    expect(userProfile.total_interactions).toBe(5);

    const otherProfile = await GrowthRepo.getProfile(OTHER);
    expect(otherProfile.level).toBe(2);
    expect(otherProfile.total_interactions).toBe(20);
  });
});

// ── getProfile() — cost / savings ────────────────────────────────────────────

describe("getProfile() — cost and savings", () => {
  it("total_saved_usd aggregates cost_saved_vs_slow across all decision_logs", async () => {
    await seedDecision({ userId: USER, costSavedVsSlow: 0.01 });
    await seedDecision({ userId: USER, costSavedVsSlow: 0.02 });
    await seedDecision({ userId: USER, costSavedVsSlow: 0.03 });

    const profile = await GrowthRepo.getProfile(USER);
    expect(profile.total_saved_usd).toBeCloseTo(0.06, 4);
  });

  it("total_saved_usd does not include other users' savings", async () => {
    const OTHER = uuid();
    await seedDecision({ userId: OTHER, costSavedVsSlow: 1.0 });
    await seedDecision({ userId: USER, costSavedVsSlow: 0.005 });

    const profile = await GrowthRepo.getProfile(USER);
    expect(profile.total_saved_usd).toBeCloseTo(0.005, 5);
  });
});

// ── getProfile() — behavioral_memories ───────────────────────────────────────

describe("getProfile() — behavioral_memories_count", () => {
  it("counts behavioral memories for the user", async () => {
    const mem1 = {
      id: uuid(), user_id: USER,
      trigger_pattern: "when user asks about code",
      observation: "user prefers TypeScript",
      learned_action: "suggest TypeScript",
      strength: 0.8,
      reinforcement_count: 3,
      last_activated: Date.now(),
      source_decision_ids: [],
      created_at: Date.now(),
    };
    const mem2 = {
      id: uuid(), user_id: USER,
      trigger_pattern: "when user asks about style",
      observation: "user likes concise answers",
      learned_action: "be concise",
      strength: 0.6,
      reinforcement_count: 2,
      last_activated: Date.now(),
      source_decision_ids: [],
      created_at: Date.now(),
    };
    await MemoryRepo.saveBehavioralMemory(mem1);
    await MemoryRepo.saveBehavioralMemory(mem2);

    const profile = await GrowthRepo.getProfile(USER);
    expect(profile.behavioral_memories_count).toBe(2);
  });

  it("behavioral_memories_count is 0 with no memories", async () => {
    const profile = await GrowthRepo.getProfile(USER);
    expect(profile.behavioral_memories_count).toBe(0);
  });

  it("recent_learnings contains up to 5 most recent observations", async () => {
    for (let i = 0; i < 7; i++) {
      await MemoryRepo.saveBehavioralMemory({
        id: uuid(), user_id: USER,
        trigger_pattern: `pattern-${i}`,
        observation: `observation-${i}`,
        learned_action: `action-${i}`,
        strength: 0.5,
        reinforcement_count: 1,
        last_activated: Date.now() + i * 1000,
        source_decision_ids: [],
        created_at: Date.now() + i * 1000,
      });
    }
    const profile = await GrowthRepo.getProfile(USER);
    // capped at 5
    expect(profile.recent_learnings.length).toBeLessThanOrEqual(5);
    // each entry has date and learning fields
    profile.recent_learnings.forEach((l) => {
      expect(l).toHaveProperty("date");
      expect(l).toHaveProperty("learning");
      expect(typeof l.learning).toBe("string");
    });
  });
});

// ── getProfile() — milestones ─────────────────────────────────────────────────

describe("getProfile() — milestones", () => {
  it("milestones is empty when none exist", async () => {
    const profile = await GrowthRepo.getProfile(USER);
    expect(profile.milestones).toEqual([]);
  });

  it("milestones reflect addMilestone inserts", async () => {
    await GrowthRepo.addMilestone(USER, "level_up", "Reached level 2", 20);
    const profile = await GrowthRepo.getProfile(USER);

    expect(profile.milestones.length).toBe(1);
    expect(profile.milestones[0].event).toBe("Reached level 2");
    expect(profile.milestones[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("milestones are ordered by created_at DESC", async () => {
    await GrowthRepo.addMilestone(USER, "first_interaction", "First chat", 1);
    // Small sleep to guarantee different created_at timestamps
    await new Promise((r) => setTimeout(r, 10));
    await GrowthRepo.addMilestone(USER, "level_up", "Reached level 2", 20);

    const profile = await GrowthRepo.getProfile(USER);
    expect(profile.milestones.length).toBe(2);
    // Most recent first
    expect(profile.milestones[0].event).toBe("Reached level 2");
    expect(profile.milestones[1].event).toBe("First chat");
  });

  it("milestones capped at 10 most recent", async () => {
    for (let i = 0; i < 12; i++) {
      await GrowthRepo.addMilestone(USER, "test", `milestone-${i}`, i);
      await new Promise((r) => setTimeout(r, 5));
    }
    const profile = await GrowthRepo.getProfile(USER);
    expect(profile.milestones.length).toBeLessThanOrEqual(10);
  });

  it("milestones are user-isolated", async () => {
    const OTHER = uuid();
    await GrowthRepo.addMilestone(OTHER, "level_up", "Other user milestone", 20);

    const profile = await GrowthRepo.getProfile(USER);
    expect(profile.milestones).toEqual([]);
  });
});

// ── addMilestone() ────────────────────────────────────────────────────────────

describe("addMilestone()", () => {
  it("inserts a milestone with all provided fields", async () => {
    await GrowthRepo.addMilestone(USER, "cost_saved", "Saved $1", 1.0);

    const result = await query(
      `SELECT * FROM growth_milestones WHERE user_id=$1`,
      [USER]
    );
    expect(result.rows.length).toBe(1);
    const row = result.rows[0];
    expect(row.user_id).toBe(USER);
    expect(row.milestone_type).toBe("cost_saved");
    expect(row.title).toBe("Saved $1");
    expect(parseFloat(row.metric_value)).toBeCloseTo(1.0, 4);
  });

  it("inserts a milestone with null metric_value when not provided", async () => {
    await GrowthRepo.addMilestone(USER, "first_interaction", "First chat");

    const result = await query(
      `SELECT metric_value FROM growth_milestones WHERE user_id=$1`,
      [USER]
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].metric_value).toBeNull();
  });

  it("generates a unique id for each milestone", async () => {
    await GrowthRepo.addMilestone(USER, "type_a", "Milestone A");
    await GrowthRepo.addMilestone(USER, "type_b", "Milestone B");

    const result = await query(
      `SELECT id FROM growth_milestones WHERE user_id=$1 ORDER BY created_at`,
      [USER]
    );
    expect(result.rows.length).toBe(2);
    expect(result.rows[0].id).not.toBe(result.rows[1].id);
  });
});

// ── GrowthProfile shape ───────────────────────────────────────────────────────

describe("GrowthProfile — shape invariants", () => {
  it("routing_accuracy_history entries have {date, value} shape", async () => {
    // Insert a decision today so routing_accuracy_history has ≥1 entry
    await seedDecision({ userId: USER, routingCorrect: true });

    const profile = await GrowthRepo.getProfile(USER);
    profile.routing_accuracy_history.forEach((entry) => {
      expect(entry).toHaveProperty("date");
      expect(entry).toHaveProperty("value");
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof entry.value).toBe("number");
    });
  });

  it("routing_accuracy is the last value from routing_accuracy_history", async () => {
    await seedDecision({ userId: USER, routingCorrect: true });

    const profile = await GrowthRepo.getProfile(USER);
    if (profile.routing_accuracy_history.length > 0) {
      const last = profile.routing_accuracy_history[profile.routing_accuracy_history.length - 1];
      expect(profile.routing_accuracy).toBe(last.value);
    } else {
      expect(profile.routing_accuracy).toBe(0);
    }
  });

  it("all numeric fields are numbers (not strings)", async () => {
    await seedDecision({ userId: USER });
    const profile = await GrowthRepo.getProfile(USER);

    expect(typeof profile.level).toBe("number");
    expect(typeof profile.level_progress).toBe("number");
    expect(typeof profile.routing_accuracy).toBe("number");
    expect(typeof profile.cost_saving_rate).toBe("number");
    expect(typeof profile.total_saved_usd).toBe("number");
    expect(typeof profile.satisfaction_rate).toBe("number");
    expect(typeof profile.total_interactions).toBe("number");
    expect(typeof profile.behavioral_memories_count).toBe("number");
  });
});
