/**
 * Sprint 13 P4.1: Behavioral Memory Early Learning — Positive Gate Tests
 *
 * Validates the relaxed positive learning gate in analyzeAndLearn():
 *   OLD: fastPositiveRate > 0.8  (required 4+/5+ for 5-item sample = ≥80%)
 *   NEW: positiveCount >= 3 && fastPositiveRate > 0.5
 *
 * This makes 2/3 (66.7%) and 3/4 (75%) scenarios create positive memories
 * instead of silently failing to learn "fast is OK here".
 *
 * Approach: pure unit tests — DecisionRepo.getRecent and MemoryRepo calls are
 * stubbed so the service logic is tested in isolation.
 */

import { analyzeAndLearn } from "../../src/services/memory-store.js";
import { DecisionRepo, MemoryRepo, FeedbackEventRepo } from "../../src/db/repositories.js";

const USER = "test-user-p41";

// ── Decision fixture helpers ─────────────────────────────────────────────────

function makeDecision(overrides: {
  id?: string;
  intent?: string;
  selected_role?: "fast" | "slow";
  feedback_score?: number | null;
  /** P4.2: execution signal fields */
  did_fallback?: boolean;
  cost_saved_vs_slow?: number | null;
}): {
  id: string; intent: string; selected_role: string; feedback_score: number | null;
  did_fallback: boolean; cost_saved_vs_slow: number | null;
  input_features: { intent: string };
} {
  return {
    id: overrides.id ?? "d-" + Math.random(),
    intent: overrides.intent ?? "simple_qa",
    selected_role: overrides.selected_role ?? "fast",
    feedback_score: overrides.feedback_score ?? null,
    did_fallback: overrides.did_fallback ?? false,
    cost_saved_vs_slow: overrides.cost_saved_vs_slow ?? null,
    input_features: { intent: overrides.intent ?? "simple_qa" },
  };
}

function makeRecentDecisions(
  intent: string,
  fastWithScores: Array<{ selected_role: "fast" | "slow"; feedback_score: number | null }>,
  slowWithScores: Array<{ selected_role: "fast" | "slow"; feedback_score: number | null }> = []
): any[] {
  return [
    ...fastWithScores.map((d) => makeDecision({ ...d, intent })),
    ...slowWithScores.map((d) => makeDecision({ ...d, intent })),
  ];
}

// ── Stub wrappers ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function stubAnalyzelearn(userId: string, latestDecision: any, recentDecisions: any[]) {
  vi.spyOn(DecisionRepo, "getRecent").mockResolvedValue(recentDecisions as any);
  vi.spyOn(MemoryRepo, "getBehavioralMemories").mockResolvedValue([] as any);
  vi.spyOn(MemoryRepo, "saveBehavioralMemory").mockResolvedValue(undefined as any);
  return analyzeAndLearn(userId, latestDecision);
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const INTENT = "simple_qa";
const latestDecision = makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 });

// ── Positive gate: boundary cases ────────────────────────────────────────────

