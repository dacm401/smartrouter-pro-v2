// workspace: 20260416214742
/**
 * FeedbackEventRepo — Dedicated Unit + Integration Tests
 *
 * Covers:
 *   FeedbackEventRepo.save()        — write feedback_events rows
 *   FeedbackEventRepo.getByDecisionIds() — batch retrieval
 *
 * Infrastructure: tests/db/harness.ts → smartrouter_test DB
 *   Setup:    schema.sql loaded once on vitest startup
 *   Isolation: beforeEach → truncateTables() + COMMIT
 */

import { v4 as uuidv4 } from "uuid";
import { truncateTables } from "../db/harness.js";
import { FeedbackEventRepo } from "../../src/db/repositories.js";
import type { FeedbackType } from "../../src/types/index.js";

const USER = "00000000-0000-0000-0000-000000000001";
const DECISION_A = "00000000-0000-0000-0000-0000000000a1";
const DECISION_B = "00000000-0000-0000-0000-0000000000b2";
const DECISION_C = "00000000-0000-0000-0000-0000000000c3";

// ── Helpers ─────────────────────────────────────────────────────────────────────

async function queryRaw(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
  const { query } = await import("../../src/db/connection.js");
  const result = await query(sql, params);
  return result.rows;
}

beforeEach(async () => {
  await truncateTables();
});

// ── FeedbackEventRepo.save() ─────────────────────────────────────────────────────

