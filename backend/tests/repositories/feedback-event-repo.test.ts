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
