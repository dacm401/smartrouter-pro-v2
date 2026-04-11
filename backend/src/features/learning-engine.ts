import type { DecisionRecord, FeedbackType } from "../types/index.js";
import { recordFeedback, detectImplicitFeedback } from "./feedback-collector.js";
import { analyzeAndLearn } from "../services/memory-store.js";
import { checkAndRecordMilestones } from "./growth-tracker.js";
import { MemoryRepo } from "../db/repositories.js";

export interface LearningResult {
  new_memory: string | null; milestones: string[]; implicit_feedback: string | null;
}

export async function learnFromInteraction(
  decision: DecisionRecord,
  userMessage?: string,
  previousDecisionId?: string | null,
  userId?: string, // P4: needed to write feedback_events
): Promise<LearningResult> {
  const result: LearningResult = { new_memory: null, milestones: [], implicit_feedback: null };

  if (userMessage && previousDecisionId) {
    const implicit = detectImplicitFeedback(userMessage, previousDecisionId);
    if (implicit && implicit.confidence >= 0.6) {
      // P4: pass userId so FeedbackEventRepo.save() is not skipped
      await recordFeedback(previousDecisionId, implicit.type, userId, { confidence: implicit.confidence });
      result.implicit_feedback = implicit.type;
    }
  }

  try {
    const newMemory = await analyzeAndLearn(decision.user_id, decision);
    if (newMemory) result.new_memory = newMemory.observation;
  } catch (error) { console.error("Learning analysis failed:", error); }

  try {
    result.milestones = await checkAndRecordMilestones(decision.user_id, decision);
  } catch (error) { console.error("Milestone check failed:", error); }

  try {
    const totalResult = await import("../db/connection.js").then((db) => db.query(`SELECT COUNT(*)::int as c FROM decision_logs WHERE user_id=$1`, [decision.user_id]));
    if (totalResult.rows[0]?.c % 100 === 0) await MemoryRepo.decayMemories();
  } catch { /* silent */ }

  return result;
}