describe("FeedbackEventRepo.save — row writes", () => {

  it("auto-generates a UUID id on insert", async () => {
    await FeedbackEventRepo.save({ decisionId: DECISION_A, userId: USER, eventType: "thumbs_up" });
    const rows = await queryRaw(`SELECT id FROM feedback_events`);
    expect(rows.length).toBe(1);
    expect(rows[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it("stores decision_id, user_id, event_type correctly", async () => {
    await FeedbackEventRepo.save({ decisionId: DECISION_A, userId: USER, eventType: "thumbs_down" });
    const rows = await queryRaw(`SELECT decision_id, user_id, event_type FROM feedback_events`);
    expect(rows[0].decision_id).toBe(DECISION_A);
    expect(rows[0].user_id).toBe(USER);
    expect(rows[0].event_type).toBe("thumbs_down");
  });

  // ── signal_level defaults per event type ───────────────────────────────────

  const SIGNAL_CASES: Array<{ eventType: FeedbackType; expected: number }> = [
    { eventType: "thumbs_up",        expected: 1 },
    { eventType: "thumbs_down",      expected: 1 },
    { eventType: "follow_up_thanks",  expected: 2 },
    { eventType: "follow_up_doubt",   expected: 2 },
    { eventType: "regenerated",      expected: 3 },
    { eventType: "edited",           expected: 3 },
    { eventType: "accepted",        expected: 1 },
  ];

  for (const { eventType, expected } of SIGNAL_CASES) {
    it(`${eventType} → signal_level=${expected}`, async () => {
      await FeedbackEventRepo.save({ decisionId: DECISION_A, userId: USER, eventType });
      const rows = await queryRaw(`SELECT signal_level FROM feedback_events`);
      expect(Number(rows[0].signal_level)).toBe(expected);
    });
  }

  it("unknown event_type defaults to signal_level=3, source=system", async () => {
    // @ts-ignore — intentionally passing an invalid event type
    await FeedbackEventRepo.save({ decisionId: DECISION_A, userId: USER, eventType: "unknown_custom_type" });
    const rows = await queryRaw(`SELECT signal_level, source FROM feedback_events`);
    expect(Number(rows[0].signal_level)).toBe(3);
    expect(rows[0].source).toBe("system");
  });

  // ── source defaults per event type ─────────────────────────────────────────

  const SOURCE_CASES: Array<{ eventType: FeedbackType; expected: string }> = [
    { eventType: "thumbs_up",        expected: "ui" },
    { eventType: "thumbs_down",      expected: "ui" },
    { eventType: "follow_up_thanks",  expected: "auto_detect" },
    { eventType: "follow_up_doubt",   expected: "auto_detect" },
    { eventType: "regenerated",      expected: "auto_detect" },
    { eventType: "edited",           expected: "system" },
    { eventType: "accepted",        expected: "system" },
  ];

  for (const { eventType, expected } of SOURCE_CASES) {
    it(`${eventType} → source=${expected}`, async () => {
      await FeedbackEventRepo.save({ decisionId: DECISION_A, userId: USER, eventType });
      const rows = await queryRaw(`SELECT source FROM feedback_events`);
      expect(rows[0].source).toBe(expected);
    });
  }

  // ── raw_data ────────────────────────────────────────────────────────────────

  it("stores rawData as JSONB when provided", async () => {
    const raw = { confidence: 0.8, derived_from: "regex_match" };
    await FeedbackEventRepo.save({
      decisionId: DECISION_A,
      userId: USER,
      eventType: "follow_up_thanks",
      rawData: raw,
    });
    const rows = await queryRaw(`SELECT raw_data FROM feedback_events`);
    expect(rows[0].raw_data).toEqual(raw);
  });

  it("stores raw_data as NULL when rawData is omitted", async () => {
    await FeedbackEventRepo.save({ decisionId: DECISION_A, userId: USER, eventType: "thumbs_up" });
    const rows = await queryRaw(`SELECT raw_data FROM feedback_events`);
    expect(rows[0].raw_data).toBeNull();
  });

  it("handles complex nested rawData object", async () => {
    const raw = { confidence: 0.7, matched_patterns: ["谢谢", "感谢"], context: { session_id: "sess-1", turn: 3 } };
    await FeedbackEventRepo.save({
      decisionId: DECISION_A,
      userId: USER,
      eventType: "follow_up_doubt",
      rawData: raw,
    });
    const rows = await queryRaw(`SELECT raw_data FROM feedback_events`);
    expect(rows[0].raw_data).toEqual(raw);
  });

  // ── multiple writes ────────────────────────────────────────────────────────

  it("can write multiple events for different decisions without conflict", async () => {
    await FeedbackEventRepo.save({ decisionId: DECISION_A, userId: USER, eventType: "thumbs_up" });
    await FeedbackEventRepo.save({ decisionId: DECISION_B, userId: USER, eventType: "thumbs_down" });
    await FeedbackEventRepo.save({ decisionId: DECISION_C, userId: USER, eventType: "follow_up_thanks" });
    const rows = await queryRaw(`SELECT decision_id, event_type FROM feedback_events`);
    expect(rows.length).toBe(3);
    const ids = new Set(rows.map((r: any) => r.decision_id));
    expect(ids.has(DECISION_A)).toBe(true);
    expect(ids.has(DECISION_B)).toBe(true);
    expect(ids.has(DECISION_C)).toBe(true);
  });

  it("can write multiple events for the same decision_id (different users)", async () => {
    const USER_2 = "00000000-0000-0000-0000-000000000002";
    await FeedbackEventRepo.save({ decisionId: DECISION_A, userId: USER, eventType: "thumbs_up" });
    await FeedbackEventRepo.save({ decisionId: DECISION_A, userId: USER_2, eventType: "thumbs_down" });
    const rows = await queryRaw(`SELECT user_id, event_type FROM feedback_events WHERE decision_id=$1`, [DECISION_A]);
    expect(rows.length).toBe(2);
  });
});

// ── FeedbackEventRepo.getByDecisionIds() ────────────────────────────────────────

describe("FeedbackEventRepo.getByDecisionIds — batch retrieval", () => {

  it("returns empty Map when given an empty array", async () => {
    const result = await FeedbackEventRepo.getByDecisionIds(USER, []);
    expect(result.size).toBe(0);
  });

  it("returns empty Map when no events exist for the given decision IDs", async () => {
    const result = await FeedbackEventRepo.getByDecisionIds(USER, [DECISION_A, DECISION_B]);
    expect(result.size).toBe(0);
  });

  it("returns Map with correct signal_level for each event", async () => {
    await FeedbackEventRepo.save({ decisionId: DECISION_A, userId: USER, eventType: "thumbs_up" });     // L1
    await FeedbackEventRepo.save({ decisionId: DECISION_B, userId: USER, eventType: "follow_up_thanks" }); // L2

    const result = await FeedbackEventRepo.getByDecisionIds(USER, [DECISION_A, DECISION_B]);

    expect(result.size).toBe(2);
    expect(result.get(DECISION_A)).toBe(1); // L1
    expect(result.get(DECISION_B)).toBe(2); // L2
  });

  it("filters by user_id — does not return events from other users", async () => {
    const USER_2 = "00000000-0000-0000-0000-000000000002";
    await FeedbackEventRepo.save({ decisionId: DECISION_A, userId: USER, eventType: "thumbs_up" });
    await FeedbackEventRepo.save({ decisionId: DECISION_A, userId: USER_2, eventType: "thumbs_down" });

    const result = await FeedbackEventRepo.getByDecisionIds(USER, [DECISION_A]);

    expect(result.size).toBe(1);
    expect(result.get(DECISION_A)).toBe(1); // USER's event, not USER_2's
  });

  it("decision_id not in the requested list is NOT returned", async () => {
    await FeedbackEventRepo.save({ decisionId: DECISION_A, userId: USER, eventType: "thumbs_up" });
    await FeedbackEventRepo.save({ decisionId: DECISION_B, userId: USER, eventType: "thumbs_down" });

    const result = await FeedbackEventRepo.getByDecisionIds(USER, [DECISION_A]); // only ask for A

    expect(result.size).toBe(1);
    expect(result.has(DECISION_A)).toBe(true);
    expect(result.has(DECISION_B)).toBe(false);
  });

  // ── multiple events per decision_id: lowest signal_level wins ─────────────

  it("multiple events for same decision_id: lowest signal_level (most trustworthy) wins", async () => {
    // Simulate duplicate events — save same decision with different signal levels
    // (real flow shouldn't produce duplicates, but repo guards against it)
    const { query } = await import("../../src/db/connection.js");
    await query(
      `INSERT INTO feedback_events (id, decision_id, user_id, event_type, signal_level, source, raw_data)
       VALUES ($1,$2,$3,'thumbs_up',1,'ui',NULL),
              ($4,$2,$3,'thumbs_down',1,'ui',NULL),
              ($5,$2,$3,'regenerated',3,'auto_detect',NULL)`,
      [uuidv4(), DECISION_A, USER, uuidv4(), uuidv4()]
    );

    const result = await FeedbackEventRepo.getByDecisionIds(USER, [DECISION_A]);

    // Lowest signal_level among duplicates: min(1, 1, 3) = 1
    expect(result.get(DECISION_A)).toBe(1);
  });

  it("multiple events for same decision_id: when all are L2/L3, lowest number wins", async () => {
    const { query } = await import("../../src/db/connection.js");
    await query(
      `INSERT INTO feedback_events (id, decision_id, user_id, event_type, signal_level, source, raw_data)
       VALUES ($1,$2,$3,'follow_up_thanks',2,'auto_detect',NULL),
              ($4,$2,$3,'regenerated',3,'auto_detect',NULL)`,
      [uuidv4(), DECISION_A, USER, uuidv4()]
    );

    const result = await FeedbackEventRepo.getByDecisionIds(USER, [DECISION_A]);

    // Lowest: min(2, 3) = 2
    expect(result.get(DECISION_A)).toBe(2);
  });

  // ── large batch ───────────────────────────────────────────────────────────

  it("handles 50+ decision IDs in a single call", async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`);
    for (let i = 0; i < ids.length; i++) {
      await FeedbackEventRepo.save({
        decisionId: ids[i],
        userId: USER,
        eventType: i % 2 === 0 ? "thumbs_up" : "follow_up_doubt",
      });
    }

    const result = await FeedbackEventRepo.getByDecisionIds(USER, ids);

    expect(result.size).toBe(50);
    for (let i = 0; i < ids.length; i++) {
      const expected = i % 2 === 0 ? 1 : 2;
      expect(result.get(ids[i])).toBe(expected);
    }
  });

  it("returns Map with all signal levels represented correctly", async () => {
    await FeedbackEventRepo.save({ decisionId: DECISION_A, userId: USER, eventType: "thumbs_up" });         // L1
    await FeedbackEventRepo.save({ decisionId: DECISION_B, userId: USER, eventType: "follow_up_thanks" });   // L2
    await FeedbackEventRepo.save({ decisionId: DECISION_C, userId: USER, eventType: "regenerated" });         // L3

    const result = await FeedbackEventRepo.getByDecisionIds(USER, [DECISION_A, DECISION_B, DECISION_C]);

    expect(result.get(DECISION_A)).toBe(1);
    expect(result.get(DECISION_B)).toBe(2);
    expect(result.get(DECISION_C)).toBe(3);
  });
});

// ── Cross-method integration ───────────────────────────────────────────────────

describe("FeedbackEventRepo — save + getByDecisionIds integration", () => {

  it("save then getByDecisionIds reflects the written data", async () => {
    await FeedbackEventRepo.save({
      decisionId: DECISION_A,
      userId: USER,
      eventType: "follow_up_doubt",
      rawData: { confidence: 0.7, matched: "你确定吗" },
    });

    const result = await FeedbackEventRepo.getByDecisionIds(USER, [DECISION_A]);

    expect(result.size).toBe(1);
    expect(result.get(DECISION_A)).toBe(2); // L2 for follow_up_doubt
  });

  it("getByDecisionIds returns only events matching both user_id AND decision_id", async () => {
    const USER_2 = "00000000-0000-0000-0000-000000000002";

    // USER events
    await FeedbackEventRepo.save({ decisionId: DECISION_A, userId: USER, eventType: "thumbs_up" });
    await FeedbackEventRepo.save({ decisionId: DECISION_B, userId: USER, eventType: "thumbs_down" });

    // USER_2 events
    await FeedbackEventRepo.save({ decisionId: DECISION_A, userId: USER_2, eventType: "accepted" });
    await FeedbackEventRepo.save({ decisionId: DECISION_C, userId: USER_2, eventType: "edited" });

    // Query as USER for A and B
    const result = await FeedbackEventRepo.getByDecisionIds(USER, [DECISION_A, DECISION_B, DECISION_C]);

    expect(result.size).toBe(2); // only USER's events
    expect(result.get(DECISION_A)).toBe(1); // thumbs_up (L1)
    expect(result.get(DECISION_B)).toBe(1); // thumbs_down (L1)
    expect(result.has(DECISION_C)).toBe(false); // USER doesn't have event on C
  });
});
