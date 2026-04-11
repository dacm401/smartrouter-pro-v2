import { v4 as uuid } from "uuid";
import type { BehavioralMemory, DecisionRecord } from "../types/index.js";
import { MemoryRepo, DecisionRepo, FeedbackEventRepo } from "../db/repositories.js";

export async function analyzeAndLearn(userId: string, latestDecision: DecisionRecord): Promise<BehavioralMemory | null> {
  const recentDecisions = await DecisionRepo.getRecent(userId, 50);
  const sameIntentDecisions = recentDecisions.filter((d: any) => d.intent === latestDecision.input_features.intent);

  if (sameIntentDecisions.length < 3) return null;

  const fastDecisions = sameIntentDecisions.filter((d: any) => d.selected_role === "fast");

  // P5: Fetch signal_level for all fast decisions from feedback_events.
  // Used to gate which samples contribute to truth stats vs. eligibility only.
  const decisionIds = fastDecisions.map((d: any) => d.id);
  const signalLevelMap = await FeedbackEventRepo.getByDecisionIds(userId, decisionIds);

  // P4.2 legacy Layer 2 — Execution signal samples (unchanged):
  // fast decisions WITHOUT explicit feedback but WITH reliable system-level quality signal.
  // These contribute to the eligibility threshold only, not to truth stats.
  const fastExecutionSignalSamples = fastDecisions.filter(
    (d: any) =>
      d.feedback_score === null &&
      (d.did_fallback === true || (d.cost_saved_vs_slow != null && Number(d.cost_saved_vs_slow) > 0))
  );

  // P5: Layer 1 split by signal_level.
  //
  // fastExplicitSamples (L1 truth-capable): feedback_score != null AND
  //   signal_level is either absent (legacy, treat as L1) or is 1.
  //
  // fastL2Samples (eligibility-only): has feedback_score, signal_level=2 (follow_up_thanks/doubt).
  //   These are saved to decision_logs so the compatibility layer stays intact,
  //   but they must NOT influence positive/negative truth statistics.
  //
  // fastL3Samples: signal_level=3 (regenerated, edited).  Completely excluded.
  //
  // Note: signalLevelMap entries are optional.  Decisions without a feedback_events record
  // (legacy data before P4 or decisions with no userId) fall through to the legacy
  // feedback_score !== null heuristic → treated as L1 (truth-capable).
  const fastExplicitSamples: any[] = [];
  const fastL2Samples: any[] = [];
  const fastL3Samples: any[] = [];

  for (const d of fastDecisions) {
    if (d.feedback_score === null) continue; // execution signals handled above
    const sl = signalLevelMap.get(d.id);
    if (sl === undefined || sl === 1) {
      fastExplicitSamples.push(d); // L1 or legacy (no event) — truth-capable
    } else if (sl === 2) {
      fastL2Samples.push(d);        // L2 — eligibility only, no truth
    } else {
      fastL3Samples.push(d);         // L3 — excluded entirely
    }
  }

  // P5 eligibility: L1 (truth-capable explicit) + L2 (weak signal) + execution signals.
  // L3 is excluded from eligibility as noise.
  // This keeps the minimum observation window aligned with P4.2 semantics.
  const effectiveFastSampleCount = fastExplicitSamples.length + fastL2Samples.length + fastExecutionSignalSamples.length;

  // Minimum observation window: 3 effective samples required to proceed.
  if (effectiveFastSampleCount < 3) return null;

  // Positive / negative rates and counts are computed on EXPLICIT samples only.
  // Execution signals are not allowed to define user satisfaction.
  const fastNegativeRate =
    fastExplicitSamples.length > 0
      ? fastExplicitSamples.filter((d: any) => d.feedback_score < 0).length / fastExplicitSamples.length
      : 0;
  const fastPositiveRate =
    fastExplicitSamples.length > 0
      ? fastExplicitSamples.filter((d: any) => d.feedback_score > 0).length / fastExplicitSamples.length
      : 0;
  const positiveCount = fastExplicitSamples.filter((d: any) => d.feedback_score > 0).length;

  const intent = latestDecision.input_features.intent;

  const existingMemories = await MemoryRepo.getBehavioralMemories(userId);
  const existingForIntent = existingMemories.find((m) => m.trigger_pattern.includes(intent));

  // Source IDs for memory provenance: prefer explicit samples, fall back to execution signal samples.
  const sourceSamples = fastExplicitSamples.length > 0 ? fastExplicitSamples : fastExecutionSignalSamples;

  if (fastNegativeRate > 0.4 && !existingForIntent) {
    const memory: BehavioralMemory = {
      id: uuid(), user_id: userId, trigger_pattern: `意图为"${intent}"的问题`,
      observation: `"${intent}"类问题使用快模型时，${Math.round(fastNegativeRate * 100)}%的回答不满意`,
      learned_action: `"${intent}"类问题优先路由到慢模型`, strength: 0.6, reinforcement_count: 1,
      last_activated: Date.now(), source_decision_ids: sourceSamples.map((d: any) => d.id).slice(0, 5), created_at: Date.now(),
    };
    await MemoryRepo.saveBehavioralMemory(memory);
    return memory;
  }

  // P4.1: relaxed positive gate — was fastPositiveRate > 0.8 (required 4+/5+, i.e. 80%+).
  //   New: require ≥ 3 positive AND positive_rate > 0.5, so 3/4 (75%) and 3/5 (60%)
  //   now trigger positive memory creation instead of silently failing.
  if (positiveCount >= 3 && fastPositiveRate > 0.5 && !existingForIntent) {
    const memory: BehavioralMemory = {
      id: uuid(), user_id: userId, trigger_pattern: `意图为"${intent}"的问题`,
      observation: `"${intent}"类问题使用快模型时，${Math.round(fastPositiveRate * 100)}%的回答令人满意`,
      learned_action: `"${intent}"类问题可以放心使用快模型`, strength: 0.7, reinforcement_count: 1,
      last_activated: Date.now(), source_decision_ids: sourceSamples.map((d: any) => d.id).slice(0, 5), created_at: Date.now(),
    };
    await MemoryRepo.saveBehavioralMemory(memory);
    return memory;
  }

  if (existingForIntent) {
    const latestFeedback = latestDecision.feedback?.score || 0;
    const delta = latestFeedback > 0 ? 0.05 : latestFeedback < 0 ? -0.05 : 0;
    if (delta !== 0) await MemoryRepo.reinforceMemory(existingForIntent.id, delta);
  }

  return null;
}
