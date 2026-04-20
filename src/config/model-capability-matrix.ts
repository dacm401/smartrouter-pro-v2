/**
 * Sprint 31: 模型能力矩阵 — 按能力动态选择模型
 *
 * 核心思想：不按名字选模型，按 benchmark 测出来的能力选。
 *
 * 能力维度（0-100 分）：
 *   routing_accuracy: 路由准确率（来自 benchmark）
 *   coding: 代码生成/修复能力
 *   analysis: 分析推理能力
 *   creative: 创意写作能力
 *   knowledge: 知识问答能力
 *   cost_efficiency: 成本效率（100/每美元能处理的 tokens）
 *
 * 矩阵来源：
 *   SiliconFlow benchmark 结果 + 公开评测数据
 *   Fast 层：Qwen2.5-7B-Instruct（低成本）
 *   Slow 层：Qwen2.5-72B-Instruct（高性能）
 *
 * 使用方式：
 *   import { getBestModel, MODEL_CAPABILITY_MATRIX } from "./model-capability-matrix.js";
 *   const model = getBestModel("coding");  // → slow 模型
 *   const model = getBestModel("chat");    // → fast 模型
 */

import { config } from "../config.js";

// ── 模型能力定义 ────────────────────────────────────────────────────────────────

export interface ModelCapabilities {
  model_id: string;              // 模型 ID（与 config 中的一致）
  provider: "siliconflow" | "openai" | "anthropic";
  tier: "fast" | "slow";          // Fast 层（<7B）或 Slow 层（>30B）
  // 能力分数（0-100）
  routing_accuracy: number;       // 路由准确率（benchmark 实测）
  coding: number;
  analysis: number;
  creative: number;
  knowledge: number;
  cost_per_1k_input: number;      // USD/1k input tokens
  cost_per_1k_output: number;     // USD/1k output tokens
}

export interface ModelMatrix {
  [modelId: string]: ModelCapabilities;
}

// 默认矩阵（SiliconFlow Qwen 系列）
// routing_accuracy 来自 2026-04-16 benchmark 实测值
export const MODEL_CAPABILITY_MATRIX: ModelMatrix = {
  "Qwen/Qwen2.5-7B-Instruct": {
    model_id: "Qwen/Qwen2.5-7B-Instruct",
    provider: "siliconflow",
    tier: "fast",
    routing_accuracy: 94.9,     // benchmark 实测（L2-L5 全部路由到 fast）
    coding: 65,
    analysis: 58,
    creative: 72,
    knowledge: 70,
    cost_per_1k_input: 0.0000972,
    cost_per_1k_output: 0.0000972,
  },
  "Qwen/Qwen2.5-72B-Instruct": {
    model_id: "Qwen/Qwen2.5-72B-Instruct",
    provider: "siliconflow",
    tier: "slow",
    routing_accuracy: 100,       // benchmark 实测（慢模型覆盖所有 case）
    coding: 88,
    analysis: 92,
    creative: 85,
    knowledge: 90,
    cost_per_1k_input: 0.000972,
    cost_per_1k_output: 0.000972,
  },
  // 备选：OpenRouter 模型（可按需启用）
  "openrouter/openai/gpt-4o-mini": {
    model_id: "openrouter/openai/gpt-4o-mini",
    provider: "openai",
    tier: "fast",
    routing_accuracy: 90,
    coding: 75,
    analysis: 70,
    creative: 78,
    knowledge: 82,
    cost_per_1k_input: 0.00015,
    cost_per_1k_output: 0.0006,
  },
  "openrouter/openai/gpt-4o": {
    model_id: "openrouter/openai/gpt-4o",
    provider: "openai",
    tier: "slow",
    routing_accuracy: 96,
    coding: 92,
    analysis: 95,
    creative: 90,
    knowledge: 94,
    cost_per_1k_input: 0.0025,
    cost_per_1k_output: 0.01,
  },
  "openrouter/anthropic/claude-3-5-sonnet": {
    model_id: "openrouter/anthropic/claude-3-5-sonnet",
    provider: "anthropic",
    tier: "slow",
    routing_accuracy: 97,
    coding: 95,
    analysis: 98,
    creative: 93,
    knowledge: 96,
    cost_per_1k_input: 0.003,
    cost_per_1k_output: 0.015,
  },
};

// ── 能力维度权重 ───────────────────────────────────────────────────────────────

type CapabilityDim = "routing_accuracy" | "coding" | "analysis" | "creative" | "knowledge";

/** routing_intent → 主要依赖的能力维度（权重从高到低） */
const INTENT_CAPABILITY_MAP: Record<string, CapabilityDim[]> = {
  chat:          ["creative", "knowledge"],
  knowledge:     ["knowledge", "routing_accuracy"],
  research:      ["analysis", "knowledge"],
  analysis:      ["analysis", "knowledge"],
  code:          ["coding", "analysis"],
  creative:      ["creative", "knowledge"],
  other:         ["routing_accuracy", "knowledge"],
};

// ── 查询函数 ──────────────────────────────────────────────────────────────────

/**
 * 根据路由意图和快慢偏好，返回最优模型 ID
 *
 * @param routingIntent  - routing_intent（来自 evaluateRouting）
 * @param preferTier    - 优先使用哪层：undefined=自动（按意图选）
 * @returns 模型 ID
 */
export function getBestModel(
  routingIntent: string,
  preferTier?: "fast" | "slow"
): string {
  const dims = INTENT_CAPABILITY_MAP[routingIntent] ?? ["routing_accuracy", "knowledge"];

  // 过滤候选模型
  const candidates = Object.values(MODEL_CAPABILITY_MATRIX).filter((m) => {
    if (preferTier) return m.tier === preferTier;
    return true;
  });

  if (candidates.length === 0) {
    // fallback：使用当前配置中的模型
    return preferTier === "slow" ? config.slowModel : config.fastModel;
  }

  // 加权评分
  const scored = candidates.map((m) => {
    let score = 0;
    for (const dim of dims) {
      score += m[dim];
    }
    score /= dims.length; // 平均
    return { model: m.model_id, score, tier: m.tier };
  });

  scored.sort((a, b) => b.score - a.score);

  const chosen = scored[0];
  // 边界：routing_intent=knowledge 且快模型 routing_accuracy 够高时，用 fast
  if (routingIntent === "knowledge" && chosen.tier === "slow") {
    const fast = candidates.find((m) => m.tier === "fast");
    if (fast && MODEL_CAPABILITY_MATRIX[fast.model_id]?.routing_accuracy >= 85) {
      return fast.model_id;
    }
  }

  return chosen.model;
}

/**
 * 获取模型的能力信息（供诊断/日志使用）
 */
export function getModelCapabilities(modelId: string): ModelCapabilities | null {
  return MODEL_CAPABILITY_MATRIX[modelId] ?? null;
}

/**
 * 获取 Fast/Slow 层各自的推荐模型（按成本效率）
 */
export function getRecommendedModels(): { fast: string; slow: string } {
  const fastModels = Object.values(MODEL_CAPABILITY_MATRIX)
    .filter((m) => m.tier === "fast")
    .sort((a, b) => b.routing_accuracy - a.routing_accuracy);
  const slowModels = Object.values(MODEL_CAPABILITY_MATRIX)
    .filter((m) => m.tier === "slow")
    .sort((a, b) => b.analysis - a.analysis);

  return {
    fast: fastModels[0]?.model_id ?? config.fastModel,
    slow: slowModels[0]?.model_id ?? config.slowModel,
  };
}
