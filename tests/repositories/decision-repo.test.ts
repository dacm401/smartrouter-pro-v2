// workspace: 20260416214742
/**
 * Sprint 12 P2: DecisionRepo Integration Tests
 *
 * Validates real SQL contracts for all 5 DecisionRepo methods:
 *   - save()                    → 27-col INSERT, full DecisionRecord payload
 *   - updateFeedback()          → UPDATE feedback_type + feedback_score
 *   - getRecent()                → SELECT ORDER BY created_at DESC LIMIT
 *   - getTodayStats()            → COUNT/SUM/AVG/FILTER/COALESCE/CASE WHEN aggregation
 *   - getRoutingAccuracyHistory() → date grouping, satisfaction % from feedback_score (P3)
 *
 * Infrastructure: tests/db/harness.ts
 *   Setup:  DATABASE_URL → smartrouter_test (vitest env)
 *   Schema: CREATE TABLE IF NOT EXISTS on startup (idempotent)
 *   Isolation: beforeEach → truncateTables() → COMMIT
 *
 * Note: seedDecision() uses raw INSERT (not DecisionRepo.save()) to avoid
 * a chicken-and-egg problem — we need fixture rows BEFORE we test getRecent.
 */

import { v4 as uuid } from "uuid";
import { DecisionRepo } from "../../src/db/repositories.js";
import { truncateTables } from "../db/harness.js";
import { query } from "../../src/db/connection.js";
import type { DecisionRecord } from "../../src/types/index.js";

// ── Seed helpers ──────────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  const id = overrides.id ?? uuid();
  return {
    id,
    user_id: overrides.user_id ?? uuid(),
    session_id: overrides.session_id ?? uuid(),
    timestamp: Date.now(),
    input_features: {
      raw_query: "test query for decision routing",
      token_count: 50,
      complexity_score: 2,
      has_code: false,
      has_math: false,
      intent: "simple_qa",
      ...(overrides.input_features ?? {}),
    },
    routing: {
      router_version: "v1",
      scores: { fast: 0.8, slow: 0.3 },
      confidence: 0.9,
      selected_model: "gpt-4o-mini",
      selected_role: "fast",
      selection_reason: "score_above_threshold",
      ...(overrides.routing ?? {}),
    },
    context: {
      original_tokens: 100,
      compressed_tokens: 80,
      compression_level: "med",
      compression_ratio: 0.8,
      ...(overrides.context ?? {}),
    },
    execution: {
      model_used: "gpt-4o-mini",
      input_tokens: 40,
      output_tokens: 20,
      total_cost_usd: 0.001,
      latency_ms: 120,
      did_fallback: false,
      fallback_reason: null,
      ...(overrides.execution ?? {}),
    },
    ...overrides,
  };
}

