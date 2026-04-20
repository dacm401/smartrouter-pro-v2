import type { FeedbackType, DecisionRecord } from "../types/index.js";
import { DecisionRepo, FeedbackEventRepo } from "../db/repositories.js";

const FEEDBACK_SCORES: Record<FeedbackType, number> = {
  accepted: 1, thumbs_up: 2, follow_up_thanks: 2, edited: -0.5, regenerated: -2, thumbs_down: -2, follow_up_doubt: -1,
};

export async function recordFeedback(
  decisionId: string,
  feedbackType: FeedbackType,
  userId?: string,
  rawData?: Record<string, unknown>,
): Promise<void> {
  const score = FEEDBACK_SCORES[feedbackType] || 0;
  // C2: feedback_events is the single source of truth for signal_level.
  // Write it first; only update decision_logs on success.
  // If feedback_events write fails, decision_logs stays clean — legacy fallback
  // can never pick up an L2/L3 signal without its corresponding feedback_events record.
  if (userId) {
    await FeedbackEventRepo.save({ decisionId, userId, eventType: feedbackType, rawData });
    await DecisionRepo.updateFeedback(decisionId, feedbackType, score);
  } else {
    // Legacy path: no userId, only write decision_logs (no feedback_events)
    await DecisionRepo.updateFeedback(decisionId, feedbackType, score);
  }
}

export function detectImplicitFeedback(userMessage: string, previousDecisionId: string | null): { type: FeedbackType; confidence: number } | null {
  if (!previousDecisionId) return null;
  const msg = userMessage.toLowerCase();
  if (/谢谢|感谢|太好了|很好|完美|exactly|perfect|thanks|great|awesome/i.test(msg)) return { type: "follow_up_thanks", confidence: 0.8 };
  if (/你确定|不对|错了|不是这样|wrong|incorrect|are you sure/i.test(msg)) return { type: "follow_up_doubt", confidence: 0.7 };
  if (/再说一遍|换个说法|换个方式表达|regenerate|rephrase|try again|重新来/i.test(msg)) return { type: "regenerated", confidence: 0.6 };
  return null;
}
