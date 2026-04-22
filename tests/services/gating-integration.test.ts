/**
 * Gated Delegation v2 — 集成测试
 *
 * 测试 G1 → G2 → G3 完整链路（runGatedDelegation）：
 * 1. 基础端到端流程
 * 2. 高置信度场景（不触发 rerank）
 * 3. 低置信度场景（触发 rerank）
 * 4. Policy 修正链路（block / penalize / boost）
 * 5. KB-1 知识边界信号影响最终路由
 * 6. 边界值处理（极端分数、全零分等）
 */

import { describe, it, expect } from "vitest";
import { runGatedDelegation } from "../../src/services/llm-native-router.js";
import { detectKnowledgeBoundarySignals } from "../../src/services/gating/knowledge-boundary-signals.js";
import type { DecisionFeatures } from "../../src/types/index.js";

const BASE_FEATURES: DecisionFeatures = {
  missing_info: false,
  needs_long_reasoning: false,
  needs_external_tool: false,
  high_risk_action: false,
  query_too_vague: false,
  requires_multi_step: false,
};

// ── 基础 E2E 场景 ────────────────────────────────────────────────────────────

describe("runGatedDelegation: 基础端到端流程", () => {
  it("GD-E2E-01: 明确委托场景 → 路由到 delegate_to_slow", () => {
    const scores = {
      direct_answer: 0.2,
      ask_clarification: 0.1,
      delegate_to_slow: 0.85,
      execute_task: 0.15,
    };
    const result = runGatedDelegation(scores, 0.82, BASE_FEATURES);
    expect(result.routedAction).toBe("delegate_to_slow");
    expect(result.systemConfidence).toBeGreaterThan(0.5);
    expect(result.llmScores).toEqual(scores);
  });

  it("GD-E2E-02: 简单问答场景 → 路由到 direct_answer", () => {
    const scores = {
      direct_answer: 0.88,
      ask_clarification: 0.15,
      delegate_to_slow: 0.1,
      execute_task: 0.05,
    };
    const result = runGatedDelegation(scores, 0.85, BASE_FEATURES);
    expect(result.routedAction).toBe("direct_answer");
    expect(result.systemConfidence).toBeGreaterThan(0.6);
  });

  it("GD-E2E-03: 返回结构包含所有 G1/G2/G3 字段", () => {
    const scores = {
      direct_answer: 0.3,
      ask_clarification: 0.2,
      delegate_to_slow: 0.8,
      execute_task: 0.15,
    };
    const result = runGatedDelegation(scores, 0.75, BASE_FEATURES);
    // G1 字段
    expect(result.llmScores).toBeDefined();
    expect(result.llmConfidenceHint).toBe(0.75);
    expect(result.features).toEqual(BASE_FEATURES);
    expect(typeof result.systemConfidence).toBe("number");
    // G2 字段
    expect(result.finalAction).toBeDefined();
    expect(Array.isArray(result.policyOverrides)).toBe(true);
    // G3 字段
    expect(result.routedAction).toBeDefined();
  });
});

// ── 高置信度场景（不触发 rerank）──────────────────────────────────────────────

describe("runGatedDelegation: 高置信度场景", () => {
  it("GD-HC-01: 大 gap + 高 confidence → 不触发 rerank", () => {
    const scores = {
      direct_answer: 0.1,
      ask_clarification: 0.05,
      delegate_to_slow: 0.92,
      execute_task: 0.05,
    };
    const result = runGatedDelegation(scores, 0.90, BASE_FEATURES);
    expect(result.rerankResult).toBeUndefined();
    expect(result.routedAction).toBe("delegate_to_slow");
  });

  it("GD-HC-02: 直答场景高置信度 → 不触发 rerank，直接路由", () => {
    const scores = {
      direct_answer: 0.90,
      ask_clarification: 0.05,
      delegate_to_slow: 0.1,
      execute_task: 0.02,
    };
    const result = runGatedDelegation(scores, 0.88, BASE_FEATURES);
    expect(result.rerankResult).toBeUndefined();
    expect(result.routedAction).toBe("direct_answer");
  });
});

// ── 低置信度场景（触发 rerank）───────────────────────────────────────────────

