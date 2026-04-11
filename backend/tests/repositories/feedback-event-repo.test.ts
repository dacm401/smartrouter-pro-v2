/**
 * P3 (Sprint 14): FeedbackEventRepo Tests
 *
 * Validates:
 *   - FeedbackEventRepo.save() writes rows to feedback_events
 *   - signal_level / source are assigned correctly per event_type
 *   - raw_data JSONB field is stored and retrievable
 *   - FK constraint: unknown decision_id is tolerated (no FK constraint in schema)
 *
 * Infrastructure: tests/db/harness.ts
 *   Setup:  DATABASE_URL → smartrouter_test
 *   Schema: CREATE TABLE IF NOT EXISTS on startup (idempotent)
 *   Isolation: beforeEach → truncateTables() → COMMIT
 */

import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { truncateTables } from "../db/harness.js";
import { FeedbackEventRepo } from "../../src/db/repositories.js";

const USER = "00000000-0000-0000-0000-000000000001";
const DECISION = "00000000-0000-0000-0000-000000000002";

beforeEach(async () => {
  await truncateTables();
});

// ── Signal level mapping ───────────────────────────────────────────────────────

describe("FeedbackEventRepo — signal_level assignment", () => {
  it("thumbs_up → signal_level=1, source=ui", async () => {
    await FeedbackEventRepo.save({ decisionId: DECISION, userId: USER, eventType: "thumbs_up" });
    const row = await getLastRow();
    expect(row.signal_level).toBe(1);
    expect(row.source).toBe("ui");
  });

  it("thumbs_down → signal_level=1, source=ui", async () => {
    await FeedbackEventRepo.save({ decisionId: DECISION, userId: USER, eventType: "thumbs_down" });
    const row = await getLastRow();
    expect(row.signal_level).toBe(1);
    expect(row.source).toBe("ui");
  });

  it("follow_up_thanks → signal_level=2, source=auto_detect", async () => {
    await FeedbackEventRepo.save({ decisionId: DECISION, userId: USER, eventType: "follow_up_thanks" });
    const row = await getLastRow();
    expect(row.signal_level).toBe(2);
    expect(row.source).toBe("auto_detect");
  });

  it("follow_up_doubt → signal_level=2, source=auto_detect", async () => {
    await FeedbackEventRepo.save({ decisionId: DECISION, userId: USER, eventType: "follow_up_doubt" });
    const row = await getLastRow();
    expect(row.signal_level).toBe(2);
    expect(row.source).toBe("auto_detect");
  });

  it("regenerated → signal_level=3, source=auto_detect", async () => {
    await FeedbackEventRepo.save({ decisionId: DECISION, userId: USER, eventType: "regenerated" });
    const row = await getLastRow();
    expect(row.signal_level).toBe(3);
    expect(row.source).toBe("auto_detect");
  });

  it("edited → signal_level=3, source=system", async () => {
    await FeedbackEventRepo.save({ decisionId: DECISION, userId: USER, eventType: "edited" });
    const row = await getLastRow();
    expect(row.signal_level).toBe(3);
    expect(row.source).toBe("system");
  });

  it("accepted → signal_level=1, source=system", async () => {
    await FeedbackEventRepo.save({ decisionId: DECISION, userId: USER, eventType: "accepted" });
    const row = await getLastRow();
    expect(row.signal_level).toBe(1);
    expect(row.source).toBe("system");
  });

  it("unknown type → signal_level=3 (default), source=system", async () => {
    await FeedbackEventRepo.save({ decisionId: DECISION, userId: USER, eventType: "fake_type" });
    const row = await getLastRow();
    expect(row.signal_level).toBe(3);
    expect(row.source).toBe("system");
  });
});

// ── Core fields ───────────────────────────────────────────────────────────────