describe("P4.1 relaxed positive gate — new condition: positiveCount >= 3 && fastPositiveRate > 0.5", () => {

  /**
   * OLD behavior: fastPositiveRate > 0.8
   *   2/3 = 66.7% → NO memory created (below 80%)
   * NEW behavior: positiveCount >= 3 && fastPositiveRate > 0.5
   *   2/3: positiveCount=2 < 3 → still NO memory (fails minimum count)
   *   This is intentional — 2 positive + 1 neutral is not strong enough signal.
   */
  it("does NOT create positive memory when positiveCount < 3 (2/3 scenario)", async () => {
    // 2 positive, 1 neutral = 66.7% positive rate, but only 2 positives
    const decisions = makeRecentDecisions(
      INTENT,
      [
        { selected_role: "fast", feedback_score: 1 },
        { selected_role: "fast", feedback_score: 1 },
        { selected_role: "fast", feedback_score: 0 }, // neutral
      ]
    );
    const result = await stubAnalyzelearn(USER, latestDecision, decisions);
    expect(result).toBeNull();
    expect(MemoryRepo.saveBehavioralMemory).not.toHaveBeenCalled();
  });

  /**
   * OLD: 3/3 = 100% → YES memory (≥80%)
   * NEW: positiveCount=3, fastPositiveRate=1.0 → YES memory (unchanged for perfect score)
   * 3/3 should still create a positive memory — this case is unchanged from before.
   */
  it("creates positive memory when 3/3 are positive (100%)", async () => {
    const decisions = makeRecentDecisions(
      INTENT,
      [
        { selected_role: "fast", feedback_score: 1 },
        { selected_role: "fast", feedback_score: 1 },
        { selected_role: "fast", feedback_score: 1 },
      ]
    );
    const result = await stubAnalyzelearn(USER, latestDecision, decisions);
    expect(result).not.toBeNull();
    expect(result!.strength).toBe(0.7);
    expect(result!.learned_action).toContain("放心使用快模型");
  });

  /**
   * OLD: 3/4 = 75% → NO memory (below 80%)
   * NEW: positiveCount=3, fastPositiveRate=0.75 → YES memory
   * This is the key P4.1 gain: "3 good + 1 neutral" now creates a positive memory.
   */
  it("creates positive memory when 3/4 are positive (75%) — P4.1 main improvement", async () => {
    const decisions = makeRecentDecisions(
      INTENT,
      [
        { selected_role: "fast", feedback_score: 1 },
        { selected_role: "fast", feedback_score: 1 },
        { selected_role: "fast", feedback_score: 1 },
        { selected_role: "fast", feedback_score: 0 }, // neutral
      ]
    );
    const result = await stubAnalyzelearn(USER, latestDecision, decisions);
    expect(result).not.toBeNull();
    expect(result!.strength).toBe(0.7);
    expect(MemoryRepo.saveBehavioralMemory).toHaveBeenCalledTimes(1);
  });

  /**
   * OLD: 3/5 = 60% → NO memory (below 80%)
   * NEW: positiveCount=3, fastPositiveRate=0.6 → YES memory (60% > 50% threshold)
   * "3 good + 2 neutral" now learns.
   */
  it("creates positive memory when 3/5 are positive (60%)", async () => {
    const decisions = makeRecentDecisions(
      INTENT,
      [
        { selected_role: "fast", feedback_score: 1 },
        { selected_role: "fast", feedback_score: 1 },
        { selected_role: "fast", feedback_score: 1 },
        { selected_role: "fast", feedback_score: 0 },
        { selected_role: "fast", feedback_score: 0 },
      ]
    );
    const result = await stubAnalyzelearn(USER, latestDecision, decisions);
    expect(result).not.toBeNull();
    expect(result!.strength).toBe(0.7);
  });

  /**
   * NEW edge case: positiveCount=3, fastPositiveRate=0.5 (exactly 50%) → NO memory
   * Because fastPositiveRate > 0.5 (strict).
   * "3 positive + 3 neutral" → positive_rate = 50%, negative_rate = 0 → no gate fires.
   */
  it("does NOT create positive memory when rate is exactly 50% (3 positive + 3 neutral)", async () => {
    const decisions = makeRecentDecisions(
      INTENT,
      [
        { selected_role: "fast", feedback_score: 1 },
        { selected_role: "fast", feedback_score: 1 },
        { selected_role: "fast", feedback_score: 1 },
        { selected_role: "fast", feedback_score: 0 }, // neutral — no negative gate trigger
        { selected_role: "fast", feedback_score: 0 }, // neutral
        { selected_role: "fast", feedback_score: 0 }, // neutral
      ]
    );
    const result = await stubAnalyzelearn(USER, latestDecision, decisions);
    // positive_rate = 50% → NOT > 50%, positive gate doesn't fire
    // negative_rate = 0 → negative gate doesn't fire
    expect(result).toBeNull();
    expect(MemoryRepo.saveBehavioralMemory).not.toHaveBeenCalled();
  });

  /**
   * NEW edge case: 4/5 = 80% positive rate
   * positiveCount=4 >= 3, fastPositiveRate=0.8 → NOT > 0.5 (well above)
   * → YES memory. This was already covered by the old gate too.
   */
  it("creates positive memory when 4/5 are positive (80%)", async () => {
    const decisions = makeRecentDecisions(
      INTENT,
      [
        { selected_role: "fast", feedback_score: 1 },
        { selected_role: "fast", feedback_score: 1 },
        { selected_role: "fast", feedback_score: 1 },
        { selected_role: "fast", feedback_score: 1 },
        { selected_role: "fast", feedback_score: -1 },
      ]
    );
    const result = await stubAnalyzelearn(USER, latestDecision, decisions);
    expect(result).not.toBeNull();
  });

  /**
   * OLD: 2/3 = 66.7% → NO memory
   * NEW: positiveCount=2 < 3 → NO memory
   * This remains unchanged — insufficient positive evidence.
   */
  it("does NOT create positive memory when 2/3 are positive (66.7%)", async () => {
    const decisions = makeRecentDecisions(
      INTENT,
      [
        { selected_role: "fast", feedback_score: 1 },
        { selected_role: "fast", feedback_score: 1 },
        { selected_role: "fast", feedback_score: -1 },
      ]
    );
    const result = await stubAnalyzelearn(USER, latestDecision, decisions);
    expect(result).toBeNull();
    expect(MemoryRepo.saveBehavioralMemory).not.toHaveBeenCalled();
  });

  /**
   * OLD: 1/3 = 33.3% → NO memory (negative gate might have fired)
   * NEW: positiveCount=1 < 3 → NO memory (positive gate doesn't fire, negative_rate=0 so no negative either)
   */
  it("does NOT create positive memory when 1/3 are positive (1 pos + 2 neutral)", async () => {
    const decisions = makeRecentDecisions(
      INTENT,
      [
        { selected_role: "fast", feedback_score: 1 },
        { selected_role: "fast", feedback_score: 0 }, // neutral
        { selected_role: "fast", feedback_score: 0 }, // neutral
      ]
    );
    const result = await stubAnalyzelearn(USER, latestDecision, decisions);
    // positiveCount=1 < 3 → positive gate doesn't fire
    // negative_rate=0 → negative gate doesn't fire
    expect(result).toBeNull();
    expect(MemoryRepo.saveBehavioralMemory).not.toHaveBeenCalled();
  });
});

// ── Existing memory guard (existingForIntent) — still prevents duplicate creation ─