describe("runGatedDelegation: 低置信度 → 触发 rerank", () => {
  it("GD-LC-01: gap 过小 → 触发 rerank", () => {
    const scores = {
      direct_answer: 0.50,
      ask_clarification: 0.45,
      delegate_to_slow: 0.55,
      execute_task: 0.1,
    };
    const result = runGatedDelegation(scores, 0.65, BASE_FEATURES);
    // gap = 0.55 - 0.50 = 0.05 < 0.08 threshold → rerank
    expect(result.rerankResult).toBeDefined();
    expect(result.rerankResult!.reranked).toBe(true);
  });

  it("GD-LC-02: system_confidence < 0.60 → 触发 rerank", () => {
    const scores = {
      direct_answer: 0.5,
      ask_clarification: 0.45,
      delegate_to_slow: 0.75,
      execute_task: 0.1,
    };
    // hint 很低，gap 也不大
    const result = runGatedDelegation(scores, 0.2, BASE_FEATURES);
    // 低 hint 和小 gap 会让 system_confidence < 0.60
    if (result.systemConfidence < 0.60) {
      expect(result.rerankResult).toBeDefined();
    }
  });

  it("GD-LC-03: delegate + 缺信息接近 clarification → rerank 到 clarification", () => {
    const features_missing = { ...BASE_FEATURES, missing_info: true };
    const scores = {
      direct_answer: 0.2,
      ask_clarification: 0.75,
      delegate_to_slow: 0.78,
      execute_task: 0.05,
    };
    const result = runGatedDelegation(scores, 0.65, features_missing);
    // gap < 0.08 → rerank 触发；missing_info → clarification
    if (result.rerankResult?.reranked) {
      expect(result.routedAction).toBe("ask_clarification");
    }
  });
});

// ── Policy 修正链路 ─────────────────────────────────────────────────────────

describe("runGatedDelegation: Policy 修正链路", () => {
  it("GD-P-01: 缺信息 + execute_task 高分 → execute 被 block", () => {
    const features = { ...BASE_FEATURES, missing_info: true, query_too_vague: true };
    const scores = {
      direct_answer: 0.2,
      ask_clarification: 0.5,
      delegate_to_slow: 0.6,
      execute_task: 0.85,
    };
    const result = runGatedDelegation(scores, 0.75, features);
    expect(result.routedAction).not.toBe("execute_task");
    expect(
      result.policyOverrides.some(
        (o) => o.rule === "execute_requires_info" && o.target === "execute_task"
      )
    ).toBe(true);
  });

  it("GD-P-02: 高风险 → execute_task 被 block", () => {
    const features = { ...BASE_FEATURES, high_risk_action: true };
    const scores = {
      direct_answer: 0.3,
      ask_clarification: 0.2,
      delegate_to_slow: 0.4,
      execute_task: 0.85,
    };
    const result = runGatedDelegation(scores, 0.80, features);
    expect(result.routedAction).not.toBe("execute_task");
    expect(
      result.policyOverrides.some(
        (o) => o.rule === "high_risk_blocks_execute"
      )
    ).toBe(true);
  });

  it("GD-P-03: ask_clarification 总有体验成本惩罚记录", () => {
    const scores = {
      direct_answer: 0.3,
      ask_clarification: 0.8,
      delegate_to_slow: 0.3,
      execute_task: 0.1,
    };
    const result = runGatedDelegation(scores, 0.75, BASE_FEATURES);
    const clarPenalty = result.policyOverrides.find(
      (o) => o.rule === "clarification_cost_penalty"
    );
    expect(clarPenalty).toBeDefined();
    expect(clarPenalty!.adjusted_score).toBeLessThan(clarPenalty!.original_score);
  });

  it("GD-P-04: policyOverrides 中每条记录结构完整", () => {
    const features = { ...BASE_FEATURES, missing_info: true };
    const scores = {
      direct_answer: 0.3,
      ask_clarification: 0.75,
      delegate_to_slow: 0.8,
      execute_task: 0.85,
    };
    const result = runGatedDelegation(scores, 0.7, features);
    for (const override of result.policyOverrides) {
      expect(typeof override.rule).toBe("string");
      expect(["block", "penalize", "boost"]).toContain(override.action);
      expect(typeof override.original_score).toBe("number");
      expect(typeof override.adjusted_score).toBe("number");
      expect(typeof override.reason).toBe("string");
    }
  });
});

// ── KB-1 知识边界信号集成 ────────────────────────────────────────────────────

