// workspace: 20260416214742
/**
 * P4 (Sprint 14): Implicit Feedback → feedback_events Backfill Tests
 *
 * Validates:
 *   1. detectImplicitFeedback() regex patterns return correct FeedbackType
 *   2. recordFeedback() with userId writes to feedback_events (source=auto_detect)
 *   3. learnFromInteraction() wires userId + previousDecisionId correctly to recordFeedback
 *   4. learnFromInteraction() skips implicit detection when previousDecisionId is absent
 *   5. signal_level is correct per event type (L2=thanks/doubt, L3=regenerated)
 *
 * Infrastructure: tests/db/harness.ts → smartrouter_test DB
 *   Setup:    CREATE TABLE IF NOT EXISTS on startup (idempotent)
 *   Isolation: beforeEach → truncateTables() → COMMIT
 */

import { randomUUID } from "crypto";
import { truncateTables } from "../db/harness.js";
import { FeedbackEventRepo } from "../../src/db/repositories.js";
import { detectImplicitFeedback, recordFeedback } from "../../src/features/feedback-collector.js";
import { learnFromInteraction } from "../../src/features/learning-engine.js";

const USER = "00000000-0000-0000-0000-000000000001";
const DECISION = "00000000-0000-0000-0000-000000000002";

beforeEach(async () => {
  await truncateTables();
});

// ── 1. detectImplicitFeedback — pure regex tests ──────────────────────────────────

describe("detectImplicitFeedback — regex patterns", () => {
  const CASES: Array<{ text: string; expected: string | null }> = [
    // L2: follow_up_thanks
    { text: "谢谢", expected: "follow_up_thanks" },
    { text: "感谢", expected: "follow_up_thanks" },
    { text: "太好了", expected: "follow_up_thanks" },
    { text: "很好", expected: "follow_up_thanks" },
    { text: "perfect", expected: "follow_up_thanks" },
    { text: "thanks", expected: "follow_up_thanks" },
    { text: "great awesome", expected: "follow_up_thanks" },
    // L2: follow_up_doubt
    { text: "你确定吗", expected: "follow_up_doubt" },
    { text: "不对", expected: "follow_up_doubt" },
    { text: "错了", expected: "follow_up_doubt" },
    { text: "are you sure", expected: "follow_up_doubt" },
    // L3: regenerated
    { text: "再说一遍", expected: "regenerated" },
    { text: "换个说法", expected: "regenerated" },
    { text: "换个方式表达", expected: "regenerated" },
    { text: "try again", expected: "regenerated" },
    { text: "rephrase", expected: "regenerated" },
    // no match
    { text: "今天天气不错", expected: null },
    { text: "帮我写个排序算法", expected: null },
    { text: "什么是量子纠缠", expected: null },
  ];

  for (const { text, expected } of CASES) {
    it(`"${text.slice(0, 20)}" → ${expected ?? "null"}`, () => {
      const result = detectImplicitFeedback(text, DECISION);
      expect(result?.type ?? null).toBe(expected);
    });
  }

  it("returns null when previousDecisionId is null", () => {
    expect(detectImplicitFeedback("谢谢", null)).toBeNull();
  });

  it("returns null when previousDecisionId is undefined", () => {
    expect(detectImplicitFeedback("谢谢", undefined as unknown as string | null)).toBeNull();
  });

  it("confidence >= 0.6 for all detected patterns (meets threshold)", () => {
    for (const { text, expected } of CASES) {
      if (expected === null) continue; // skip non-match cases
      const result = detectImplicitFeedback(text, DECISION);
      expect(result).not.toBeNull();
      expect(result!.confidence).toBeGreaterThanOrEqual(0.6);
      expect(result!.type).toBe(expected);
    }
  });

  it("follow_up_thanks has confidence 0.8", () => {
    const r = detectImplicitFeedback("谢谢", DECISION)!;
    expect(r.confidence).toBe(0.8);
  });

  it("follow_up_doubt has confidence 0.7", () => {
    const r = detectImplicitFeedback("你确定吗", DECISION)!;
    expect(r.confidence).toBe(0.7);
  });

  it("regenerated has confidence 0.6", () => {
    const r = detectImplicitFeedback("再说一遍", DECISION)!;
    expect(r.confidence).toBe(0.6);
  });

  it("case-insensitive for English patterns", () => {
    expect(detectImplicitFeedback("THANKS", DECISION)?.type).toBe("follow_up_thanks");
    expect(detectImplicitFeedback("PERFECT", DECISION)?.type).toBe("follow_up_thanks");
    expect(detectImplicitFeedback("ARE YOU SURE", DECISION)?.type).toBe("follow_up_doubt");
  });
});