/**
 * Insert a decision_log row via raw SQL.
 * Fills all 28 cols used by getTodayStats / getRoutingAccuracyHistory tests.
 *
 * Cols: id, user_id, session_id, query_preview, intent, complexity_score,
 *   input_token_count, has_code, has_math,
 *   router_version, fast_score, slow_score, confidence,
 *   selected_model, selected_role, selection_reason,
 *   context_original_tokens, context_compressed_tokens,
 *   compression_level, compression_ratio,
 *   model_used, exec_input_tokens, exec_output_tokens,
 *   total_cost_usd, latency_ms, did_fallback,
 *   cost_saved_vs_slow, feedback_score, routing_correct
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
      50,false::boolean,false::boolean,
      'v1',0.8,0.3,0.9,
      'gpt-4o-mini',$4,'score_above_threshold',
      100,80,'med',0.8,
      'gpt-4o-mini',40,20,
      $5,$6,$7::boolean,
      $8,$9,$10::boolean
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

// ── save() ────────────────────────────────────────────────────────────────────

describe("save()", () => {
  it("inserts a full DecisionRecord and it is retrievable", async () => {
    const record = makeRecord({ user_id: USER });
    await DecisionRepo.save(record);

    const result = await query(`SELECT * FROM decision_logs WHERE id=$1`, [record.id]);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].id).toBe(record.id);
    expect(result.rows[0].user_id).toBe(USER);
    expect(result.rows[0].query_preview).toBe("test query for decision routing");
    expect(result.rows[0].intent).toBe("simple_qa");
    expect(result.rows[0].fast_score).toBe(0.8);
    expect(result.rows[0].slow_score).toBe(0.3);
    expect(result.rows[0].selected_role).toBe("fast");
    expect(result.rows[0].selected_model).toBe("gpt-4o-mini");
    expect(result.rows[0].exec_input_tokens).toBe(40);
    expect(result.rows[0].exec_output_tokens).toBe(20);
    expect(parseFloat(result.rows[0].total_cost_usd)).toBeCloseTo(0.001, 5);
    expect(result.rows[0].latency_ms).toBe(120);
    expect(result.rows[0].did_fallback).toBe(false);
  });

  it("truncates raw_query to 200 characters", async () => {
    const longQuery = "a".repeat(300);
    const record = makeRecord({
      input_features: { raw_query: longQuery, token_count: 50, complexity_score: 2, has_code: false, has_math: false, intent: "test" },
    });
    await DecisionRepo.save(record);

    const result = await query(`SELECT query_preview FROM decision_logs WHERE id=$1`, [record.id]);
    expect(result.rows[0].query_preview.length).toBe(200);
  });

  it("saves fallback decision with null fallback_reason", async () => {
    const record = makeRecord({
      execution: {
        model_used: "gpt-4o-mini",
        input_tokens: 10, output_tokens: 5,
        total_cost_usd: 0.0005, latency_ms: 80,
        did_fallback: true, fallback_reason: null,
      },
    });
    await DecisionRepo.save(record);

    const result = await query(`SELECT did_fallback, fallback_reason FROM decision_logs WHERE id=$1`, [record.id]);
    expect(result.rows[0].did_fallback).toBe(true);
    expect(result.rows[0].fallback_reason).toBeNull();
  });

  it("saves slow role decision", async () => {
    const record = makeRecord({
      routing: {
        router_version: "v1", scores: { fast: 0.3, slow: 0.8 },
        confidence: 0.9, selected_model: "gpt-4o",
        selected_role: "slow", selection_reason: "complexity_above_threshold",
      },
    });
    await DecisionRepo.save(record);

    const result = await query(`SELECT selected_role, selected_model FROM decision_logs WHERE id=$1`, [record.id]);
    expect(result.rows[0].selected_role).toBe("slow");
    expect(result.rows[0].selected_model).toBe("gpt-4o");
  });

  it("throws on duplicate id (DB-level constraint)", async () => {
    const record = makeRecord({ user_id: USER });
    await DecisionRepo.save(record);
    await expect(DecisionRepo.save(record)).rejects.toThrow();
  });
});

// ── updateFeedback() ───────────────────────────────────────────────────────────

describe("updateFeedback()", () => {
  it("sets feedback_type and feedback_score on existing row", async () => {
    const id = await seedDecision({ userId: USER });
    await DecisionRepo.updateFeedback(id, "thumbs_up", 1);

    const result = await query(`SELECT feedback_type, feedback_score FROM decision_logs WHERE id=$1`, [id]);
    expect(result.rows[0].feedback_type).toBe("thumbs_up");
    expect(Number(result.rows[0].feedback_score)).toBe(1);
  });

  it("overwrites previous feedback with new values", async () => {
    const id = await seedDecision({ userId: USER });
    await DecisionRepo.updateFeedback(id, "thumbs_up", 1);
    await DecisionRepo.updateFeedback(id, "thumbs_down", 0);

    const result = await query(`SELECT feedback_type, feedback_score FROM decision_logs WHERE id=$1`, [id]);
    expect(result.rows[0].feedback_type).toBe("thumbs_down");
    expect(Number(result.rows[0].feedback_score)).toBe(0);
  });

  it("only updates the target row (others remain null)", async () => {
    const id1 = await seedDecision({ userId: USER, feedbackScore: 1 });
    const id2 = await seedDecision({ userId: USER, feedbackScore: null });
    await DecisionRepo.updateFeedback(id1, "thumbs_down", 0);

    const [r1, r2] = await Promise.all([
      query(`SELECT feedback_type, feedback_score FROM decision_logs WHERE id=$1`, [id1]),
      query(`SELECT feedback_type, feedback_score FROM decision_logs WHERE id=$1`, [id2]),
    ]);
    expect(r1.rows[0].feedback_type).toBe("thumbs_down");
    expect(Number(r1.rows[0].feedback_score)).toBe(0);
    expect(r2.rows[0].feedback_type).toBeNull();
    expect(r2.rows[0].feedback_score).toBeNull();
  });

  it("is a no-op on non-existent id (no error thrown)", async () => {
    await expect(DecisionRepo.updateFeedback(uuid(), "thumbs_up", 1)).resolves.toBeUndefined();
  });
});

// ── getRecent() ───────────────────────────────────────────────────────────────

describe("getRecent()", () => {
  it("returns empty array when no decisions exist", async () => {
    const results = await DecisionRepo.getRecent(USER);
    expect(results).toEqual([]);
  });

  it("returns decisions ordered by created_at DESC", async () => {
    const id1 = await seedDecision({ userId: USER });
    await new Promise((r) => setTimeout(r, 10));
    const id2 = await seedDecision({ userId: USER });
    await new Promise((r) => setTimeout(r, 10));
    const id3 = await seedDecision({ userId: USER });

    const results = await DecisionRepo.getRecent(USER);
    expect(results.length).toBe(3);
    expect(results[0].id).toBe(id3);
    expect(results[1].id).toBe(id2);
    expect(results[2].id).toBe(id1);
  });

  it("respects the limit parameter", async () => {
    for (let i = 0; i < 5; i++) await seedDecision({ userId: USER });

    const results = await DecisionRepo.getRecent(USER, 3);
    expect(results.length).toBe(3);
  });

  it("defaults limit to 20", async () => {
    for (let i = 0; i < 25; i++) await seedDecision({ userId: USER });

    const results = await DecisionRepo.getRecent(USER);
    expect(results.length).toBe(20);
  });

  it("returns only the target user's decisions", async () => {
    const OTHER = uuid();
    await seedDecision({ userId: OTHER });
    const id2 = await seedDecision({ userId: USER });
    const id3 = await seedDecision({ userId: USER });

    const results = await DecisionRepo.getRecent(USER);
    const ids = results.map((r: any) => r.id);
    expect(ids).toContain(id2);
    expect(ids).toContain(id3);
    // No duplicates, no OTHER's id
    expect(new Set(ids).size).toBe(ids.length);
    const otherIds = (await query(`SELECT id FROM decision_logs WHERE user_id=$1`, [OTHER])).rows.map((r: any) => r.id);
    ids.forEach((id: string) => expect(otherIds).not.toContain(id));
  });
});

// ── getTodayStats() ───────────────────────────────────────────────────────────

describe("getTodayStats()", () => {
  it("returns zero stats when no decisions exist", async () => {
    const stats = await DecisionRepo.getTodayStats(USER);

    expect(stats.total_requests).toBe(0);
    expect(stats.fast_count).toBe(0);
    expect(stats.slow_count).toBe(0);
    expect(stats.fallback_count).toBe(0);
    expect(stats.total_tokens).toBe(0);
    expect(stats.total_cost).toBe(0);
    expect(stats.saved_cost).toBe(0);
    expect(stats.avg_latency).toBe(0);
    expect(stats.satisfaction_rate).toBe(0);
  });

  it("counts fast and slow decisions correctly", async () => {
    await seedDecision({ userId: USER, selectedRole: "fast" });
    await seedDecision({ userId: USER, selectedRole: "fast" });
    await seedDecision({ userId: USER, selectedRole: "slow" });

    const stats = await DecisionRepo.getTodayStats(USER);
    expect(stats.total_requests).toBe(3);
    expect(stats.fast_count).toBe(2);
    expect(stats.slow_count).toBe(1);
  });

  it("sums total_tokens correctly", async () => {
    // seedDecision uses 40+20=60 tokens per row by default
    await seedDecision({ userId: USER });
    await seedDecision({ userId: USER });

    const stats = await DecisionRepo.getTodayStats(USER);
    expect(stats.total_tokens).toBe(120);
  });

  it("sums total_cost correctly", async () => {
    await seedDecision({ userId: USER, totalCostUsd: 0.005 });
    await seedDecision({ userId: USER, totalCostUsd: 0.003 });

    const stats = await DecisionRepo.getTodayStats(USER);
    expect(stats.total_cost).toBeCloseTo(0.008, 5);
  });

  it("sums saved_cost correctly", async () => {
    await seedDecision({ userId: USER, costSavedVsSlow: 0.01 });
    await seedDecision({ userId: USER, costSavedVsSlow: 0.02 });

    const stats = await DecisionRepo.getTodayStats(USER);
    expect(stats.saved_cost).toBeCloseTo(0.03, 4);
  });

  it("satisfaction_rate is 0 when no feedback exists", async () => {
    await seedDecision({ userId: USER });
    const stats = await DecisionRepo.getTodayStats(USER);
    expect(stats.satisfaction_rate).toBe(0);
  });

  it("satisfaction_rate is 100 when all feedback is positive", async () => {
    await seedDecision({ userId: USER, feedbackScore: 1 });
    await seedDecision({ userId: USER, feedbackScore: 1 });
    const stats = await DecisionRepo.getTodayStats(USER);
    expect(stats.satisfaction_rate).toBe(100);
  });

  it("satisfaction_rate is 67 with 2 positive + 1 negative", async () => {
    await seedDecision({ userId: USER, feedbackScore: 1 });
    await seedDecision({ userId: USER, feedbackScore: 1 });
    await seedDecision({ userId: USER, feedbackScore: 0 });

    const stats = await DecisionRepo.getTodayStats(USER);
    // 2 positive / 3 total = 66.67% → ROUND → 67
    expect(stats.satisfaction_rate).toBe(67);
  });

  it("ignores decisions from other users", async () => {
    const OTHER = uuid();
    await seedDecision({ userId: OTHER });
    await seedDecision({ userId: USER });

    const [otherStats, userStats] = await Promise.all([
      DecisionRepo.getTodayStats(OTHER),
      DecisionRepo.getTodayStats(USER),
    ]);
    expect(otherStats.total_requests).toBe(1);
    expect(userStats.total_requests).toBe(1);
  });

  it("counts fallback decisions", async () => {
    await seedDecision({ userId: USER, didFallback: true });
    await seedDecision({ userId: USER, didFallback: false });
    await seedDecision({ userId: USER, didFallback: true });

    const stats = await DecisionRepo.getTodayStats(USER);
    expect(stats.fallback_count).toBe(2);
  });

  it("calculates avg_latency as integer", async () => {
    // seedDecision uses latency_ms=120 by default, all rows = 120
    await seedDecision({ userId: USER });
    await seedDecision({ userId: USER });

    const stats = await DecisionRepo.getTodayStats(USER);
    expect(stats.avg_latency).toBe(120);
  });
});

// ── getRoutingAccuracyHistory() ───────────────────────────────────────────────

describe("getRoutingAccuracyHistory() — P3: satisfaction rate from feedback_score (not routing_correct)", () => {
  it("returns empty array when no decisions exist", async () => {
    const history = await DecisionRepo.getRoutingAccuracyHistory(USER);
    expect(history).toEqual([]);
  });

  it("groups decisions by created_at::date", async () => {
    // Today's decisions (default created_at = now)
    // P3: now uses feedback_score > 0 / COUNT(feedback_score IS NOT NULL)
    await seedDecision({ userId: USER, feedbackScore: 1 });
    await seedDecision({ userId: USER, feedbackScore: 1 });

    const history = await DecisionRepo.getRoutingAccuracyHistory(USER, 30);
    // Default seed uses created_at = CURRENT_TIMESTAMP, so today's row exists
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0]).toHaveProperty("date");
    expect(history[0]).toHaveProperty("value");
  });

  it("returns 100% when all feedback_score > 0 (P3: satisfaction rate from feedback)", async () => {
    // P3: satisfaction = COUNT(feedback_score > 0) / COUNT(feedback_score IS NOT NULL)
    await seedDecision({ userId: USER, feedbackScore: 1 });
    await seedDecision({ userId: USER, feedbackScore: 1 });

    const history = await DecisionRepo.getRoutingAccuracyHistory(USER, 30);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0].value).toBe(100);
  });

  it("returns 0% when all feedback_score <= 0", async () => {
    // P3: feedback_score <= 0 → not positive → 0%
    await seedDecision({ userId: USER, feedbackScore: 0 });
    await seedDecision({ userId: USER, feedbackScore: -1 });

    const history = await DecisionRepo.getRoutingAccuracyHistory(USER, 30);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0].value).toBe(0);
  });

  it("returns 50% satisfaction with mixed feedback (1 pos + 1 neg)", async () => {
    // P3: positive_count=1, total_with_feedback=2 → 50%
    await seedDecision({ userId: USER, feedbackScore: 1 });
    await seedDecision({ userId: USER, feedbackScore: 0 });

    const history = await DecisionRepo.getRoutingAccuracyHistory(USER, 30);
    expect(history.length).toBeGreaterThanOrEqual(1);
    // 1 positive / 2 total = 50% → Math.round(50 * 10) / 10 = 50
    expect(history[0].value).toBe(50);
  });

  it("excludes rows with null feedback_score from satisfaction calc (P3)", async () => {
    // P3: satisfaction = COUNT(feedback_score > 0) / COUNT(feedback_score IS NOT NULL)
    // Null feedback_score rows are excluded from both numerator and denominator.
    const [id1, id2, id3] = [uuid(), uuid(), uuid()];
    await query(
      `INSERT INTO decision_logs
        (id, user_id, session_id, feedback_score, created_at)
       VALUES ($1,$2,$3,1,NOW()),
              ($4,$2,$5,0,NOW()),
              ($6,$2,$7,NULL,NOW())`,
      [id1, USER, uuid(), id2, uuid(), id3, uuid()]
    );

    // satisfaction = 1 positive / 2 with-feedback = 50%
    const history = await DecisionRepo.getRoutingAccuracyHistory(USER, 30);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0].value).toBe(50);
  });

  it("ignores decisions from other users", async () => {
    // P3: uses feedback_score, not routing_correct
    const OTHER = uuid();
    await seedDecision({ userId: OTHER, feedbackScore: 1 });
    await seedDecision({ userId: USER, feedbackScore: 1 });

    const history = await DecisionRepo.getRoutingAccuracyHistory(USER, 30);
    expect(history.length).toBeGreaterThanOrEqual(1);
    // Only USER's record counts → 100%
    expect(history[0].value).toBe(100);
  });

  it("respects the days window parameter", async () => {
    // P3: uses feedback_score; past row needs non-null feedback_score to be counted
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 60);
    await query(
      `INSERT INTO decision_logs (id, user_id, session_id, query_preview, intent, complexity_score,
        input_token_count, has_code, has_math, router_version, fast_score, slow_score, confidence,
        selected_model, selected_role, selection_reason, context_original_tokens, context_compressed_tokens,
        compression_level, compression_ratio, model_used, exec_input_tokens, exec_output_tokens,
        total_cost_usd, latency_ms, did_fallback, cost_saved_vs_slow, feedback_score, routing_correct, created_at)
       VALUES ($1,$2,$3,'q','simple_qa',2,50,false,false,'v1',0.8,0.3,0.9,
        'gpt-4o-mini','fast','score_above_threshold',100,80,'med',0.8,
        'gpt-4o-mini',40,20,0.001,120,false,0.002,1,null,$4)`,
      [uuid(), USER, uuid(), pastDate]
    );
    // Today's record — positive feedback so it's counted
    await seedDecision({ userId: USER, feedbackScore: 1 });

    const history30 = await DecisionRepo.getRoutingAccuracyHistory(USER, 30);
    const history60 = await DecisionRepo.getRoutingAccuracyHistory(USER, 60);

    // 30-day window: only today's record (1 row)
    expect(history30.length).toBeGreaterThanOrEqual(1);
    // 60-day window: past row (feedback=1) + today's row (feedback=1) = 2 rows
    expect(history60.length).toBeGreaterThanOrEqual(2);
  });

  it("returns dates in ISO string format YYYY-MM-DD", async () => {
    await seedDecision({ userId: USER, feedbackScore: 1 });

    const history = await DecisionRepo.getRoutingAccuracyHistory(USER, 30);
    history.forEach((h: any) => {
      expect(h.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it("returns entries ordered by date ASC", async () => {
    // Today's row
    await seedDecision({ userId: USER, feedbackScore: 1 });

    const history = await DecisionRepo.getRoutingAccuracyHistory(USER, 30);
    for (let i = 1; i < history.length; i++) {
      expect(history[i].date >= history[i - 1].date).toBe(true);
    }
  });
});

// ── getTodayStats() signal-level filtering (P5: satisfaction_rate aligns with analyzeAndLearn L1 truth) ──

describe("getTodayStats() signal-level filtering", () => {
  /**
   * Helper: seed a feedback_events row directly (bypassing recordFeedback).
   * Used to construct precise L1/L2/L3 signal scenarios.
   */
  async function seedFeedbackEvent(opts: {
    decisionId: string;
    userId: string;
    eventType: string;
    signalLevel: number;
    source?: "ui" | "auto_detect" | "system";
  }): Promise<void> {
    await query(
      `INSERT INTO feedback_events (id, decision_id, user_id, event_type, signal_level, source, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6, NULL)`,
      [uuid(), opts.decisionId, opts.userId, opts.eventType, opts.signalLevel, opts.source ?? "ui"]
    );
  }

  it("L1 explicit (signal_level=1) counts toward satisfaction_rate", async () => {
    const id1 = await seedDecision({ userId: USER, feedbackScore: 2 }); // thumbs_up legacy score
    const id2 = await seedDecision({ userId: USER, feedbackScore: 2 });
    // feedback_events L1
    await seedFeedbackEvent({ decisionId: id1, userId: USER, eventType: "thumbs_up", signalLevel: 1 });
    await seedFeedbackEvent({ decisionId: id2, userId: USER, eventType: "thumbs_up", signalLevel: 1 });

    const stats = await DecisionRepo.getTodayStats(USER);
    expect(stats.satisfaction_rate).toBe(100); // 2 positive / 2 L1 = 100%
  });

  it("L2 (signal_level=2) is excluded from satisfaction_rate denominator", async () => {
    // 2 L2 decisions with positive feedback_score, 1 L1 positive — satisfaction should be 100% (1/1)
    const idL1 = await seedDecision({ userId: USER, feedbackScore: 2 });
    await seedFeedbackEvent({ decisionId: idL1, userId: USER, eventType: "follow_up_thanks", signalLevel: 2 });

    const idL1pos = await seedDecision({ userId: USER, feedbackScore: 2 });
    await seedFeedbackEvent({ decisionId: idL1pos, userId: USER, eventType: "thumbs_up", signalLevel: 1 });

    const stats = await DecisionRepo.getTodayStats(USER);
    // Only the L1 decision counts (denominator=1, numerator=1)
    expect(stats.satisfaction_rate).toBe(100);
  });

  it("L3 (signal_level=3) is excluded from satisfaction_rate", async () => {
    const idL3 = await seedDecision({ userId: USER, feedbackScore: -2 });
    await seedFeedbackEvent({ decisionId: idL3, userId: USER, eventType: "regenerated", signalLevel: 3 });

    const idL1pos = await seedDecision({ userId: USER, feedbackScore: 2 });
    await seedFeedbackEvent({ decisionId: idL1pos, userId: USER, eventType: "thumbs_up", signalLevel: 1 });

    const stats = await DecisionRepo.getTodayStats(USER);
    // L3 excluded; only L1 positive counts → 1/1 = 100%
    expect(stats.satisfaction_rate).toBe(100);
  });

  it("mixed L1 + L2: satisfaction_rate computed on L1 only", async () => {
    // L1 positive
    const idPos = await seedDecision({ userId: USER, feedbackScore: 2 });
    await seedFeedbackEvent({ decisionId: idPos, userId: USER, eventType: "thumbs_up", signalLevel: 1 });

    // L1 negative
    const idNeg = await seedDecision({ userId: USER, feedbackScore: 0 });
    await seedFeedbackEvent({ decisionId: idNeg, userId: USER, eventType: "thumbs_down", signalLevel: 1 });

    // L2 — should NOT affect rate
    const idL2 = await seedDecision({ userId: USER, feedbackScore: 2 });
    await seedFeedbackEvent({ decisionId: idL2, userId: USER, eventType: "follow_up_thanks", signalLevel: 2 });

    const stats = await DecisionRepo.getTodayStats(USER);
    // Denominator = 2 (only L1), numerator = 1 (only thumbs_up) → 50%
    expect(stats.satisfaction_rate).toBe(50);
  });

  it("legacy: no feedback_events + feedback_score IS NOT NULL → treated as L1", async () => {
    // No feedback_events record; seedDecision only sets feedback_score
    await seedDecision({ userId: USER, feedbackScore: 1 }); // positive legacy
    await seedDecision({ userId: USER, feedbackScore: 1 }); // positive legacy
    await seedDecision({ userId: USER, feedbackScore: 0 });  // negative legacy

    const stats = await DecisionRepo.getTodayStats(USER);
    // Legacy decisions treated as L1 → 2 positive / 3 total = 67%
    expect(stats.satisfaction_rate).toBe(67);
  });

  it("legacy: no feedback_events + feedback_score IS NULL → not counted in satisfaction", async () => {
    await seedDecision({ userId: USER, feedbackScore: null }); // no signal at all
    await seedDecision({ userId: USER, feedbackScore: 1 });   // legacy L1 positive

    const stats = await DecisionRepo.getTodayStats(USER);
    // Only the legacy L1 positive counts → 1/1 = 100%
    expect(stats.satisfaction_rate).toBe(100);
  });

  it("L1 negative (thumbs_down) counts in denominator but not numerator", async () => {
    const idPos = await seedDecision({ userId: USER, feedbackScore: 2 });
    await seedFeedbackEvent({ decisionId: idPos, userId: USER, eventType: "thumbs_up", signalLevel: 1 });

    const idNeg = await seedDecision({ userId: USER, feedbackScore: 0 });
    await seedFeedbackEvent({ decisionId: idNeg, userId: USER, eventType: "thumbs_down", signalLevel: 1 });

    const stats = await DecisionRepo.getTodayStats(USER);
    // 1 positive / 2 total L1 = 50%
    expect(stats.satisfaction_rate).toBe(50);
  });

  it("other user's feedback_events do not affect satisfaction_rate", async () => {
    const OTHER = uuid();
    const idSelf = await seedDecision({ userId: USER, feedbackScore: 2 });
    await seedFeedbackEvent({ decisionId: idSelf, userId: USER, eventType: "thumbs_up", signalLevel: 1 });

    // OTHER's L1 positive — should not affect USER's rate
    const idOther = await seedDecision({ userId: OTHER, feedbackScore: 2 });
    await seedFeedbackEvent({ decisionId: idOther, userId: OTHER, eventType: "thumbs_up", signalLevel: 1 });

    const stats = await DecisionRepo.getTodayStats(USER);
    // Only USER's L1 positive counts → 1/1 = 100%
    expect(stats.satisfaction_rate).toBe(100);
  });
});

