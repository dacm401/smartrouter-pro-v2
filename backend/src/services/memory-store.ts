import { v4 as uuid } from "uuid";
import type { BehavioralMemory, DecisionRecord } from "../types/index.js";
import { MemoryRepo, DecisionRepo } from "../db/repositories.js";

export async function analyzeAndLearn(userId: string, latestDecision: DecisionRecord): Promise<BehavioralMemory | null> {
  const recentDecisions = await DecisionRepo.getRecent(userId, 50);
  const sameIntentDecisions = recentDecisions.filter((d: any) => d.intent === latestDecision.input_features.intent);

  if (sameIntentDecisions.length < 3) return null;

  const fastDecisions = sameIntentDecisions.filter((d: any) => d.selected_role === "fast");

  // P4.2: Split fast decisions into two sample layers.
  //
  // Layer 1 — Explicit feedback samples: fast decisions with a user-provided feedback_score.
  //   These are the ground truth; only this layer defines positive / negative counts.
  const fastExplicitSamples = fastDecisions.filter((d: any) => d.feedback_score !== null);

  // Layer 2 — Execution signal samples: fast decisions WITHOUT explicit feedback, but
  //   with a reliable system-level quality signal.  Two signals qualify:
  //     • did_fallback = true  → fast model failed the quality gate; system switched to slow.
  //     • cost_saved_vs_slow > 0  → fast routing completed without fallback and saved cost.
  //   Purpose: these samples only contribute to the *eligibility threshold* (minimum sample
  //   count before we attempt any learning).  They do NOT affect positive/negative counts
  //   or positive/negative rates — those remain computed solely on explicit feedback.
  const fastExecutionSignalSamples = fastDecisions.filter(
    (d: any) =>
      d.feedback_score === null &&
      (d.did_fallback === true || (d.cost_saved_vs_slow != null && Number(d.cost_saved_vs_slow) > 0))
  );

  // Combined eligibility count: explicit + execution-signal samples.
  // We only need to observe enough evidence before analysing patterns; either source qualifies.
  const effectiveFastSampleCount = fastExplicitSamples.length + fastExecutionSignalSamples.length;

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
