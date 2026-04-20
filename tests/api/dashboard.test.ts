// workspace: 20260416214742
/**
 * SI-004: Dashboard API Integration Tests — Sprint 11
 *
 * Validates the GET /dashboard/:userId endpoint.
 *
 * Infrastructure:
 *   - vitest.api.config.ts: test DB = smartrouter_test, shared DB process, sequential
 *   - truncateTables() in beforeEach: all tables reset + COMMIT (isolated per test)
 *
 * Data dependencies (real DB reads, no mocks for repos):
 *   calculateDashboard(userId) reads from:
 *     - decision_logs      (getTodayStats + getRecent)
 *     - growth_milestones  (via GrowthRepo.getProfile)
 *     - behavioral_memories (via GrowthRepo.getProfile)
 *
 * Seed strategy: raw SQL INSERTs — same pattern as IT-003 / IT-004.
 */

import { Hono } from "hono";
import { randomUUID } from "crypto";
import { dashboardRouter } from "../../src/api/dashboard.js";
import { truncateTables } from "../db/harness.js";

const USER_A = randomUUID();
const USER_B = randomUUID();
const SESSION_A = randomUUID();
const SESSION_B = randomUUID();

// ── Test app: mounts dashboardRouter, no HTTP server ──────────────────────────

const testApp = new Hono();
testApp.route("/", dashboardRouter);

function makeReq(userId: string, path = `/dashboard/${userId}`) {
  return testApp.request(path);
}

async function parseJson(res: Response) {
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { return text; }
}

// ── Seed helpers ──────────────────────────────────────────────────────────────

/** Insert a decision log row (all fields required for calculateDashboard).
 *
 * Column order (32 fields — must match VALUES array exactly):
 *   1  id                  11 fast_score           21 model_used
 *   2  user_id             12 slow_score            22 exec_input_tokens
 *   3  session_id          13 confidence            23 exec_output_tokens
 *   4  query_preview       14 selected_model        24 total_cost_usd
 *   5  intent              15 selected_role         25 latency_ms
 *   6  complexity_score    16 selection_reason      26 did_fallback
 *   7  input_token_count   17 context_orig_tokens   27 fallback_reason
 *   8  has_code            18 context_comp_tokens    28 feedback_type
 *   9  has_math            19 compression_level      29 routing_correct
 *  10  router_version      20 compression_ratio     30 feedback_score
 *                                                31 cost_saved_vs_slow
 *                                                32 created_at
 */
async function seedDecision(overrides: Record<string, unknown> = {}) {
  const id = overrides.id ?? randomUUID();
  const user_id = overrides.user_id ?? USER_A;
  const session_id = overrides.session_id ?? SESSION_A;
  const created_at = overrides.created_at ?? new Date();

  const pg = await import("pg");
  const seedPool = new pg.Pool({ connectionString: process.env.DATABASE_URL! });
  try {
    await seedPool.query(`
      INSERT INTO decision_logs (
        id, user_id, session_id, query_preview, intent, complexity_score,
        input_token_count, has_code, has_math,
        router_version, fast_score, slow_score, confidence,
        selected_model, selected_role, selection_reason,
        context_original_tokens, context_compressed_tokens,
        compression_level, compression_ratio,
        model_used, exec_input_tokens, exec_output_tokens,
        total_cost_usd, latency_ms, did_fallback, fallback_reason,
        feedback_type, routing_correct, feedback_score, cost_saved_vs_slow,
        created_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32
      )`,
      [
        id, user_id, session_id,
        overrides.query_preview ?? "test query",
        overrides.intent ?? "general",
        overrides.complexity_score ?? 50,
        overrides.input_token_count ?? 100,
        overrides.has_code ?? false,
        overrides.has_math ?? false,
        overrides.router_version ?? "v1",
        overrides.fast_score ?? 0.7,
        overrides.slow_score ?? 0.6,
        overrides.confidence ?? 0.65,
        overrides.selected_model ?? "gpt-4o-mini",
        overrides.selected_role ?? "fast",
        overrides.selection_reason ?? "fast score higher",
        overrides.context_original_tokens ?? 500,
        overrides.context_compressed_tokens ?? 300,
        overrides.compression_level ?? "med",
        overrides.compression_ratio ?? 0.6,
        overrides.model_used ?? "gpt-4o-mini",
        overrides.exec_input_tokens ?? 100,
        overrides.exec_output_tokens ?? 50,
        overrides.total_cost_usd ?? 0.00015,
        overrides.latency_ms ?? 200,
        overrides.did_fallback ?? false,
        overrides.fallback_reason ?? null,
        overrides.feedback_type ?? null,
        overrides.routing_correct ?? null,
        overrides.feedback_score ?? null,
        overrides.cost_saved_vs_slow ?? 0.00005,
        created_at,
      ]
    );
  } finally {
    await seedPool.end();
  }
  return id;
}

