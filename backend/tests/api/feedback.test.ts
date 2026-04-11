/**
 * P3: POST /chat/feedback API Integration Tests — Sprint 12
 * P2 (Sprint 14): FeedbackType whitelist + ownership validation added.
 *
 * Validates the /chat/feedback endpoint contract:
 *   POST /chat/feedback  { decision_id, feedback_type, user_id }
 *
 * Infrastructure: tests/db/harness.ts
 *   Setup:  DATABASE_URL → smartrouter_test
 *   Schema: CREATE TABLE IF NOT EXISTS on startup (idempotent)
 *   Isolation: beforeEach → truncateTables() → COMMIT
 *
 * Real (not mocked):
 *   - recordFeedback() → DecisionRepo.updateFeedback() (thin wrapper; DB write verified)
 *
 * DecisionRepo.updateFeedback() SQL contract was validated in P2 (decision-repo.test.ts).
 * This suite validates the API layer only.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { randomUUID } from "crypto";
import { truncateTables } from "../db/harness.js";
import { chatRouter } from "../../src/api/chat.js";
import { DecisionRepo } from "../../src/db/repositories.js";

// ── Seed helper (duplicated from dashboard.test.ts to avoid cross-test-file imports) ──

/** Insert a decision log row for the feedback endpoint test.
 * Column order (32 fields — must match VALUES array exactly):
 *   1  id                  11 fast_score           21 model_used
 *   2  user_id             12 slow_score            22 exec_input_tokens
 *   3  session_id          13 confidence             23 exec_output_tokens
 *   4  query_preview       14 selected_model         24 total_cost_usd
 *   5  intent              15 selected_role          25 latency_ms
 *   6  complexity_score    16 selection_reason       26 did_fallback
 *   7  input_token_count   17 context_orig_tokens    27 feedback_type
 *   8  has_code            18 context_comp_tokens    28 routing_correct
 *   9  has_math            19 compression_level      29 feedback_score
 *  10  router_version      20 compression_ratio     30 cost_saved_vs_slow
 *                                              31 created_at
 */
async function seedDecision(overrides: Record<string, unknown> = {}) {
  const pg = await import("pg");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL! });
  try {
    await pool.query(`
      INSERT INTO decision_logs (
        id, user_id, session_id, query_preview, intent, complexity_score,
        input_token_count, has_code, has_math,
        router_version, fast_score, slow_score, confidence,
        selected_model, selected_role, selection_reason,
        context_original_tokens, context_compressed_tokens,
        compression_level, compression_ratio,
        model_used, exec_input_tokens, exec_output_tokens,
        total_cost_usd, latency_ms, did_fallback, feedback_type,
        routing_correct, feedback_score, cost_saved_vs_slow,
        created_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31
      )`,
      [
        overrides.id ?? randomUUID(),
        overrides.user_id ?? randomUUID(),
        overrides.session_id ?? randomUUID(),
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
        overrides.feedback_type ?? null,
        overrides.routing_correct ?? null,
        overrides.feedback_score ?? null,
        overrides.cost_saved_vs_slow ?? 0.00005,
        overrides.created_at ?? new Date(),
      ]
    );
  } finally {
    await pool.end();
  }
}

const app = new Hono().route("/chat", chatRouter);

const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_USER_ID = "00000000-0000-0000-0000-000000000002";
const DECISION_ID = "00000000-0000-0000-0000-000000000001";
const VALID_PAYLOAD = { decision_id: DECISION_ID, feedback_type: "thumbs_up", user_id: TEST_USER_ID };

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  await truncateTables();
  // Seed a decision row using the fixed IDs so tests can reference them
  await seedDecision({
    id: DECISION_ID,
    user_id: TEST_USER_ID,
    routing_correct: true,
    feedback_score: null,
  });
});

// ── Happy path ────────────────────────────────────────────────────────────────

