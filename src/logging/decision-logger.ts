import type { DecisionRecord } from "../types/index.js";
import { DecisionRepo } from "../db/repositories.js";
import { estimateCost } from "../models/token-counter.js";
import { config } from "../config.js";

export async function logDecision(decision: DecisionRecord): Promise<void> {
  const slowCost = estimateCost(decision.execution.input_tokens, decision.execution.output_tokens, config.slowModel);
  const actualCost = decision.execution.total_cost_usd;
  const costSaved = Math.max(0, slowCost - actualCost);

  decision.learning_signal = {
    routing_correct: true, cost_saved_vs_always_slow: costSaved, quality_delta: 0,
  };

  await DecisionRepo.save({ ...decision, execution: { ...decision.execution, total_cost_usd: actualCost } });

  const { query: dbQuery } = await import("../db/connection.js");
  await dbQuery(`UPDATE decision_logs SET cost_saved_vs_slow = $1 WHERE id = $2`, [costSaved, decision.id]);
}
