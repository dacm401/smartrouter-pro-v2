import { DecisionRepo, GrowthRepo } from "../db/repositories.js";
import type { DashboardData } from "../types/index.js";

export async function calculateDashboard(userId: string): Promise<DashboardData> {
  const [todayStats, recentDecisions, growth] = await Promise.all([
    DecisionRepo.getTodayStats(userId), DecisionRepo.getRecent(userId, 20), GrowthRepo.getProfile(userId),
  ]);

  const tokenFlow = { fast_tokens: 0, slow_tokens: 0, compressed_tokens: 0, fallback_tokens: 0 };
  for (const d of recentDecisions) {
    const tokens = (d.exec_input_tokens || 0) + (d.exec_output_tokens || 0);
    if (d.did_fallback) tokenFlow.fallback_tokens += tokens;
    else if (d.selected_role === "fast") tokenFlow.fast_tokens += tokens;
    else tokenFlow.slow_tokens += tokens;
    tokenFlow.compressed_tokens += (d.context_original_tokens || 0) - (d.context_compressed_tokens || 0);
  }

  const savingRate = todayStats.total_cost > 0 ? Math.round((todayStats.saved_cost / (todayStats.total_cost + todayStats.saved_cost)) * 100) : 0;

  return {
    today: {
      total_requests: todayStats.total_requests, fast_count: todayStats.fast_count, slow_count: todayStats.slow_count,
      fallback_count: todayStats.fallback_count, total_tokens: todayStats.total_tokens,
      total_cost: Math.round(todayStats.total_cost * 10000) / 10000,
      saved_cost: Math.round(todayStats.saved_cost * 10000) / 10000, saving_rate: savingRate,
      avg_latency_ms: todayStats.avg_latency, satisfaction_proxy: todayStats.satisfaction_rate || 0,
    },
    token_flow: tokenFlow,
    recent_decisions: recentDecisions.map(mapDecisionRow),
    growth,
  };
}

function mapDecisionRow(row: any): any {
  return {
    id: row.id, timestamp: new Date(row.created_at).getTime(),
    input_features: { raw_query: row.query_preview, intent: row.intent, complexity_score: row.complexity_score, token_count: row.input_token_count, has_code: row.has_code, has_math: row.has_math },
    routing: { router_version: row.router_version, scores: { fast: row.fast_score, slow: row.slow_score }, confidence: row.confidence, selected_model: row.selected_model, selected_role: row.selected_role, selection_reason: row.selection_reason },
    context: { original_tokens: row.context_original_tokens, compressed_tokens: row.context_compressed_tokens, compression_level: row.compression_level, compression_ratio: row.compression_ratio },
    execution: { model_used: row.model_used, input_tokens: row.exec_input_tokens, output_tokens: row.exec_output_tokens, total_cost_usd: parseFloat(row.total_cost_usd), latency_ms: row.latency_ms, did_fallback: row.did_fallback },
    feedback: row.feedback_type ? { type: row.feedback_type, score: Number(row.feedback_score) } : undefined,
  };
}