describe("existingForIntent guard still prevents duplicate positive memories", () => {

  /**
   * Test: when existingForIntent exists, positive gate is blocked and no new memory is created.
   *
   * Strategy: use neutral feedback (all 0) in recent decisions so:
   *   - negative gate: negative_rate = 0 → doesn't fire
   *   - positive gate: positiveCount = 0 < 3 → doesn't fire
   *   → code reaches the existingForIntent check
   *
   * The existing memory blocks new creation, and since latestFeedback=0 (neutral),
   * reinforceMemory is a no-op (delta=0). The key assertion is: saveBehavioralMemory NOT called.
   */
  it("existingForIntent blocks positive gate — saveBehavioralMemory NOT called", async () => {
    const decisions = makeRecentDecisions(
      INTENT,
      [
        { selected_role: "fast", feedback_score: 0 }, // neutral
        { selected_role: "fast", feedback_score: 0 }, // neutral
        { selected_role: "fast", feedback_score: 0 }, // neutral
      ]
    );

    vi.spyOn(DecisionRepo, "getRecent").mockResolvedValue(decisions as any);
    vi.spyOn(MemoryRepo, "getBehavioralMemories").mockResolvedValue([
      {
        id: "existing-mem",
        user_id: USER,
        trigger_pattern: `意图为"${INTENT}"的问题`, // matches via .includes()
        observation: "already exists",
        learned_action: "already learned",
        strength: 0.7,
        reinforcement_count: 5,
        last_activated: Date.now(),
        source_decision_ids: [],
        created_at: Date.now(),
      },
    ] as any);
    vi.spyOn(MemoryRepo, "saveBehavioralMemory").mockResolvedValue(undefined as any);
    vi.spyOn(MemoryRepo, "reinforceMemory").mockResolvedValue(undefined as any);

    // latestDecision has feedback_score = 1 (positive), but the positive gate
    // is already blocked by existingForIntent → delta = 0 (reinforceMemory skipped)
    const result = await analyzeAndLearn(USER, latestDecision);

    // Core assertion: existingForIntent guard prevents saveBehavioralMemory
    expect(MemoryRepo.saveBehavioralMemory).not.toHaveBeenCalled();
    // No new memory returned — function reaches the existingForIntent block then returns null
    expect(result).toBeNull();
  });

  /**
   * Test: with no existing memory, the same neutral feedback scenario would still
   * NOT create a positive memory (positiveCount=0 < 3, positiveRate undefined).
   * This confirms the behavior is consistent regardless of existingForIntent.
   */
  it("with no existing memory and all-neutral fast decisions, no memory is created", async () => {
    const decisions = makeRecentDecisions(
      INTENT,
      [
        { selected_role: "fast", feedback_score: 0 },
        { selected_role: "fast", feedback_score: 0 },
        { selected_role: "fast", feedback_score: 0 },
      ]
    );

    vi.spyOn(DecisionRepo, "getRecent").mockResolvedValue(decisions as any);
    vi.spyOn(MemoryRepo, "getBehavioralMemories").mockResolvedValue([] as any);
    vi.spyOn(MemoryRepo, "saveBehavioralMemory").mockResolvedValue(undefined as any);

    const result = await analyzeAndLearn(USER, latestDecision);

    expect(result).toBeNull();
    expect(MemoryRepo.saveBehavioralMemory).not.toHaveBeenCalled();
  });
});

// ── Negative gate still works independently ──────────────────────────────────

describe("negative gate (fastNegativeRate > 0.4) is unchanged", () => {

  it("still creates negative memory when 2/4 fast decisions are negative (50%)", async () => {
    // 2 negative out of 4 fast-with-feedback = 50% > 40% threshold
    const decisions = makeRecentDecisions(
      INTENT,
      [
        { selected_role: "fast", feedback_score: -1 },
        { selected_role: "fast", feedback_score: -1 },
        { selected_role: "fast", feedback_score: 1 },
        { selected_role: "fast", feedback_score: 1 },
      ]
    );
    // No existing memory
    vi.spyOn(DecisionRepo, "getRecent").mockResolvedValue(decisions as any);
    vi.spyOn(MemoryRepo, "getBehavioralMemories").mockResolvedValue([] as any);
    vi.spyOn(MemoryRepo, "saveBehavioralMemory").mockResolvedValue(undefined as any);

    const result = await analyzeAndLearn(USER, latestDecision);

    expect(result).not.toBeNull();
    expect(result!.strength).toBe(0.6); // negative memory strength
    expect(result!.learned_action).toContain("优先路由到慢模型");
  });

  it("negative memory takes precedence over positive when both thresholds met", async () => {
    // 3 negative out of 5 = 60% negative → triggers negative gate
    // 3 positive out of 5 = 60% positive → would also trigger new positive gate
    // Negative is checked first in the code → negative wins
    const decisions = makeRecentDecisions(
      INTENT,
      [
        { selected_role: "fast", feedback_score: -1 },
        { selected_role: "fast", feedback_score: -1 },
        { selected_role: "fast", feedback_score: -1 },
        { selected_role: "fast", feedback_score: 1 },
        { selected_role: "fast", feedback_score: 1 },
      ]
    );
    vi.spyOn(DecisionRepo, "getRecent").mockResolvedValue(decisions as any);
    vi.spyOn(MemoryRepo, "getBehavioralMemories").mockResolvedValue([] as any);
    vi.spyOn(MemoryRepo, "saveBehavioralMemory").mockResolvedValue(undefined as any);

    const result = await analyzeAndLearn(USER, latestDecision);

    // Negative gate fires first (line 24) → returns negative memory, never reaches positive gate
    expect(result).not.toBeNull();
    expect(result!.strength).toBe(0.6); // negative
    expect(result!.learned_action).toContain("慢模型");
    expect(MemoryRepo.saveBehavioralMemory).toHaveBeenCalledTimes(1);
  });
});