describe("FeedbackEventRepo — core fields", () => {
  it("stores decision_id correctly", async () => {
    await FeedbackEventRepo.save({ decisionId: DECISION, userId: USER, eventType: "thumbs_up" });
    const row = await getLastRow();
    expect(row.decision_id).toBe(DECISION);
  });

  it("stores user_id correctly", async () => {
    await FeedbackEventRepo.save({ decisionId: DECISION, userId: USER, eventType: "thumbs_down" });
    const row = await getLastRow();
    expect(row.user_id).toBe(USER);
  });

  it("stores event_type correctly", async () => {
    await FeedbackEventRepo.save({ decisionId: DECISION, userId: USER, eventType: "regenerated" });
    const row = await getLastRow();
    expect(row.event_type).toBe("regenerated");
  });

  it("generates a UUID id", async () => {
    await FeedbackEventRepo.save({ decisionId: DECISION, userId: USER, eventType: "thumbs_up" });
    const row = await getLastRow();
    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it("sets created_at", async () => {
    await FeedbackEventRepo.save({ decisionId: DECISION, userId: USER, eventType: "thumbs_up" });
    const row = await getLastRow();
    expect(row.created_at).toBeInstanceOf(Date);
  });

  it("accepts rawData and stores as JSONB", async () => {
    await FeedbackEventRepo.save({
      decisionId: DECISION,
      userId: USER,
      eventType: "thumbs_up",
      rawData: { confidence: 0.9, source: "button_click" },
    });
    const row = await getLastRow();
    expect(row.raw_data).toEqual({ confidence: 0.9, source: "button_click" });
  });

  it("sets raw_data to null when rawData is omitted", async () => {
    await FeedbackEventRepo.save({ decisionId: DECISION, userId: USER, eventType: "thumbs_up" });
    const row = await getLastRow();
    expect(row.raw_data).toBeNull();
  });
});

// ── getByDecisionIds (P5) ───────────────────────────────────────────────────────

/**
 * P5 Sprint 14: FeedbackEventRepo.getByDecisionIds() — batch query of signal_level.
 * Returns Map<decisionId, signal_level>.
 *
 * Routing:
 *   L1 (signal_level=1): thumbs_up, thumbs_down, accepted
 *   L2 (signal_level=2): follow_up_thanks, follow_up_doubt
 *   L3 (signal_level=3): regenerated, edited, unknown types
 *
 * Guard: if multiple events exist for the same decision_id, lowest signal_level wins
 * (most trustworthy signal).
 */
describe("FeedbackEventRepo — getByDecisionIds (P5)", () => {
  const d1 = "11111111-1111-1111-1111-000000000001"; // thumbs_up → L1
  const d2 = "11111111-1111-1111-1111-000000000002"; // follow_up_thanks → L2
  const d3 = "11111111-1111-1111-1111-000000000003"; // regenerated → L3
  const d4 = "11111111-1111-1111-1111-000000000004"; // thumbs_down → L1
  const d5 = "11111111-1111-1111-1111-000000000005"; // no event

  beforeEach(async () => {
    await truncateTables();
    // Insert events for d1, d2, d3, d4 (no event for d5)
    await FeedbackEventRepo.save({ decisionId: d1, userId: USER, eventType: "thumbs_up" });
    await FeedbackEventRepo.save({ decisionId: d2, userId: USER, eventType: "follow_up_thanks" });
    await FeedbackEventRepo.save({ decisionId: d3, userId: USER, eventType: "regenerated" });
    await FeedbackEventRepo.save({ decisionId: d4, userId: USER, eventType: "thumbs_down" });
  });

  it("returns correct signal_level for each decision_id", async () => {
    const map = await FeedbackEventRepo.getByDecisionIds(USER, [d1, d2, d3, d4]);
    expect(map.get(d1)).toBe(1); // thumbs_up → L1
    expect(map.get(d2)).toBe(2); // follow_up_thanks → L2
    expect(map.get(d3)).toBe(3); // regenerated → L3
    expect(map.get(d4)).toBe(1); // thumbs_down → L1
  });

  it("decision with no event is absent from map (not present at all)", async () => {
    const map = await FeedbackEventRepo.getByDecisionIds(USER, [d1, d5]);
    expect(map.has(d1)).toBe(true);
    expect(map.has(d5)).toBe(false);
    expect(map.size).toBe(1);
  });

  it("returns empty Map for nonexistent user", async () => {
    const map = await FeedbackEventRepo.getByDecisionIds("nonexistent-user", [d1]);
    expect(map.size).toBe(0);
  });

  it("returns empty Map for empty decisionIds array", async () => {
    const map = await FeedbackEventRepo.getByDecisionIds(USER, []);
    expect(map.size).toBe(0);
  });

  it("multiple events for same decision_id: lowest signal_level wins", async () => {
    // Save a second event for d1 with L2 signal
    await FeedbackEventRepo.save({ decisionId: d1, userId: USER, eventType: "follow_up_doubt" });
    const map = await FeedbackEventRepo.getByDecisionIds(USER, [d1]);
    // thumbs_up (L1) vs follow_up_doubt (L2) → L1 wins (lower = stronger)
    expect(map.get(d1)).toBe(1);
  });

  it("filters by user_id — other user's events are not returned", async () => {
    const OTHER_USER = "22222222-2222-2222-2222-000000000001";
    await FeedbackEventRepo.save({ decisionId: d1, userId: OTHER_USER, eventType: "thumbs_down" });
    const map = await FeedbackEventRepo.getByDecisionIds(USER, [d1]);
    // Only USER's thumbs_up (L1), NOT OTHER_USER's thumbs_down
    expect(map.get(d1)).toBe(1);
    expect(map.size).toBe(1);
  });
});

// ── Helper ─────────────────────────────────────────────────────────────────────

async function getLastRow(): Promise<Record<string, unknown>> {
  const { query } = await import("../../src/db/connection.js");
  const result = await query(
    `SELECT id, decision_id, user_id, event_type, signal_level, source, raw_data, created_at
     FROM feedback_events ORDER BY created_at DESC LIMIT 1`
  );
  if (result.rows.length === 0) throw new Error("No rows in feedback_events");
  return result.rows[0];
}
