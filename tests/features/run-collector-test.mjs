/**
 * Direct test runner for feedback-collector P4 tests.
 * Uses createRequire for reliable module resolution in ESM context.
 */
import { createRequire } from "module";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);

const { truncateTables } = require(`${BACKEND}/tests/db/harness.js`);
const { FeedbackEventRepo } = require(`${BACKEND}/src/db/repositories.js`);
const { detectImplicitFeedback, recordFeedback } = require(`${BACKEND}/src/features/feedback-collector.js`);
const { learnFromInteraction } = require(`${BACKEND}/src/features/learning-engine.js`);

// Set DATABASE_URL before importing app modules
const dbUrl = process.env.DATABASE_URL?.replace(/\/[^/]+\?/, "/smartrouter_test?") ??
  "postgresql://postgres:postgres@localhost:5432/smartrouter_test";

const USER = "00000000-0000-0000-0000-000000000001";
const DECISION = "00000000-0000-0000-0000-000000000002";

let passed = 0;
let failed = 0;

function expect(actual, expected, msg) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (pass) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.log(`  ✗ ${msg}`); console.log(`    Expected: ${JSON.stringify(expected)}`); console.log(`    Got: ${JSON.stringify(actual)}`); }
}
function expectTruthy(actual, msg) {
  if (actual) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.log(`  ✗ ${msg} (falsy)`); }
}
function expectFalsy(actual, msg) {
  if (!actual) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.log(`  ✗ ${msg} (truthy: ${actual})`); }
}

async function lastFeedbackEvent() {
  const { query } = require(`${BACKEND}/src/db/connection.js`);
  const result = await query(
    `SELECT id, decision_id, user_id, event_type, signal_level, source, raw_data, created_at
     FROM feedback_events ORDER BY created_at DESC LIMIT 1`
  );
  if (result.rows.length === 0) throw new Error("No rows in feedback_events");
  return result.rows[0];
}

async function countFeedbackEvents() {
  const { query } = require(`${BACKEND}/src/db/connection.js`);
  const result = await query(`SELECT COUNT(*)::int as c FROM feedback_events`);
  return result.rows[0].c;
}

// ── 1. detectImplicitFeedback regex tests ─────────────────────────────────────

console.log("\n[1] detectImplicitFeedback — regex patterns");

const CASES = [
  ["follow_up_thanks", ["谢谢", "感谢", "太好了", "很好", "perfect", "thanks", "great awesome"]],
  ["follow_up_doubt",  ["你确定吗", "不对", "错了", "are you sure"]],
  ["regenerated",     ["再说一遍", "换个说法", "换个方式表达", "try again", "rephrase"]],
  ["null",            ["今天天气不错", "帮我写个排序算法", "什么是量子纠缠"]],
];

for (const [expected, texts] of CASES) {
  for (const text of texts) {
    const result = detectImplicitFeedback(text, DECISION);
    expect(result?.type ?? null, expected === "null" ? null : expected, `"${text}" → ${expected}`);
    if (result && expected !== "null") expectTruthy(result.confidence >= 0.6, `"${text}" confidence >= 0.6`);
  }
}

expectFalsy(detectImplicitFeedback("谢谢", null), "returns null when previousDecisionId is null");
expectFalsy(detectImplicitFeedback("谢谢", undefined), "returns null when previousDecisionId is undefined");

const thanks = detectImplicitFeedback("谢谢", DECISION);
const doubt  = detectImplicitFeedback("你确定吗", DECISION);
const regen  = detectImplicitFeedback("再说一遍", DECISION);
expect(thanks?.confidence, 0.8, "follow_up_thanks confidence = 0.8");
expect(doubt?.confidence,  0.7, "follow_up_doubt confidence = 0.7");
expect(regen?.confidence,  0.6, "regenerated confidence = 0.6");
expect(detectImplicitFeedback("THANKS", DECISION)?.type, "follow_up_thanks", "case-insensitive THANKS");
expect(detectImplicitFeedback("ARE YOU SURE", DECISION)?.type, "follow_up_doubt", "case-insensitive ARE YOU SURE");

// ── 2. recordFeedback — implicit types ───────────────────────────────────────

console.log("\n[2] recordFeedback — implicit types to feedback_events");

await truncateTables();

for (const eventType of ["follow_up_thanks", "follow_up_doubt", "regenerated"]) {
  await recordFeedback(DECISION, eventType, USER);
  const row = await lastFeedbackEvent();
  expect(row.source, "auto_detect", `${eventType} source=auto_detect`);
  expect(row.decision_id, DECISION, `${eventType} decision_id`);
  expect(row.user_id, USER, `${eventType} user_id`);
  expect(row.event_type, eventType, `${eventType} event_type`);
}

await truncateTables();
await recordFeedback(DECISION, "follow_up_thanks", USER);
expect((await lastFeedbackEvent()).signal_level, 2, "follow_up_thanks signal_level=2");

await truncateTables();
await recordFeedback(DECISION, "follow_up_doubt", USER);
expect((await lastFeedbackEvent()).signal_level, 2, "follow_up_doubt signal_level=2");

await truncateTables();
await recordFeedback(DECISION, "regenerated", USER);
expect((await lastFeedbackEvent()).signal_level, 3, "regenerated signal_level=3");

await truncateTables();
await recordFeedback(DECISION, "follow_up_thanks", USER, { confidence: 0.8, source: "regex" });
expect((await lastFeedbackEvent()).raw_data, { confidence: 0.8, source: "regex" }, "rawData stored as JSONB");

await truncateTables();
await recordFeedback(DECISION, "follow_up_thanks");
expect(await countFeedbackEvents(), 0, "no write when userId omitted");

// ── 3. learnFromInteraction wiring ───────────────────────────────────────────

console.log("\n[3] learnFromInteraction — implicit feedback wiring");

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
    compression_level: "none",
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

await truncateTables();
await learnFromInteraction(MINIMAL_DECISION, "谢谢", DECISION, USER);
let row = await lastFeedbackEvent();
expect(row.source, "auto_detect", "learn: thanks → source=auto_detect");
expect(row.event_type, "follow_up_thanks", "learn: thanks → event_type");
expect(row.signal_level, 2, "learn: thanks → signal_level=2");
expect(row.decision_id, DECISION, "learn: thanks → decision_id");
expect(row.user_id, USER, "learn: thanks → user_id");

await truncateTables();
await learnFromInteraction(MINIMAL_DECISION, "换个说法", DECISION, USER);
row = await lastFeedbackEvent();
expect(row.event_type, "regenerated", "learn: regenerated event_type");
expect(row.signal_level, 3, "learn: regenerated signal_level=3");
expect(row.source, "auto_detect", "learn: regenerated source");

await truncateTables();
const result1 = await learnFromInteraction(MINIMAL_DECISION, "谢谢", null, USER);
expect(result1.implicit_feedback, null, "learn: implicit_feedback=null when no prevDecisionId");
expect(await countFeedbackEvents(), 0, "learn: no write when previousDecisionId=null");

await truncateTables();
const result2 = await learnFromInteraction(MINIMAL_DECISION, "今天天气怎么样", DECISION, USER);
expect(result2.implicit_feedback, null, "learn: implicit_feedback=null when no pattern");
expect(await countFeedbackEvents(), 0, "learn: no write when no pattern matches");

await truncateTables();
const result3 = await learnFromInteraction(MINIMAL_DECISION, "谢谢", DECISION);
expect(await countFeedbackEvents(), 0, "learn: no write when userId omitted");

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