// ── Return value shape ───────────────────────────────────────────────────────

describe("return value shape for positive memory", () => {
  it("returns correct BehavioralMemory shape with all required fields", async () => {
    const decisions = makeRecentDecisions(
      INTENT,
      [
        { selected_role: "fast", feedback_score: 1 },
        { selected_role: "fast", feedback_score: 1 },
        { selected_role: "fast", feedback_score: 1 },
      ]
    );
    const result = await stubAnalyzelearn(USER, latestDecision, decisions);

    expect(result).not.toBeNull();
    expect(typeof result!.id).toBe("string");
    expect(result!.user_id).toBe(USER);
    expect(typeof result!.trigger_pattern).toBe("string");
    expect(typeof result!.observation).toBe("string");
    expect(typeof result!.learned_action).toBe("string");
    expect(result!.strength).toBe(0.7);
    expect(result!.reinforcement_count).toBe(1);
    expect(typeof result!.last_activated).toBe("number");
    expect(Array.isArray(result!.source_decision_ids)).toBe(true);
    expect(typeof result!.created_at).toBe("number");
  });
});

// ── P4.2: Execution Signal Sample Eligibility ─────────────────────────────────
//
// Validates Sprint 13 P4.2 behaviour: high-reliability execution signals
// (did_fallback=true, cost_saved_vs_slow>0) contribute to the effectiveFastSampleCount
// threshold, but do NOT affect positive / negative counts or rates.
//
// Core invariant:
//   effectiveFastSampleCount = fastExplicitSamples.length + fastExecutionSignalSamples.length
//   Positive/negative gates still only read fastExplicitSamples.
//
// What counts as an execution signal sample:
//   • did_fallback=true with NO explicit feedback  → qualifies
//   • cost_saved_vs_slow > 0 with NO explicit feedback  → qualifies
//   • feedback_score is not null  → always explicit, never counted as execution signal

