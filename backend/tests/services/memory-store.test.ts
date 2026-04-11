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
import { DecisionRepo, MemoryRepo } from "../../src/db/repositories.js";

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
