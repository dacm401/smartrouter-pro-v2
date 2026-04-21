/**
 * System Confidence 计算 — Gated Delegation G1/G2
 *
 * 【设计原则：系统计算为主，LLM 输出为辅】
 *
 * LLM 可以输出 llm_confidence_hint 作为参考信号，
 * 但系统最终 confidence 必须由后处理计算得出，
 * 不能把"我很确定"直接当真。
 *
 * system_confidence 计算因子：
 * 1. top1 - top2 gap（gap 越大越确定）
 * 2. 高成本动作惩罚（delegate/execute 天然需要更高置信度）
 * 3. 缺信息惩罚
 * 4. 高风险动作惩罚
 * 5. 模糊特征惩罚
 * 6. KB-1: 知识边界校准（未知-by-definition 惩罚）
 */

import type {
  ManagerDecisionType,
  DecisionFeatures,
  GatingConfig,
  KnowledgeBoundarySignal,
} from "../../types/index.js";
import { DEFAULT_GATING_CONFIG } from "./gating-config.js";
import { hasStrongBoundarySignal } from "./knowledge-boundary-signals.js";

/**
 * KB-1 知识边界惩罚系数。
 * 当 selected_action = direct_answer 且命中强 knowledge boundary signal 时使用。
 * 0.75 = 将 direct_answer 的置信度降低 25%，但不完全归零（保留 delegate 的机会）。
 */
const KB_DIRECT_ANSWER_PENALTY = 0.75;

/**
 * 计算 system_confidence
 *
 * @param llmScores                 LLM 输出的各动作原始分数（0.0 ~ 1.0）
 * @param llmConfidenceHint         LLM 自报置信度（参考值）
 * @param features                  LLM 输出的结构化特征
 * @param config                    可配置参数（默认使用 DEFAULT_GATING_CONFIG）
 * @param knowledgeBoundarySignals   KB-1: 知识边界信号数组（可选）
 * @returns system_confidence（0.0 ~ 1.0）
 */
export function calculateSystemConfidence(
  llmScores: Record<ManagerDecisionType, number>,
  llmConfidenceHint: number,
  features: DecisionFeatures,
  config: GatingConfig = DEFAULT_GATING_CONFIG,
  knowledgeBoundarySignals?: KnowledgeBoundarySignal[]
): number {
  // 1. 排序分数，计算 gap
  const sortedScores = Object.values(llmScores).sort((a, b) => b - a);
  const top1 = sortedScores[0] ?? 0;
  const top2 = sortedScores[1] ?? 0;
  const gap = Math.max(0, top1 - top2);

  // 2. 基础置信度：gap 贡献更大（gap 是客观信号）
  let confidence = llmConfidenceHint * 0.4 + gap * 0.6;

  // 3. 高成本动作惩罚
  const selectedAction = getSelectedAction(llmScores);
  if (selectedAction === "execute_task") confidence *= 0.85;
  if (selectedAction === "delegate_to_slow") confidence *= 0.92;

  // 4. 缺信息惩罚
  if (features.missing_info) confidence *= 0.80;

  // 5. 高风险动作惩罚
  if (features.high_risk_action) confidence *= 0.80;

  // 6. 模糊特征惩罚
  if (features.query_too_vague) confidence *= 0.85;

  // 7. 需要长推理（对 delegate 来说是加分项，对 direct 来说是减分项）
  // 这项让"需要长推理"在 delegate 场景下不会因为缺少外部特征而扣分
  if (features.needs_long_reasoning && selectedAction === "direct_answer") {
    confidence *= 0.90;
  }

  // 8. KB-1: 知识边界校准
  // 若 selected_action = direct_answer 且存在强 knowledge boundary signal，
  // 说明这类问题属于"参数内不可靠回答"，应降低 direct_answer 的置信度
  // 这不是"强制路由"，而是"让 direct_answer 不值得信任"
  if (
    selectedAction === "direct_answer" &&
    knowledgeBoundarySignals &&
    hasStrongBoundarySignal(knowledgeBoundarySignals, 0.80)
  ) {
    confidence *= KB_DIRECT_ANSWER_PENALTY;
  }

  return Math.max(0, Math.min(1, confidence));
}

/**
 * 从各动作分数中选出最高分动作
 */
export function getSelectedAction(
  scores: Record<ManagerDecisionType, number>
): ManagerDecisionType {
  let bestAction: ManagerDecisionType = "direct_answer";
  let bestScore = -1;

  for (const [action, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestAction = action as ManagerDecisionType;
    }
  }

  return bestAction;
}