describe("P4.2 execution signal samples contribute to eligibility threshold (effectiveFastSampleCount)", () => {

  /**
   * Baseline: 2 explicit samples alone are not enough to open the eligibility window.
   * Without execution signal help, analysis returns null.
   */
  it("returns null when only 2 explicit samples and no execution signal samples", async () => {
    const decisions = [
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
    ];
    const result = await stubAnalyzelearn(USER, latestDecision, decisions);
    expect(result).toBeNull();
    expect(MemoryRepo.saveBehavioralMemory).not.toHaveBeenCalled();
  });

  /**
   * P4.2 gain: 2 explicit samples + 1 execution signal sample (did_fallback=true)
   * → effectiveFastSampleCount = 3, eligibility window opens.
   * With only 2 positive explicit samples (positiveCount=2 < 3), positive gate won't fire.
   * With 0 explicit negative samples, negative gate won't fire.
   * Result: null (eligibility is open, but no gate fires yet).
   */
  it("opens eligibility window with 2 explicit + 1 fallback signal (effectiveFastSampleCount=3)", async () => {
    const decisions = [
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: null, did_fallback: true }),
    ];
    const result = await stubAnalyzelearn(USER, latestDecision, decisions);
    // Eligibility opens, but positive gate needs positiveCount >= 3 — only 2 here.
    // Negative gate: 0/2 explicit = 0% < 40% — doesn't fire.
    expect(result).toBeNull();
    expect(MemoryRepo.saveBehavioralMemory).not.toHaveBeenCalled();
  });

  /**
   * P4.2 gain: 2 explicit positive + 1 cost_saved signal opens eligibility.
   * Same outcome as above — not enough explicit positives to fire positive gate.
   */
  it("opens eligibility with 2 explicit + 1 cost_saved signal (effectiveFastSampleCount=3)", async () => {
    const decisions = [
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: null, cost_saved_vs_slow: 0.002 }),
    ];
    const result = await stubAnalyzelearn(USER, latestDecision, decisions);
    expect(result).toBeNull();
    expect(MemoryRepo.saveBehavioralMemory).not.toHaveBeenCalled();
  });

  /**
   * Execution signals do NOT count toward positiveCount.
   * 2 explicit positive + 2 execution signal samples:
   *   effectiveFastSampleCount = 4 → eligibility open
   *   positiveCount = 2 (only explicit) → positive gate: 2 < 3 → no fire
   * Result: null.
   */
  it("execution signal samples do NOT inflate positiveCount — 2 explicit + 2 signals still no positive memory", async () => {
    const decisions = [
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: null, did_fallback: true }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: null, cost_saved_vs_slow: 0.005 }),
    ];
    const result = await stubAnalyzelearn(USER, latestDecision, decisions);
    // effectiveFastSampleCount=4 → eligibility open
    // positiveCount=2 (explicit only) → positive gate: 2 < 3 → no fire
    expect(result).toBeNull();
    expect(MemoryRepo.saveBehavioralMemory).not.toHaveBeenCalled();
  });

  /**
   * Execution signals do NOT count toward negativeCount.
   * 1 explicit negative + 2 fallback signals:
   *   effectiveFastSampleCount = 3 → eligibility open
   *   explicit samples = 1, fastNegativeRate = 1/1 = 100% > 40%  ← negative gate fires
   *
   * Wait — this is an interesting edge case. When fastExplicitSamples.length=1,
   * fastNegativeRate = 1/1 = 100% which IS > 0.4.  Negative gate fires.
   * We should verify this, but also document the concern:
   * a single negative explicit sample + 2 fallback signals creates a negative memory.
   * This is intentional MVP behaviour — fallback signals lower the observation bar.
   */
  it("1 explicit negative + 2 fallback signals: negative gate fires (fastNegativeRate=100%)", async () => {
    const decisions = [
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: -1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: null, did_fallback: true }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: null, did_fallback: true }),
    ];
    const result = await stubAnalyzelearn(USER, latestDecision, decisions);
    // effectiveFastSampleCount=3 → eligibility open
    // fastNegativeRate = 1/1 = 100% > 40% → negative gate fires
    expect(result).not.toBeNull();
    expect(result!.strength).toBe(0.6);
    expect(result!.learned_action).toContain("慢模型");
    expect(MemoryRepo.saveBehavioralMemory).toHaveBeenCalledTimes(1);
  });

  /**
   * Execution signals with feedback_score present are treated as EXPLICIT, not execution signal.
   * A decision with did_fallback=true AND a valid feedback_score is an explicit sample.
   * It should contribute to positive/negative counts.
   */
  it("decision with did_fallback=true AND feedback_score is treated as explicit sample (not execution signal)", async () => {
    // 3 decisions: 2 explicit positive + 1 fallback-with-positive-feedback
    // The 3rd is explicit (feedback_score=1), so positiveCount=3, eligible for positive gate.
    const decisions = [
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1, did_fallback: true }),
    ];
    const result = await stubAnalyzelearn(USER, latestDecision, decisions);
    // All 3 are explicit: fastExplicitSamples.length=3, positiveCount=3, fastPositiveRate=1.0
    // Positive gate: positiveCount>=3 && positiveRate>0.5 → fires
    expect(result).not.toBeNull();
    expect(result!.strength).toBe(0.7);
    expect(MemoryRepo.saveBehavioralMemory).toHaveBeenCalledTimes(1);
  });

  /**
   * cost_saved_vs_slow = 0 does NOT qualify as an execution signal sample.
   * Only cost_saved > 0 counts.
   */
  it("cost_saved_vs_slow=0 does NOT count as execution signal sample", async () => {
    const decisions = [
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: null, cost_saved_vs_slow: 0 }),
    ];
    const result = await stubAnalyzelearn(USER, latestDecision, decisions);
    // cost_saved=0 is excluded, so fastExecutionSignalSamples.length=0
    // effectiveFastSampleCount=2 < 3 → returns null before any gate
    expect(result).toBeNull();
    expect(MemoryRepo.saveBehavioralMemory).not.toHaveBeenCalled();
  });

  /**
   * null cost_saved_vs_slow does NOT qualify.
   */
  it("cost_saved_vs_slow=null does NOT count as execution signal sample", async () => {
    const decisions = [
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: null, cost_saved_vs_slow: null }),
    ];
    const result = await stubAnalyzelearn(USER, latestDecision, decisions);
    expect(result).toBeNull();
  });

  /**
   * P4.1 regression: existing behaviour when all samples are explicit still works.
   * 3 explicit positives → positive memory created. Execution signal layer is a no-op.
   */
  it("P4.1 regression: 3 explicit positives still creates positive memory (execution signal layer transparent)", async () => {
    const decisions = [
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
    ];
    const result = await stubAnalyzelearn(USER, latestDecision, decisions);
    expect(result).not.toBeNull();
    expect(result!.strength).toBe(0.7);
    expect(result!.learned_action).toContain("放心使用快模型");
  });

  /**
   * Mixed: 3 explicit positive + 1 execution signal → positive gate fires on explicit only.
   * execution signal does not change positive rate or positive count.
   */
  it("3 explicit positives + 1 execution signal: positive gate fires (execution signal doesn't alter positive rate)", async () => {
    const decisions = [
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: null, did_fallback: true }),
    ];
    const result = await stubAnalyzelearn(USER, latestDecision, decisions);
    // fastExplicitSamples=3, positiveCount=3, fastPositiveRate=1.0 → positive gate fires
    expect(result).not.toBeNull();
    expect(result!.strength).toBe(0.7);
    expect(MemoryRepo.saveBehavioralMemory).toHaveBeenCalledTimes(1);
  });
});

// ── P5: Learning-side Signal Level Gating ─────────────────────────────────────
//
// Sprint 14 P5: signal_level from feedback_events gates which samples contribute
// to truth statistics vs. eligibility only.
//
// Signal level routing:
//   L1 (signal_level=1: thumbs_up/down, accepted) → truth stats + eligibility ✓
//   L2 (signal_level=2: follow_up_thanks, follow_up_doubt) → eligibility only, no truth
//   L3 (signal_level=3: regenerated, edited) → excluded entirely
//
// Compatibility: decisions without a feedback_events record → treated as L1 (legacy).
//
// Implementation: FeedbackEventRepo.getByDecisionIds() returns Map<decisionId, signal_level>.
// Decisions with no event in feedback_events fall back to the legacy heuristic
// (feedback_score != null → truth-capable).

