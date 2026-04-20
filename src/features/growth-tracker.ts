import { v4 as uuid } from "uuid";
import { GrowthRepo, DecisionRepo } from "../db/repositories.js";
import type { DecisionRecord } from "../types/index.js";
import { query } from "../db/connection.js";

export async function checkAndRecordMilestones(userId: string, decision: DecisionRecord): Promise<string[]> {
  const newMilestones: string[] = [];
  const totalResult = await query(`SELECT COUNT(*)::int as total FROM decision_logs WHERE user_id=$1`, [userId]);
  const total = totalResult.rows[0]?.total || 0;

  const interactionMilestones = [10, 50, 100, 500, 1000, 5000];
  for (const milestone of interactionMilestones) {
    if (total === milestone) {
      const title = `累计完成 ${milestone} 次对话`;
      await GrowthRepo.addMilestone(userId, "interaction_count", title, milestone);
      newMilestones.push(title);
    }
  }

  const savedResult = await query(`SELECT COALESCE(SUM(cost_saved_vs_slow), 0)::float as saved FROM decision_logs WHERE user_id=$1`, [userId]);
  const totalSaved = savedResult.rows[0]?.saved || 0;
  const savingMilestones = [1, 5, 10, 50, 100];
  for (const milestone of savingMilestones) {
    if (totalSaved >= milestone) {
      const existing = await query(`SELECT id FROM growth_milestones WHERE user_id=$1 AND milestone_type='cost_saved' AND metric_value=$2`, [userId, milestone]);
      if (existing.rows.length === 0) {
        const title = `累计节省 $${milestone}`;
        await GrowthRepo.addMilestone(userId, "cost_saved", title, milestone);
        newMilestones.push(title);
      }
    }
  }

  const recentAccuracy = await query(
    `SELECT CASE WHEN COUNT(*) FILTER (WHERE feedback_score IS NOT NULL) >= 10 THEN COUNT(*) FILTER (WHERE feedback_score > 0)::float / COUNT(*) FILTER (WHERE feedback_score IS NOT NULL)::float * 100 ELSE NULL END as accuracy FROM decision_logs WHERE user_id=$1 AND created_at >= CURRENT_DATE - 7`, [userId]
  );
  const accuracy = recentAccuracy.rows[0]?.accuracy;
  if (accuracy !== null) {
    const accuracyMilestones = [80, 85, 90, 95];
    for (const milestone of accuracyMilestones) {
      if (accuracy >= milestone) {
        const existing = await query(`SELECT id FROM growth_milestones WHERE user_id=$1 AND milestone_type='accuracy' AND metric_value=$2`, [userId, milestone]);
        if (existing.rows.length === 0) {
          const title = `满意率突破 ${milestone}%`;
          await GrowthRepo.addMilestone(userId, "accuracy", title, milestone);
          newMilestones.push(title);
        }
      }
    }
  }

  return newMilestones;
}