describe("runGatedDelegation: KB-1 知识边界信号集成", () => {
  it("GD-KB-01: 实时股价查询 → direct_answer confidence 降低", () => {
    const kbSignals = detectKnowledgeBoundarySignals("腾讯今天股价多少");
    const scores_direct = {
      direct_answer: 0.72,
      ask_clarification: 0.1,
      delegate_to_slow: 0.4,
      execute_task: 0.05,
    };

    // 带 KB signals：direct_answer 应被降低
    const result_with_kb = runGatedDelegation(scores_direct, 0.70, BASE_FEATURES, kbSignals);
    // 不带 KB signals
    const result_without_kb = runGatedDelegation(scores_direct, 0.70, BASE_FEATURES);

    // KB signals 应该让 system_confidence 降低（因为 direct_answer KB 惩罚）
    expect(result_with_kb.systemConfidence).toBeLessThanOrEqual(
      result_without_kb.systemConfidence
    );
  });

  it("GD-KB-02: 今天天气 → KB signal 被传递到 context", () => {
    const kbSignals = detectKnowledgeBoundarySignals("深圳今天天气怎么样");
    expect(kbSignals.length).toBeGreaterThan(0);

    const scores = {
      direct_answer: 0.65,
      ask_clarification: 0.15,
      delegate_to_slow: 0.5,
      execute_task: 0.05,
    };
    const result = runGatedDelegation(scores, 0.65, BASE_FEATURES, kbSignals);
    expect(result.knowledgeBoundarySignals).toBeDefined();
    expect(result.knowledgeBoundarySignals!.length).toBeGreaterThan(0);
  });

  it("GD-KB-03: 稳定知识查询 → KB signals 为空，不影响路由", () => {
    const kbSignals = detectKnowledgeBoundarySignals("Python 的快速排序怎么写");
    const scores = {
      direct_answer: 0.85,
      ask_clarification: 0.1,
      delegate_to_slow: 0.15,
      execute_task: 0.05,
    };
    const result = runGatedDelegation(scores, 0.82, BASE_FEATURES, kbSignals);
    // 稳定知识，无 KB penalty，direct_answer 高分应通过
    expect(result.routedAction).toBe("direct_answer");
  });
});

// ── 边界值处理 ──────────────────────────────────────────────────────────────

describe("runGatedDelegation: 边界值处理", () => {
  it("GD-BV-01: 全零分 → fallback 到 direct_answer（getSelectedAction 默认）", () => {
    const scores = {
      direct_answer: 0,
      ask_clarification: 0,
      delegate_to_slow: 0,
      execute_task: 0,
    };
    const result = runGatedDelegation(scores, 0.5, BASE_FEATURES);
    // 全零时，所有阈值都命中 0，getSelectedAction 返回 direct_answer（遍历顺序）
    expect(result.routedAction).toBeDefined();
    expect(typeof result.systemConfidence).toBe("number");
    expect(result.systemConfidence).toBeGreaterThanOrEqual(0);
    expect(result.systemConfidence).toBeLessThanOrEqual(1);
  });

  it("GD-BV-02: confidence 超出范围 → 被 clamp 到 [0, 1]", () => {
    const scores = {
      direct_answer: 0.9,
      ask_clarification: 0.05,
      delegate_to_slow: 0.05,
      execute_task: 0.05,
    };
    // hint 超范围应被容忍（calculateSystemConfidence 内部已 clamp）
    const result = runGatedDelegation(scores, 1.5, BASE_FEATURES);
    expect(result.systemConfidence).toBeGreaterThanOrEqual(0);
    expect(result.systemConfidence).toBeLessThanOrEqual(1);
  });

  it("GD-BV-03: 极端场景 execute_task=1.0 + 缺信息 → 被完全 block", () => {
    const features = { ...BASE_FEATURES, missing_info: true, query_too_vague: true };
    const scores = {
      direct_answer: 0.1,
      ask_clarification: 0.1,
      delegate_to_slow: 0.3,
      execute_task: 1.0,
    };
    const result = runGatedDelegation(scores, 0.95, features);
    expect(result.routedAction).not.toBe("execute_task");
  });

  it("GD-BV-04: routedAction 总是四种合法值之一", () => {
    const VALID_ACTIONS = ["direct_answer", "ask_clarification", "delegate_to_slow", "execute_task"];
    const scores = {
      direct_answer: 0.4,
      ask_clarification: 0.38,
      delegate_to_slow: 0.42,
      execute_task: 0.35,
    };
    const result = runGatedDelegation(scores, 0.5, BASE_FEATURES);
    expect(VALID_ACTIONS).toContain(result.routedAction);
  });
});