describe("POST /chat/feedback — success cases", () => {
  it("returns { success: true } with valid decision_id and feedback_type", async () => {
    const res = await app.request("/chat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_PAYLOAD),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ success: true });
  });

  it("accepts 'accepted' as feedback_type", async () => {
    const id = randomUUID();
    await seedDecision({ id, user_id: TEST_USER_ID, feedback_score: null, routing_correct: null });
    const res = await app.request("/chat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision_id: id, feedback_type: "accepted", user_id: TEST_USER_ID }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  it("accepts 'thumbs_up' as feedback_type", async () => {
    const id = randomUUID();
    await seedDecision({ id, user_id: TEST_USER_ID, feedback_score: null, routing_correct: null });
    const res = await app.request("/chat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision_id: id, feedback_type: "thumbs_up", user_id: TEST_USER_ID }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  it("accepts 'thumbs_down' as feedback_type", async () => {
    const id = randomUUID();
    await seedDecision({ id, user_id: TEST_USER_ID, feedback_score: null, routing_correct: null });
    const res = await app.request("/chat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision_id: id, feedback_type: "thumbs_down", user_id: TEST_USER_ID }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  it("accepts 'regenerated' as feedback_type", async () => {
    const id = randomUUID();
    await seedDecision({ id, user_id: TEST_USER_ID, feedback_score: null, routing_correct: null });
    const res = await app.request("/chat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision_id: id, feedback_type: "regenerated", user_id: TEST_USER_ID }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  it("accepts 'follow_up_thanks' as feedback_type", async () => {
    const id = randomUUID();
    await seedDecision({ id, user_id: TEST_USER_ID, feedback_score: null, routing_correct: null });
    const res = await app.request("/chat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision_id: id, feedback_type: "follow_up_thanks", user_id: TEST_USER_ID }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  it("accepts 'follow_up_doubt' as feedback_type", async () => {
    const id = randomUUID();
    await seedDecision({ id, user_id: TEST_USER_ID, feedback_score: null, routing_correct: null });
    const res = await app.request("/chat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision_id: id, feedback_type: "follow_up_doubt", user_id: TEST_USER_ID }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  it("accepts 'edited' as feedback_type", async () => {
    const id = randomUUID();
    await seedDecision({ id, user_id: TEST_USER_ID, feedback_score: null, routing_correct: null });
    const res = await app.request("/chat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision_id: id, feedback_type: "edited", user_id: TEST_USER_ID }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });
});

// ── Decision not found ────────────────────────────────────────────────────────

describe("POST /chat/feedback — decision not found", () => {
  it("returns 404 when decision_id does not exist", async () => {
    const res = await app.request("/chat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision_id: "99999999-9999-9999-9999-999999999999",
        feedback_type: "thumbs_up",
        user_id: TEST_USER_ID,
      }),
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toHaveProperty("error");
  });
});

// ── Input validation ───────────────────────────────────────────────────────────

describe("POST /chat/feedback — input validation", () => {
  it("returns 400 when decision_id is missing", async () => {
    const res = await app.request("/chat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback_type: "thumbs_up", user_id: TEST_USER_ID }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when feedback_type is missing", async () => {
    const res = await app.request("/chat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision_id: DECISION_ID, user_id: TEST_USER_ID }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when user_id is missing", async () => {
    const res = await app.request("/chat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision_id: DECISION_ID, feedback_type: "thumbs_up" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when decision_id is empty string", async () => {
    const res = await app.request("/chat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision_id: "", feedback_type: "thumbs_up", user_id: TEST_USER_ID }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when body is not valid JSON", async () => {
    const res = await app.request("/chat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when body is empty object", async () => {
    const res = await app.request("/chat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

// ── P2: FeedbackType whitelist (Sprint 14) ─────────────────────────────────────

describe("POST /chat/feedback — P2: type whitelist", () => {
  it("returns 400 for unknown feedback_type", async () => {
    const res = await app.request("/chat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision_id: DECISION_ID, feedback_type: "fake_type", user_id: TEST_USER_ID }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect((json as any).error).toContain("invalid feedback_type");
  });

  it("returns 400 for empty-string feedback_type", async () => {
    const res = await app.request("/chat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision_id: DECISION_ID, feedback_type: "", user_id: TEST_USER_ID }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for numerical feedback_type", async () => {
    const res = await app.request("/chat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision_id: DECISION_ID, feedback_type: "123", user_id: TEST_USER_ID }),
    });
    expect(res.status).toBe(400);
  });
});

// ── P2: Ownership validation (Sprint 14) ──────────────────────────────────────

describe("POST /chat/feedback — P2: ownership validation", () => {
  it("returns 403 when user_id does not match decision owner", async () => {
    const res = await app.request("/chat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision_id: DECISION_ID,
        feedback_type: "thumbs_up",
        user_id: OTHER_USER_ID, // seeded decision belongs to TEST_USER_ID
      }),
    });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect((json as any).error).toContain("forbidden");
  });

  it("succeeds when user_id matches decision owner", async () => {
    const res = await app.request("/chat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision_id: DECISION_ID,
        feedback_type: "thumbs_up",
        user_id: TEST_USER_ID,
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });
});