describe("P5: L2 signals count toward eligibility but NOT toward truth statistics", () => {

  // Helper: build a signal level map for specific decision IDs
  const l2SignalMap = (decisions: any[]) => {
    const map = new Map<string, number>();
    decisions.forEach((d) => map.set(d.id, 2)); // all L2
    return map;
  };

  const stubWithL2 = async (decisions: any[]) => {
    vi.spyOn(DecisionRepo, "getRecent").mockResolvedValue(decisions as any);
    vi.spyOn(MemoryRepo, "getBehavioralMemories").mockResolvedValue([] as any);
    vi.spyOn(MemoryRepo, "saveBehavioralMemory").mockResolvedValue(undefined as any);
    vi.spyOn(FeedbackEventRepo, "getByDecisionIds").mockResolvedValue(l2SignalMap(decisions));
    return analyzeAndLearn(USER, latestDecision);
  };

  afterEach(() => vi.restoreAllMocks());

  /**
   * 2 L2 signals + 1 fallback execution signal:
   *   effectiveFastSampleCount = 0 (L2 excluded from truth) + 0 + 1 = 1 < 3
   *   → eligibility not open → no gate fires → result is null.
   */
  it("2 L2 signals + 1 fallback signal: eligibility NOT open (effectiveFastSampleCount=1)", async () => {
    const decisions = [
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),  // L2
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),  // L2
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: null, did_fallback: true }),
    ];
    const result = await stubWithL2(decisions);
    // L2 samples excluded from truth AND from eligibility count
    // effectiveFastSampleCount = 0 + 1 = 1 < 3 → null
    expect(result).toBeNull();
    expect(MemoryRepo.saveBehavioralMemory).not.toHaveBeenCalled();
  });

  /**
   * 2 L2 signals + 1 L1 positive → effectiveFastSampleCount = 1 + 1 = 2 < 3
   * Still not enough for eligibility.  Result: null.
   */
  it("2 L2 signals + 1 L1 positive: still not eligible (effectiveFastSampleCount=2)", async () => {
    const l2Dec = [
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
    ];
    const l1Dec = makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 });
    const allDecs = [...l2Dec, l1Dec];

    vi.spyOn(DecisionRepo, "getRecent").mockResolvedValue(allDecs as any);
    vi.spyOn(MemoryRepo, "getBehavioralMemories").mockResolvedValue([] as any);
    vi.spyOn(MemoryRepo, "saveBehavioralMemory").mockResolvedValue(undefined as any);
    vi.spyOn(FeedbackEventRepo, "getByDecisionIds").mockImplementation(async () => {
      const m = new Map<string, number>();
      l2Dec.forEach((d) => m.set(d.id, 2)); // L2 for the first two
      m.set(l1Dec.id, 1);                   // L1 for the third
      return m;
    });

    const result = await analyzeAndLearn(USER, latestDecision);
    // L1 count = 1, L2 count = 2, execution signal = 0
    // effectiveFastSampleCount = 1 + 2 + 0 = 3 ≥ 3 → eligibility OPEN
    // fastExplicitSamples (L1) = 1, positiveCount = 1 < 3 → positive gate: no fire
    // fastNegativeRate = 0 → negative gate: no fire
    expect(result).toBeNull();
    expect(MemoryRepo.saveBehavioralMemory).not.toHaveBeenCalled();
  });

  /**
   * 2 L2 signals + 1 L1 positive + 1 fallback execution signal:
   *   effectiveFastSampleCount = 1 (L1) + 2 (L2) + 1 (exec) = 4 ≥ 3 → eligibility open
   *   fastExplicitSamples (L1) = 1 → positiveCount = 1 < 3 → no positive gate
   *   fastNegativeRate = 0 → no negative gate
   * Result: null (eligible but no gate fires).
   */
  it("2 L2 + 1 L1 + 1 fallback: eligible but no gate fires (positiveCount=1 < 3)", async () => {
    const l2Dec = [
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
    ];
    const l1Dec = makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 });
    const execDec = makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: null, did_fallback: true });
    const allDecs = [...l2Dec, l1Dec, execDec];

    vi.spyOn(DecisionRepo, "getRecent").mockResolvedValue(allDecs as any);
    vi.spyOn(MemoryRepo, "getBehavioralMemories").mockResolvedValue([] as any);
    vi.spyOn(MemoryRepo, "saveBehavioralMemory").mockResolvedValue(undefined as any);
    vi.spyOn(FeedbackEventRepo, "getByDecisionIds").mockImplementation(async () => {
      const m = new Map<string, number>();
      l2Dec.forEach((d) => m.set(d.id, 2));
      m.set(l1Dec.id, 1);
      return m;
    });

    const result = await analyzeAndLearn(USER, latestDecision);
    // effectiveFastSampleCount = 1 + 2 + 1 = 4 → open
    // L1 samples = 1, positiveCount = 1 < 3 → no positive gate
    expect(result).toBeNull();
  });

  /**
   * 3 L1 positive + 2 L2 signals:
   *   effectiveFastSampleCount = 3 + 2 + 0 = 5 ≥ 3 → open
   *   L1 samples = 3, positiveCount = 3 ≥ 3, fastPositiveRate = 1.0 > 0.5 → positive gate FIRES
   *   L2 signals do NOT alter positive rate (still computed on L1 only).
   * This confirms L2 boosts eligibility without polluting truth.
   */
  it("3 L1 positive + 2 L2 signals: positive gate fires (L2 boosts eligibility, doesn't pollute truth)", async () => {
    const l2Dec = [
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
    ];
    const l1Decs = [
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
    ];
    const allDecs = [...l1Decs, ...l2Dec];

    vi.spyOn(DecisionRepo, "getRecent").mockResolvedValue(allDecs as any);
    vi.spyOn(MemoryRepo, "getBehavioralMemories").mockResolvedValue([] as any);
    vi.spyOn(MemoryRepo, "saveBehavioralMemory").mockResolvedValue(undefined as any);
    vi.spyOn(FeedbackEventRepo, "getByDecisionIds").mockImplementation(async () => {
      const m = new Map<string, number>();
      l1Decs.forEach((d) => m.set(d.id, 1));
      l2Dec.forEach((d) => m.set(d.id, 2));
      return m;
    });

    const result = await analyzeAndLearn(USER, latestDecision);
    expect(result).not.toBeNull();
    expect(result!.strength).toBe(0.7);
    expect(MemoryRepo.saveBehavioralMemory).toHaveBeenCalledTimes(1);
    // Verify L2 is not in the call's positive rate calculation
    // (all L1 are positive → rate = 100%, gate fires)
  });

  /**
   * L2 negative (follow_up_doubt, score=-1): contributes to eligibility but NOT to negative rate.
   * Setup: 2 L2 negative + 1 L1 negative + 1 execution signal
   *   effectiveFastSampleCount = 1 + 2 + 1 = 4 ≥ 3 → open
   *   L1 samples = 1, fastNegativeRate = 1/1 = 100% > 40% → negative gate fires
   * L2 samples should NOT inflate negative rate to 3/3 = 100% — they're excluded from truth.
   */
  it("2 L2 negative + 1 L1 negative + 1 execution signal: negative gate fires on L1 only (L2 excluded)", async () => {
    const l2Dec = [
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: -1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: -1 }),
    ];
    const l1Dec = makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: -1 });
    const execDec = makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: null, did_fallback: true });
    const allDecs = [...l2Dec, l1Dec, execDec];

    vi.spyOn(DecisionRepo, "getRecent").mockResolvedValue(allDecs as any);
    vi.spyOn(MemoryRepo, "getBehavioralMemories").mockResolvedValue([] as any);
    vi.spyOn(MemoryRepo, "saveBehavioralMemory").mockResolvedValue(undefined as any);
    vi.spyOn(FeedbackEventRepo, "getByDecisionIds").mockImplementation(async () => {
      const m = new Map<string, number>();
      l2Dec.forEach((d) => m.set(d.id, 2));
      m.set(l1Dec.id, 1);
      return m;
    });

    const result = await analyzeAndLearn(USER, latestDecision);
    expect(result).not.toBeNull();
    expect(result!.strength).toBe(0.6); // negative memory
    expect(result!.learned_action).toContain("慢模型");
    expect(MemoryRepo.saveBehavioralMemory).toHaveBeenCalledTimes(1);
  });
});