// ── 2. recordFeedback — implicit type writes to feedback_events ───────────────────

describe("recordFeedback — implicit types to feedback_events", () => {
  for (const eventType of ["follow_up_thanks", "follow_up_doubt", "regenerated"]) {
    it(`${eventType} writes row with source=auto_detect`, async () => {
      await recordFeedback(DECISION, eventType as "follow_up_thanks" | "follow_up_doubt" | "regenerated", USER);
      const row = await lastFeedbackEvent();
      expect(row.source).toBe("auto_detect");
      expect(row.decision_id).toBe(DECISION);
      expect(row.user_id).toBe(USER);
      expect(row.event_type).toBe(eventType);
    });
  }

  it("follow_up_thanks → signal_level=2", async () => {
    await recordFeedback(DECISION, "follow_up_thanks", USER);
    expect((await lastFeedbackEvent()).signal_level).toBe(2);
  });

  it("follow_up_doubt → signal_level=2", async () => {
    await recordFeedback(DECISION, "follow_up_doubt", USER);
    expect((await lastFeedbackEvent()).signal_level).toBe(2);
  });

  it("regenerated → signal_level=3", async () => {
    await recordFeedback(DECISION, "regenerated", USER);
    expect((await lastFeedbackEvent()).signal_level).toBe(3);
  });

  it("writes raw_data with confidence when provided", async () => {
    const rawData = { confidence: 0.8, derived_from: "user_message_regex" };
    await recordFeedback(DECISION, "follow_up_thanks", USER, rawData);
    const row = await lastFeedbackEvent();
    expect(row.raw_data).toEqual(rawData);
  });

  it("does NOT write to feedback_events when userId is omitted", async () => {
    await recordFeedback(DECISION, "follow_up_thanks");
    const result = await countFeedbackEvents();
    expect(result).toBe(0);
  });
});

// ── 3. learnFromInteraction — wiring tests ─────────────────────────────────────

// Mock dependencies that are not the target of these tests.
// recordFeedback (imported directly in learning-engine.ts) is NOT mocked here
// so it performs real writes to feedback_events — validating the full wiring.
vi.mock("../../src/services/memory-store.js", () => ({
  analyzeAndLearn: vi.fn().mockResolvedValue(null),
  autoLearnFromDecision: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../src/features/growth-tracker.js", () => ({
  checkAndRecordMilestones: vi.fn().mockResolvedValue([]),
}));

const MINIMAL_DECISION = {
  id: randomUUID(),
  user_id: USER,
  session_id: randomUUID(),
  timestamp: Date.now(),
  input_features: {
    intent: "coding",
    complexity_score: 3,
    history_length: 0,
    compressed_tokens: 0,
    compression_level: "none" as const,
    compression_ratio: 1,
    memory_items_retrieved: 0,
    final_messages: [],
    compression_details: [],
  },
  routing: {
    selected_role: "fast",
    selected_model: "test-model",
    confidence: 0.9,
    routing_reason: "test",
    fallback_model: "fallback-model",
  },
  context: {
    system_prompt_tokens: 10,
    history_tokens: 0,
    memory_tokens: 0,
    total_context_tokens: 10,
    retrieved_memories: [],
  },
  execution: {
    model_used: "test-model",
    input_tokens: 10,
    output_tokens: 10,
    total_cost_usd: 0.0001,
    latency_ms: 100,
    did_fallback: false,
    response_text: "test response",
  },
};