/** Insert a behavioral memory row. */
async function seedBehavioralMemory(overrides: Record<string, unknown> = {}) {
  const pg = await import("pg");
  const seedPool = new pg.Pool({ connectionString: process.env.DATABASE_URL! });
  try {
    await seedPool.query(`
      INSERT INTO behavioral_memories (
        id, user_id, trigger_pattern, observation, learned_action, strength,
        reinforcement_count, last_activated, source_decision_ids
      ) VALUES ($1,$2,$3,$4,$5,$6,$7, NOW(), $8)`,
      [
        randomUUID(),
        overrides.user_id ?? USER_A,
        overrides.trigger_pattern ?? "code request",
        overrides.observation ?? "User prefers fast model for code",
        overrides.learned_action ?? "route to fast",
        overrides.strength ?? 0.8,
        overrides.reinforcement_count ?? 1,
        overrides.source_decision_ids ?? [],
      ]
    );
  } finally {
    await seedPool.end();
  }
}

/** Insert a growth milestone row. */
async function seedMilestone(overrides: Record<string, unknown> = {}) {
  const pg = await import("pg");
  const seedPool = new pg.Pool({ connectionString: process.env.DATABASE_URL! });
  try {
    await seedPool.query(`
      INSERT INTO growth_milestones (id, user_id, milestone_type, title, description, metric_value)
      VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        randomUUID(),
        overrides.user_id ?? USER_A,
        overrides.milestone_type ?? "accuracy",
        overrides.title ?? "First milestone",
        overrides.description ?? "desc",
        overrides.metric_value ?? 95.0,
      ]
    );
  } finally {
    await seedPool.end();
  }
}

// ── GET /dashboard/:userId — happy path ───────────────────────────────────────

describe("GET /dashboard/:userId", () => {
  beforeEach(async () => {
    await truncateTables();
  });

  // ── Empty state ──────────────────────────────────────────────────────────────

  it("200 — new user returns valid shape with all zero/empty fields", async () => {
    const res = await makeReq(USER_A);
    expect(res.status).toBe(200);
    const json = await parseJson(res);

    // today shape
    expect(json.today).toBeDefined();
    expect(typeof json.today.total_requests).toBe("number");
    expect(typeof json.today.fast_count).toBe("number");
    expect(typeof json.today.slow_count).toBe("number");
    expect(typeof json.today.fallback_count).toBe("number");
    expect(typeof json.today.total_tokens).toBe("number");
    expect(typeof json.today.total_cost).toBe("number");
    expect(typeof json.today.saved_cost).toBe("number");
    expect(typeof json.today.saving_rate).toBe("number");
    expect(typeof json.today.avg_latency_ms).toBe("number");
    expect(typeof json.today.satisfaction_proxy).toBe("number");

    // token_flow shape
    expect(json.token_flow).toBeDefined();
    expect(json.token_flow.fast_tokens).toBe(0);
    expect(json.token_flow.slow_tokens).toBe(0);
    expect(json.token_flow.compressed_tokens).toBe(0);
    expect(json.token_flow.fallback_tokens).toBe(0);

    // arrays
    expect(Array.isArray(json.recent_decisions)).toBe(true);
    expect(json.recent_decisions.length).toBe(0);

    // growth shape
    expect(json.growth).toBeDefined();
    expect(json.growth.user_id).toBe(USER_A);
    expect(typeof json.growth.level).toBe("number");
    expect(typeof json.growth.level_name).toBe("string");
    expect(typeof json.growth.level_progress).toBe("number");
    expect(Array.isArray(json.growth.satisfaction_history)).toBe(true);  // renamed from routing_accuracy_history (was always empty due to routing_correct=null)
    expect(typeof json.growth.total_saved_usd).toBe("number");
    expect(typeof json.growth.satisfaction_rate).toBe("number");
    expect(typeof json.growth.total_interactions).toBe("number");
    expect(typeof json.growth.behavioral_memories_count).toBe("number");
    expect(Array.isArray(json.growth.milestones)).toBe(true);
    expect(Array.isArray(json.growth.recent_learnings)).toBe(true);
  });

  // ── User isolation ───────────────────────────────────────────────────────────

  it("200 — USER_A decisions not visible to USER_B", async () => {
    await seedDecision({ user_id: USER_A, selected_role: "fast", exec_input_tokens: 200, exec_output_tokens: 100 });
    await seedDecision({ user_id: USER_A, selected_role: "slow", exec_input_tokens: 300, exec_output_tokens: 200 });
    await seedDecision({ user_id: USER_B, selected_role: "fast", exec_input_tokens: 999, exec_output_tokens: 999 });

    const resA = await makeReq(USER_A);
    const resB = await makeReq(USER_B);
    const jsonA: any = await parseJson(resA);
    const jsonB: any = await parseJson(resB);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(jsonA.today.total_requests).toBe(2); // only USER_A
    expect(jsonB.today.total_requests).toBe(1); // only USER_B
    expect(jsonA.recent_decisions.length).toBe(2);
    expect(jsonB.recent_decisions.length).toBe(1);
  });

  // ── today aggregations ────────────────────────────────────────────────────────

  it("200 — today counts are correct for mixed roles", async () => {
    await seedDecision({ selected_role: "fast", exec_input_tokens: 100, exec_output_tokens: 50 });
    await seedDecision({ selected_role: "fast", exec_input_tokens: 100, exec_output_tokens: 50 });
    await seedDecision({ selected_role: "slow", exec_input_tokens: 300, exec_output_tokens: 150 });
    await seedDecision({ selected_role: "fast", did_fallback: true, exec_input_tokens: 100, exec_output_tokens: 50 });

    const res = await makeReq(USER_A);
    expect(res.status).toBe(200);
    const json: any = await parseJson(res);

    expect(json.today.total_requests).toBe(4);
    expect(json.today.fast_count).toBe(3);
    expect(json.today.slow_count).toBe(1);
    expect(json.today.fallback_count).toBe(1);
  });

  it("200 — today.total_tokens is sum of exec_input + exec_output", async () => {
    await seedDecision({ exec_input_tokens: 100, exec_output_tokens: 50 });
    await seedDecision({ exec_input_tokens: 200, exec_output_tokens: 100 });

    const res = await makeReq(USER_A);
    const json: any = await parseJson(res);
    expect(json.today.total_tokens).toBe(450); // (100+50)+(200+100)
  });

  it("200 — today.saving_rate computed from saved_cost and total_cost", async () => {
    // saving_rate = round(saved / (total + saved) * 100)
    await seedDecision({ total_cost_usd: 0.001, cost_saved_vs_slow: 0.0002 });

    const res = await makeReq(USER_A);
    const json: any = await parseJson(res);
    // saved=0.0002, total=0.001 → rate = round(0.0002/0.0012*100) = round(16.67) = 17
    expect(json.today.saving_rate).toBe(17);
    expect(json.today.total_cost).toBe(0.001);
    expect(json.today.saved_cost).toBe(0.0002);
  });

  // ── token flow ────────────────────────────────────────────────────────────────

  it("200 — token_flow sums tokens by selected_role and fallback", async () => {
    // fast: (10+5)=15 tokens
    await seedDecision({ selected_role: "fast", did_fallback: false, exec_input_tokens: 10, exec_output_tokens: 5 });
    // slow: (30+15)=45 tokens
    await seedDecision({ selected_role: "slow", did_fallback: false, exec_input_tokens: 30, exec_output_tokens: 15 });
    // fallback: (20+10)=30 tokens (falls into fallback_tokens regardless of role)
    await seedDecision({ selected_role: "fast", did_fallback: true, exec_input_tokens: 20, exec_output_tokens: 10 });

    const res = await makeReq(USER_A);
    const json: any = await parseJson(res);

    expect(json.token_flow.fast_tokens).toBe(15);
    expect(json.token_flow.slow_tokens).toBe(45);
    expect(json.token_flow.fallback_tokens).toBe(30);
    // compressed = sum(original - compressed) = 3 * 200 = 600 (seeded with defaults)
    expect(json.token_flow.compressed_tokens).toBe(600);
  });

  // ── recent_decisions ──────────────────────────────────────────────────────────

  it("200 — recent_decisions ordered DESC by created_at", async () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // seedDecision with explicit created_at — yesterday then today
    await seedDecision({ query_preview: "yesterday", selected_role: "fast",
      total_cost_usd: 0.00015, latency_ms: 200, created_at: yesterday });
    await seedDecision({ query_preview: "today", selected_role: "slow",
      total_cost_usd: 0.0003, latency_ms: 400, created_at: today });

    const res = await makeReq(USER_A);
    const json: any = await parseJson(res);

    expect(json.recent_decisions.length).toBe(2);
    // First item should be the most recent (today)
    expect(json.recent_decisions[0].input_features.raw_query).toBe("today");
    expect(json.recent_decisions[1].input_features.raw_query).toBe("yesterday");
  });

  it("200 — recent_decisions has all required field groups", async () => {
    await seedDecision({
      selected_role: "fast",
      did_fallback: false,
      exec_input_tokens: 100,
      exec_output_tokens: 50,
      total_cost_usd: 0.00015,
      latency_ms: 200,
      context_original_tokens: 500,
      context_compressed_tokens: 300,
      compression_level: "med",
      compression_ratio: 0.6,
      routing_correct: true,
      feedback_type: "thumbs",
      feedback_score: 1,
    });

    const res = await makeReq(USER_A);
    const json: any = await parseJson(res);

    expect(json.recent_decisions.length).toBe(1);
    const d = json.recent_decisions[0];

    // input_features
    expect(d.input_features).toBeDefined();
    expect(typeof d.input_features.raw_query).toBe("string");
    expect(typeof d.input_features.intent).toBe("string");
    expect(typeof d.input_features.complexity_score).toBe("number");
    expect(typeof d.input_features.token_count).toBe("number");
    expect(typeof d.input_features.has_code).toBe("boolean");
    expect(typeof d.input_features.has_math).toBe("boolean");

    // routing
    expect(d.routing).toBeDefined();
    expect(typeof d.routing.router_version).toBe("string");
    expect(d.routing.scores).toBeDefined();
    expect(typeof d.routing.scores.fast).toBe("number");
    expect(typeof d.routing.scores.slow).toBe("number");
    expect(typeof d.routing.confidence).toBe("number");
    expect(typeof d.routing.selected_model).toBe("string");
    expect(typeof d.routing.selected_role).toBe("string");
    expect(typeof d.routing.selection_reason).toBe("string");

    // context
    expect(d.context).toBeDefined();
    expect(typeof d.context.original_tokens).toBe("number");
    expect(typeof d.context.compressed_tokens).toBe("number");
    expect(typeof d.context.compression_level).toBe("string");
    expect(typeof d.context.compression_ratio).toBe("number");

    // execution
    expect(d.execution).toBeDefined();
    expect(typeof d.execution.model_used).toBe("string");
    expect(typeof d.execution.input_tokens).toBe("number");
    expect(typeof d.execution.output_tokens).toBe("number");
    expect(typeof d.execution.total_cost_usd).toBe("number");
    expect(typeof d.execution.latency_ms).toBe("number");
    expect(typeof d.execution.did_fallback).toBe("boolean");

    // feedback (present because seeded)
    expect(d.feedback).toBeDefined();
    expect(d.feedback.type).toBe("thumbs");
    expect(d.feedback.score).toBe(1);
  });

  // ── growth ──────────────────────────────────────────────────────────────────

  it("200 — growth.level is 1 (novice) for user with no decisions", async () => {
    const res = await makeReq(USER_A);
    const json: any = await parseJson(res);
    expect(json.growth.level).toBe(1);
    expect(json.growth.level_name).toBe("初次见面");
    expect(json.growth.total_interactions).toBe(0);
    expect(json.growth.total_saved_usd).toBe(0);
  });

  it("200 — growth.total_interactions counts all user decisions", async () => {
    await seedDecision();
    await seedDecision();
    await seedDecision({ user_id: USER_B }); // should not count for USER_A

    const res = await makeReq(USER_A);
    const json: any = await parseJson(res);
    expect(json.growth.total_interactions).toBe(2);
  });

  it("200 — growth.total_saved_usd sums cost_saved_vs_slow", async () => {
    await seedDecision({ cost_saved_vs_slow: 0.001 });
    await seedDecision({ cost_saved_vs_slow: 0.002 });

    const res = await makeReq(USER_A);
    const json: any = await parseJson(res);
    expect(json.growth.total_saved_usd).toBeCloseTo(0.003, 5);
  });

  it("200 — growth.behavioral_memories_count reflects behavioral_memories table", async () => {
    await seedBehavioralMemory();
    await seedBehavioralMemory();
    await seedBehavioralMemory({ user_id: USER_B }); // should not count

    const res = await makeReq(USER_A);
    const json: any = await parseJson(res);
    expect(json.growth.behavioral_memories_count).toBe(2);
  });

  it("200 — growth.milestones contains seeded milestones with date+event", async () => {
    await seedMilestone({ title: "Milestone Alpha" });
    await seedMilestone({ title: "Milestone Beta" });

    const res = await makeReq(USER_A);
    const json: any = await parseJson(res);

    expect(json.growth.milestones.length).toBe(2);
    const titles = json.growth.milestones.map((m: any) => m.event);
    expect(titles).toContain("Milestone Alpha");
    expect(titles).toContain("Milestone Beta");
    // Each milestone has date + event shape
    json.growth.milestones.forEach((m: any) => {
      expect(typeof m.date).toBe("string");
      expect(typeof m.event).toBe("string");
    });
  });

  it("200 — growth.milestones capped at 10 entries DESC", async () => {
    const pg = await import("pg");
    const seedPool = new pg.Pool({ connectionString: process.env.DATABASE_URL! });

    // Insert 12 milestones with distinct timestamps
    const base = new Date();
    try {
      for (let i = 0; i < 12; i++) {
        const ts = new Date(base);
        ts.setHours(base.getHours() - i);
        await seedPool.query(`
          INSERT INTO growth_milestones (id, user_id, milestone_type, title, description, metric_value, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [randomUUID(), USER_A, "test", `m${i}`, "d", 0, ts]
        );
      }
    } finally {
      await seedPool.end();
    }

    const res = await makeReq(USER_A);
    const json: any = await parseJson(res);
    expect(json.growth.milestones.length).toBe(10); // capped at 10
  });

  it("200 — growth.satisfaction_history is array of {date, value} (computed from feedback_score)", async () => {
    // routing_correct no longer drives history; satisfaction_history is computed from feedback_score
    await seedDecision({
      query_preview: "q",
      routing_correct: true,  // still stored but not used for history computation
      feedback_score: 1,
      cost_saved_vs_slow: 0.00005,
    });

    const res = await makeReq(USER_A);
    const json: any = await parseJson(res);

    expect(Array.isArray(json.growth.satisfaction_history)).toBe(true);
    json.growth.satisfaction_history.forEach((h: any) => {
      expect(typeof h.date).toBe("string");
      expect(typeof h.value).toBe("number");
    });
  });

  it("200 — today.satisfaction_proxy matches growth.satisfaction_rate (both from today feedback)", async () => {
    // 3 with feedback, 2 positive → 66.67% satisfaction → rounded = 67
    await seedDecision({ query_preview: "q", feedback_score: 1, cost_saved_vs_slow: 0.00005 });
    await seedDecision({ query_preview: "q", feedback_score: 1, cost_saved_vs_slow: 0.00005 });
    await seedDecision({ query_preview: "q", feedback_score: 0, cost_saved_vs_slow: 0.00005 });

    const res = await makeReq(USER_A);
    const json: any = await parseJson(res);

    expect(json.today.satisfaction_proxy).toBe(67);  // renamed from routing_accuracy (was always satisfaction_rate)
    expect(json.growth.satisfaction_rate).toBe(67);
  });

  // ── cross-user isolation on growth ──────────────────────────────────────────

  it("200 — USER_A growth milestones not visible to USER_B", async () => {
    await seedMilestone({ user_id: USER_A, title: "A-only" });
    await seedMilestone({ user_id: USER_B, title: "B-only" });

    const resA = await makeReq(USER_A);
    const resB = await makeReq(USER_B);
    const jsonA: any = await parseJson(resA);
    const jsonB: any = await parseJson(resB);

    const aTitles = jsonA.growth.milestones.map((m: any) => m.event);
    const bTitles = jsonB.growth.milestones.map((m: any) => m.event);
    expect(aTitles).toContain("A-only");
    expect(aTitles).not.toContain("B-only");
    expect(bTitles).toContain("B-only");
    expect(bTitles).not.toContain("A-only");
  });

  // ── recent_decisions limit ───────────────────────────────────────────────────

  it("200 — recent_decisions capped at 20 entries", async () => {
    // Insert 25 decisions, expect only 20 in response
    const inserts = [];
    for (let i = 0; i < 25; i++) {
      inserts.push(seedDecision({ query_preview: `q${i}` }));
    }
    await Promise.all(inserts);

    const res = await makeReq(USER_A);
    const json: any = await parseJson(res);
    expect(json.recent_decisions.length).toBe(20);
  });

  // ── GET /growth/:userId ─────────────────────────────────────────────────────

  it("200 — GET /growth/:userId returns growth profile directly", async () => {
    await seedMilestone({ user_id: USER_A, title: "Growth milestone" });

    const res = await testApp.request(`/growth/${USER_A}`);
    expect(res.status).toBe(200);
    const json: any = await parseJson(res);

    expect(json.user_id).toBe(USER_A);
    expect(Array.isArray(json.milestones)).toBe(true);
    expect(json.milestones[0].event).toBe("Growth milestone");
  });

  // ── Error handling ───────────────────────────────────────────────────────────

  it("500 — throws if calculateDashboard fails", async () => {
    // Monkey-patch DecisionRepo.getTodayStats to throw
    const { DecisionRepo } = await import("../../src/db/repositories.js");
    const original = DecisionRepo.getTodayStats;
    DecisionRepo.getTodayStats = async () => { throw new Error("DB failure"); };

    try {
      const res = await makeReq(USER_A);
      expect(res.status).toBe(500);
      const json = await parseJson(res);
      expect(json.error).toBe("DB failure");
    } finally {
      DecisionRepo.getTodayStats = original;
    }
  });
});