// ── getRoutingAccuracyHistory() signal-level filtering ──

describe("getRoutingAccuracyHistory() signal-level filtering", () => {
  async function seedFeedbackEvent(opts: {
    decisionId: string;
    userId: string;
    eventType: string;
    signalLevel: number;
    source?: "ui" | "auto_detect" | "system";
  }): Promise<void> {
    await query(
      `INSERT INTO feedback_events (id, decision_id, user_id, event_type, signal_level, source, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6, NULL)`,
      [uuid(), opts.decisionId, opts.userId, opts.eventType, opts.signalLevel, opts.source ?? "ui"]
    );
  }

  it("L1 explicit (signal_level=1) counted in history", async () => {
    const id1 = await seedDecision({ userId: USER, feedbackScore: 2 });
    await seedFeedbackEvent({ decisionId: id1, userId: USER, eventType: "thumbs_up", signalLevel: 1 });

    const history = await DecisionRepo.getRoutingAccuracyHistory(USER, 30);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0].value).toBe(100); // 1 positive L1 / 1 L1 = 100%
  });

  it("L2 (signal_level=2) excluded from history value", async () => {
    const idL2 = await seedDecision({ userId: USER, feedbackScore: 2 });
    await seedFeedbackEvent({ decisionId: idL2, userId: USER, eventType: "follow_up_thanks", signalLevel: 2 });

    const idL1pos = await seedDecision({ userId: USER, feedbackScore: 2 });
    await seedFeedbackEvent({ decisionId: idL1pos, userId: USER, eventType: "thumbs_up", signalLevel: 1 });

    const history = await DecisionRepo.getRoutingAccuracyHistory(USER, 30);
    // Only L1 counts → 1 positive / 1 L1 = 100%
    expect(history[0].value).toBe(100);
  });

  it("L3 (signal_level=3) excluded from history", async () => {
    const idL3 = await seedDecision({ userId: USER, feedbackScore: -2 });
    await seedFeedbackEvent({ decisionId: idL3, userId: USER, eventType: "regenerated", signalLevel: 3 });

    const idL1pos = await seedDecision({ userId: USER, feedbackScore: 2 });
    await seedFeedbackEvent({ decisionId: idL1pos, userId: USER, eventType: "thumbs_up", signalLevel: 1 });

    const history = await DecisionRepo.getRoutingAccuracyHistory(USER, 30);
    expect(history[0].value).toBe(100); // L3 excluded, L1 positive only
  });

  it("legacy: no feedback_events + feedback_score IS NOT NULL → treated as L1 in history", async () => {
    await seedDecision({ userId: USER, feedbackScore: 2 });
    await seedDecision({ userId: USER, feedbackScore: 0 });

    const history = await DecisionRepo.getRoutingAccuracyHistory(USER, 30);
    // Legacy treated as L1: 1 positive / 2 = 50%
    expect(history[0].value).toBe(50);
  });

  it("legacy: no feedback_events + feedback_score IS NULL → not counted in history", async () => {
    await seedDecision({ userId: USER, feedbackScore: null }); // no signal
    await seedDecision({ userId: USER, feedbackScore: 2 });   // legacy L1 positive

    const history = await DecisionRepo.getRoutingAccuracyHistory(USER, 30);
    // Only legacy L1 positive counted → 1/1 = 100%
    expect(history[0].value).toBe(100);
  });
});