describe("learnFromInteraction — implicit feedback wiring", () => {
  it("writes feedback_events with source=auto_detect when message triggers follow_up_thanks", async () => {
    await learnFromInteraction(MINIMAL_DECISION, "谢谢", DECISION, USER);
    const row = await lastFeedbackEvent();
    expect(row.source).toBe("auto_detect");
    expect(row.event_type).toBe("follow_up_thanks");
    expect(row.signal_level).toBe(2);
    expect(row.decision_id).toBe(DECISION);
    expect(row.user_id).toBe(USER);
  });

  it("writes feedback_events for follow_up_doubt with signal_level=2", async () => {
    await learnFromInteraction(MINIMAL_DECISION, "你确定吗", DECISION, USER);
    const row = await lastFeedbackEvent();
    expect(row.event_type).toBe("follow_up_doubt");
    expect(row.signal_level).toBe(2);
    expect(row.source).toBe("auto_detect");
  });

  it("writes feedback_events for regenerated with signal_level=3", async () => {
    await learnFromInteraction(MINIMAL_DECISION, "换个说法", DECISION, USER);
    const row = await lastFeedbackEvent();
    expect(row.event_type).toBe("regenerated");
    expect(row.signal_level).toBe(3);
    expect(row.source).toBe("auto_detect");
  });

  it("does NOT write feedback_events when previousDecisionId is null", async () => {
    await learnFromInteraction(MINIMAL_DECISION, "谢谢", null, USER);
    expect(await countFeedbackEvents()).toBe(0);
  });

  it("does NOT write feedback_events when previousDecisionId is undefined", async () => {
    await learnFromInteraction(MINIMAL_DECISION, "谢谢", undefined as unknown as string | null, USER);
    expect(await countFeedbackEvents()).toBe(0);
  });

  it("returns implicit_feedback type in result", async () => {
    const result = await learnFromInteraction(MINIMAL_DECISION, "谢谢", DECISION, USER);
    expect(result.implicit_feedback).toBe("follow_up_thanks");
  });

  it("returns implicit_feedback=null when no pattern matches", async () => {
    const result = await learnFromInteraction(MINIMAL_DECISION, "今天天气怎么样", DECISION, USER);
    expect(result.implicit_feedback).toBeNull();
    expect(await countFeedbackEvents()).toBe(0);
  });

  it("does NOT write feedback_events when userId is omitted (even if pattern matches)", async () => {
    await learnFromInteraction(MINIMAL_DECISION, "谢谢", DECISION);
    expect(await countFeedbackEvents()).toBe(0);
  });

  it("does NOT write feedback_events when message is plain text without trigger", async () => {
    await learnFromInteraction(MINIMAL_DECISION, "帮我写个排序算法", DECISION, USER);
    expect(await countFeedbackEvents()).toBe(0);
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────────

async function lastFeedbackEvent(): Promise<Record<string, unknown>> {
  const { query } = await import("../../src/db/connection.js");
  const result = await query(
    `SELECT id, decision_id, user_id, event_type, signal_level, source, raw_data, created_at
     FROM feedback_events ORDER BY created_at DESC LIMIT 1`
  );
  if (result.rows.length === 0) throw new Error("No rows in feedback_events");
  return result.rows[0];
}

async function countFeedbackEvents(): Promise<number> {
  const { query } = await import("../../src/db/connection.js");
  const result = await query(`SELECT COUNT(*)::int as c FROM feedback_events`);
  return result.rows[0].c;
}

// C2: recordFeedback write-order atomicity
// Verifies that feedback_events is written BEFORE decision_logs.
// This prevents L2/L3 signals from polluting legacy L1 truth when event write fails.
describe("recordFeedback — write-order atomicity (C2)", () => {
  // Seed a minimal decision_log row so DecisionRepo.updateFeedback has a target.
  beforeEach(async () => {
    const { query } = await import("../../src/db/connection.js");
    await query(
      `INSERT INTO decision_logs (id, user_id, session_id, query_preview, intent, complexity_score,
        input_token_count, has_code, has_math, router_version, fast_score, slow_score, confidence,
        selected_model, selected_role, selection_reason, context_original_tokens, context_compressed_tokens,
        compression_level, compression_ratio, model_used, exec_input_tokens, exec_output_tokens,
        total_cost_usd, latency_ms, did_fallback, cost_saved_vs_slow, feedback_score, routing_correct)
       VALUES ($1,$2,$3,'test','simple_qa',2,50,false,false,'v1',0.8,0.3,0.9,
        'gpt-4o-mini','fast','score',100,80,'med',0.8,'gpt-4o-mini',40,20,0.001,120,false,0.002,NULL,null)`,
      [DECISION, USER, randomUUID()]
    );
  });

  it("FeedbackEventRepo.save success → decision_logs.feedback_score is updated", async () => {
    // No mock needed — real DB, should succeed
    await recordFeedback(DECISION, "thumbs_up", USER);

    const { query } = await import("../../src/db/connection.js");
    const result = await query(`SELECT feedback_type, feedback_score FROM decision_logs WHERE id=$1`, [DECISION]);
    expect(result.rows[0].feedback_type).toBe("thumbs_up");
    expect(Number(result.rows[0].feedback_score)).toBe(2);
  });

  it("FeedbackEventRepo.save failure → decision_logs.feedback_score remains NULL (atomicity)", async () => {
    // Mock FeedbackEventRepo.save to throw — simulates DB constraint or network error
    const { FeedbackEventRepo: OriginalRepo } = await import("../../src/db/repositories.js");
    const originalSave = OriginalRepo.save;
    const saveSpy = vi
      .spyOn(OriginalRepo, "save")
      .mockRejectedValueOnce(new Error("Simulated DB write failure"));

    // decision_logs row starts with feedback_score=NULL (set in beforeEach)
    await expect(
      recordFeedback(DECISION, "thumbs_up", USER)
    ).rejects.toThrow("Simulated DB write failure");

    // Verify decision_logs was NOT updated
    const { query } = await import("../../src/db/connection.js");
    const result = await query(`SELECT feedback_type, feedback_score FROM decision_logs WHERE id=$1`, [DECISION]);
    expect(result.rows[0].feedback_type).toBeNull();
    expect(result.rows[0].feedback_score).toBeNull();

    // Restore
    saveSpy.mockRestore();
  });

  it("L2 signal (follow_up_thanks): FeedbackEventRepo.save failure → no isolated decision_logs update", async () => {
    const { FeedbackEventRepo: OriginalRepo } = await import("../../src/db/repositories.js");
    const saveSpy = vi
      .spyOn(OriginalRepo, "save")
      .mockRejectedValueOnce(new Error("Simulated failure"));

    // Without C2 fix this would leave decision_logs with feedback_score=-2 for an L2 signal
    await expect(
      recordFeedback(DECISION, "follow_up_thanks", USER)
    ).rejects.toThrow("Simulated failure");

    const { query } = await import("../../src/db/connection.js");
    const result = await query(`SELECT feedback_score FROM decision_logs WHERE id=$1`, [DECISION]);
    expect(result.rows[0].feedback_score).toBeNull();

    saveSpy.mockRestore();
  });

  it("L3 signal (regenerated): FeedbackEventRepo.save failure → no isolated decision_logs update", async () => {
    const { FeedbackEventRepo: OriginalRepo } = await import("../../src/db/repositories.js");
    const saveSpy = vi
      .spyOn(OriginalRepo, "save")
      .mockRejectedValueOnce(new Error("Simulated failure"));

    await expect(
      recordFeedback(DECISION, "regenerated", USER)
    ).rejects.toThrow("Simulated failure");

    const { query } = await import("../../src/db/connection.js");
    const result = await query(`SELECT feedback_score FROM decision_logs WHERE id=$1`, [DECISION]);
    expect(result.rows[0].feedback_score).toBeNull();

    saveSpy.mockRestore();
  });

  it("no userId → only writes decision_logs (legacy path, unchanged)", async () => {
    await recordFeedback(DECISION, "thumbs_up"); // no userId

    const { query } = await import("../../src/db/connection.js");
    const result = await query(`SELECT feedback_type, feedback_score FROM decision_logs WHERE id=$1`, [DECISION]);
    expect(result.rows[0].feedback_type).toBe("thumbs_up");
    expect(Number(result.rows[0].feedback_score)).toBe(2);

    // feedback_events must remain empty (no userId means no event)
    expect(await countFeedbackEvents()).toBe(0);
  });
});