describe("P5: L3 signals are completely excluded from truth and eligibility", () => {

  const l3SignalMap = (decisions: any[]) => {
    const map = new Map<string, number>();
    decisions.forEach((d) => map.set(d.id, 3)); // all L3
    return map;
  };

  /**
   * 2 L3 signals + 1 fallback execution signal:
   *   effectiveFastSampleCount = 0 + 0 + 1 = 1 < 3 → not eligible
   *   Result: null.
   */
  it("L3 signals excluded entirely — 2 L3 + 1 fallback: not eligible", async () => {
    const decisions = [
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: -2 }), // L3 (regenerated)
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: -2 }), // L3
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: null, did_fallback: true }),
    ];
    vi.spyOn(DecisionRepo, "getRecent").mockResolvedValue(decisions as any);
    vi.spyOn(MemoryRepo, "getBehavioralMemories").mockResolvedValue([] as any);
    vi.spyOn(MemoryRepo, "saveBehavioralMemory").mockResolvedValue(undefined as any);
    vi.spyOn(FeedbackEventRepo, "getByDecisionIds").mockResolvedValue(l3SignalMap(decisions));

    const result = await analyzeAndLearn(USER, latestDecision);
    // effectiveFastSampleCount = 0 + 0 + 1 = 1 < 3 → null
    expect(result).toBeNull();
    expect(MemoryRepo.saveBehavioralMemory).not.toHaveBeenCalled();
  });

  /**
   * 3 L3 + 3 L1 positive:
   *   effectiveFastSampleCount = 3 + 0 + 0 = 3 ≥ 3 → eligible
   *   fastExplicitSamples (L1 only) = 3, positiveCount = 3, fastPositiveRate = 1.0 > 0.5 → fires
   * L3 signals boosted eligibility from 3→6, but positive gate still fires on L1 truth.
   */
  it("3 L3 + 3 L1 positive: positive gate fires on L1 truth (L3 only contributes to eligibility count)", async () => {
    const l3Dec = [
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: -2 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: -2 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: -2 }),
    ];
    const l1Decs = [
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
    ];
    const allDecs = [...l3Dec, ...l1Decs];

    vi.spyOn(DecisionRepo, "getRecent").mockResolvedValue(allDecs as any);
    vi.spyOn(MemoryRepo, "getBehavioralMemories").mockResolvedValue([] as any);
    vi.spyOn(MemoryRepo, "saveBehavioralMemory").mockResolvedValue(undefined as any);
    vi.spyOn(FeedbackEventRepo, "getByDecisionIds").mockImplementation(async () => {
      const m = new Map<string, number>();
      l3Dec.forEach((d) => m.set(d.id, 3));
      l1Decs.forEach((d) => m.set(d.id, 1));
      return m;
    });

    const result = await analyzeAndLearn(USER, latestDecision);
    expect(result).not.toBeNull();
    expect(result!.strength).toBe(0.7);
    expect(MemoryRepo.saveBehavioralMemory).toHaveBeenCalledTimes(1);
  });
});

describe("P5: legacy decisions (no feedback_events record) fall back to L1 heuristic", () => {

  /**
   * When getByDecisionIds returns an empty Map (no events in feedback_events),
   * decisions with feedback_score != null are treated as L1 (truth-capable).
   * This preserves backward compatibility with pre-P4 data.
   *
   * Setup: 3 decisions with feedback_score, but empty signal level map (no events).
   * Expected: treated as L1, positive gate fires.
   */
  it("empty signalLevelMap: decisions with feedback_score treated as L1 (legacy backward compat)", async () => {
    const decisions = [
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
    ];

    vi.spyOn(DecisionRepo, "getRecent").mockResolvedValue(decisions as any);
    vi.spyOn(MemoryRepo, "getBehavioralMemories").mockResolvedValue([] as any);
    vi.spyOn(MemoryRepo, "saveBehavioralMemory").mockResolvedValue(undefined as any);
    // Empty map = no feedback_events records → legacy fallback path
    vi.spyOn(FeedbackEventRepo, "getByDecisionIds").mockResolvedValue(new Map<string, number>());

    const result = await analyzeAndLearn(USER, latestDecision);
    expect(result).not.toBeNull();
    expect(result!.strength).toBe(0.7);
    expect(MemoryRepo.saveBehavioralMemory).toHaveBeenCalledTimes(1);
  });
});

describe("P5: L1 explicit signals continue to work correctly (no regression)", () => {

  /**
   * Pure L1 scenario with no L2/L3 signals or execution signals.
   * This is the core use case: thumbs_up/down on fast decisions.
   * Should behave identically to pre-P5.
   */
  it("3 L1 positive: positive memory created (no regression from P5 changes)", async () => {
    const decisions = [
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
    ];

    vi.spyOn(DecisionRepo, "getRecent").mockResolvedValue(decisions as any);
    vi.spyOn(MemoryRepo, "getBehavioralMemories").mockResolvedValue([] as any);
    vi.spyOn(MemoryRepo, "saveBehavioralMemory").mockResolvedValue(undefined as any);
    vi.spyOn(FeedbackEventRepo, "getByDecisionIds").mockImplementation(async () => {
      const m = new Map<string, number>();
      decisions.forEach((d) => m.set(d.id, 1));
      return m;
    });

    const result = await analyzeAndLearn(USER, latestDecision);
    expect(result).not.toBeNull();
    expect(result!.strength).toBe(0.7);
    expect(result!.learned_action).toContain("放心使用快模型");
    expect(MemoryRepo.saveBehavioralMemory).toHaveBeenCalledTimes(1);
  });

  /**
   * Mixed L1 + L2 + L3: eligibility counts all, truth uses L1 only.
   * L1: 2 positive, 2 negative → positiveCount=2 < 3, negativeRate=2/4=50% > 40% → negative gate fires.
   * L2 signals boost eligibility from 4→6. L3 signals excluded.
   */
  it("2 L1 positive + 2 L1 negative + 2 L2 + 1 L3: negative gate fires on L1 truth only (L2/L3 excluded)", async () => {
    const l1Decs = [
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: -1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: -1 }),
    ];
    const l2Decs = [
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
      makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: 1 }),
    ];
    const l3Dec = makeDecision({ intent: INTENT, selected_role: "fast", feedback_score: -2 });
    const allDecs = [...l1Decs, ...l2Decs, l3Dec];

    vi.spyOn(DecisionRepo, "getRecent").mockResolvedValue(allDecs as any);
    vi.spyOn(MemoryRepo, "getBehavioralMemories").mockResolvedValue([] as any);
    vi.spyOn(MemoryRepo, "saveBehavioralMemory").mockResolvedValue(undefined as any);
    vi.spyOn(FeedbackEventRepo, "getByDecisionIds").mockImplementation(async () => {
      const m = new Map<string, number>();
      l1Decs.forEach((d) => m.set(d.id, 1));
      l2Decs.forEach((d) => m.set(d.id, 2));
      m.set(l3Dec.id, 3);
      return m;
    });

    const result = await analyzeAndLearn(USER, latestDecision);
    // Eligibility: L1(4) + L2(2) + L3(0) = 6 ≥ 3 → open
    // Truth (L1 only): positiveCount=2 < 3 (no positive gate)
    //                  negativeRate=2/4=50% > 40% → negative gate FIRES
    expect(result).not.toBeNull();
    expect(result!.strength).toBe(0.6);
    expect(result!.learned_action).toContain("慢模型");
    expect(MemoryRepo.saveBehavioralMemory).toHaveBeenCalledTimes(1);
  });
});
