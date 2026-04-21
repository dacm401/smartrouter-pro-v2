/**
 * KB-1: Knowledge Boundary Signals — 单元测试
 *
 * 测试目标：
 * 1. 各 cluster 能正确识别对应的 unknown-by-definition query
 * 2. 误伤保护（creative query 不应命中）
 * 3. 强度计算正确
 * 4. 去重正确（同类型保留最强）
 * 5. 空输入/普通知识查询不误报
 */

import { describe, it, expect } from "vitest";
import {
  detectKnowledgeBoundarySignals,
  hasStrongBoundarySignal,
  getStrongestSignal,
  isCalibratableSignal,
} from "../../src/services/gating/knowledge-boundary-signals.js";
import type { KnowledgeBoundarySignal } from "../../src/types/index.js";

// ── 辅助 ──────────────────────────────────────────────────────────────────

function findSignal(
  signals: KnowledgeBoundarySignal[],
  type: string
): KnowledgeBoundarySignal | undefined {
  return signals.find((s) => s.type === type);
}

// ── Cluster 1: 实时天气 ──────────────────────────────────────────────────────

describe("KB Signals: live_weather_data", () => {
  it("KB-W01: 深圳今天天气怎么样 → 命中 live_weather_data", () => {
    const signals = detectKnowledgeBoundarySignals("深圳今天天气怎么样");
    const s = findSignal(signals, "live_weather_data");
    expect(s).toBeDefined();
    expect(s!.strength).toBeGreaterThanOrEqual(0.85);
    expect(s!.reasons.length).toBeGreaterThan(0);
  });

  it("KB-W02: 今天天气如何 → 命中强度 ≥ 0.85", () => {
    const signals = detectKnowledgeBoundarySignals("今天天气如何");
    const s = findSignal(signals, "live_weather_data");
    expect(s).toBeDefined();
    expect(s!.strength).toBeGreaterThanOrEqual(0.85);
  });

  it("KB-W03: What's the weather like today? → 命中英文天气", () => {
    const signals = detectKnowledgeBoundarySignals("What's the weather like in Tokyo today?");
    const s = findSignal(signals, "live_weather_data");
    expect(s).toBeDefined();
  });

  it("KB-W04: 现在气温多少 → 命中 weather", () => {
    const signals = detectKnowledgeBoundarySignals("现在气温多少度");
    const s = findSignal(signals, "live_weather_data");
    expect(s).toBeDefined();
  });

  it("KB-W05: 下雨吗 → 命中 weather", () => {
    const signals = detectKnowledgeBoundarySignals("今天会下雨吗");
    const s = findSignal(signals, "live_weather_data");
    expect(s).toBeDefined();
  });

  it("KB-W06: 误伤保护：给我写一首关于天气的诗 → 不命中强 weather signal", () => {
    const signals = detectKnowledgeBoundarySignals("帮我写一首关于天气变化的诗");
    const s = findSignal(signals, "live_weather_data");
    // 创作类不应命中强 weather signal（无时态词，无具体查询意图）
    if (s) expect(s.strength).toBeLessThan(0.90);
  });

  it("KB-W07: 误伤保护：Python的天气模块有哪些 → 不命中 weather", () => {
    const signals = detectKnowledgeBoundarySignals("Python有哪些处理天气数据的库");
    const s = findSignal(signals, "live_weather_data");
    expect(s).toBeUndefined();
  });
});

// ── Cluster 2: 实时市场数据 ────────────────────────────────────────────────

describe("KB Signals: live_market_data", () => {
  it("KB-M01: 腾讯今天股价多少 → 命中 live_market_data", () => {
    const signals = detectKnowledgeBoundarySignals("腾讯今天股价多少");
    const s = findSignal(signals, "live_market_data");
    expect(s).toBeDefined();
    expect(s!.strength).toBeGreaterThanOrEqual(0.88);
  });

  it("KB-M02: 美元兑人民币现在多少 → 命中 market", () => {
    const signals = detectKnowledgeBoundarySignals("美元兑人民币现在多少");
    const s = findSignal(signals, "live_market_data");
    expect(s).toBeDefined();
  });

  it("KB-M03: What is Tesla stock price now? → 命中英文 market", () => {
    const signals = detectKnowledgeBoundarySignals("What is Tesla stock price right now?");
    const s = findSignal(signals, "live_market_data");
    expect(s).toBeDefined();
  });

  it("KB-M04: 黄金当前价格 → 命中 market", () => {
    const signals = detectKnowledgeBoundarySignals("黄金当前价格");
    const s = findSignal(signals, "live_market_data");
    expect(s).toBeDefined();
  });

  it("KB-M05: 苹果公司涨停了吗 → 命中 market", () => {
    const signals = detectKnowledgeBoundarySignals("苹果公司涨停了吗");
    const s = findSignal(signals, "live_market_data");
    expect(s).toBeDefined();
  });

  it("KB-M06: 误伤保护：股价的数学模型有哪些 → 不命中 market", () => {
    const signals = detectKnowledgeBoundarySignals("有哪些用于预测股价的数学模型");
    const s = findSignal(signals, "live_market_data");
    expect(s).toBeUndefined();
  });
});

// ── Cluster 3: 最新新闻 ────────────────────────────────────────────────────

describe("KB Signals: live_news_data", () => {
  it("KB-N01: 今天有什么 AI 新闻 → 命中 live_news_data", () => {
    const signals = detectKnowledgeBoundarySignals("今天有什么 AI 新闻");
    const s = findSignal(signals, "live_news_data");
    expect(s).toBeDefined();
    expect(s!.strength).toBeGreaterThanOrEqual(0.82);
  });

  it("KB-N02: 最新科技头条 → 命中 news", () => {
    const signals = detectKnowledgeBoundarySignals("最新科技头条");
    const s = findSignal(signals, "live_news_data");
    expect(s).toBeDefined();
  });

  it("KB-N03: What's the latest news about OpenAI? → 命中英文 news", () => {
    const signals = detectKnowledgeBoundarySignals("What's the latest news about OpenAI?");
    const s = findSignal(signals, "live_news_data");
    expect(s).toBeDefined();
  });

  it("KB-N04: 刚刚发生了什么大事 → 命中 news", () => {
    const signals = detectKnowledgeBoundarySignals("刚刚发生了什么大事");
    const s = findSignal(signals, "live_news_data");
    expect(s).toBeDefined();
  });

  it("KB-N05: 误伤保护：新闻传播学的研究方法有哪些 → 不命中 news", () => {
    const signals = detectKnowledgeBoundarySignals("新闻传播学有哪些常见的研究方法");
    const s = findSignal(signals, "live_news_data");
    expect(s).toBeUndefined();
  });
});

// ── Cluster 4: 比赛比分/赛果 ──────────────────────────────────────────────

describe("KB Signals: live_result_or_score", () => {
  it("KB-S01: 今天湖人比赛结果 → 命中 live_result_or_score", () => {
    const signals = detectKnowledgeBoundarySignals("今天湖人比赛结果");
    const s = findSignal(signals, "live_result_or_score");
    expect(s).toBeDefined();
    expect(s!.strength).toBeGreaterThanOrEqual(0.86);
  });

  it("KB-S02: 昨晚的足球比赛谁赢了 → 命中 score", () => {
    const signals = detectKnowledgeBoundarySignals("昨晚的足球比赛谁赢了");
    const s = findSignal(signals, "live_result_or_score");
    expect(s).toBeDefined();
  });

  it("KB-S03: NBA latest score → 命中英文 score", () => {
    const signals = detectKnowledgeBoundarySignals("What's the NBA score now?");
    const s = findSignal(signals, "live_result_or_score");
    expect(s).toBeDefined();
  });

  it("KB-S04: Who won the match today? → 命中 score", () => {
    const signals = detectKnowledgeBoundarySignals("Who won the match today?");
    const s = findSignal(signals, "live_result_or_score");
    expect(s).toBeDefined();
  });

  it("KB-S05: 误伤保护：如何提高篮球比赛的比分技巧 → 不命中 score", () => {
    const signals = detectKnowledgeBoundarySignals("如何提高篮球比赛的得分技巧");
    const s = findSignal(signals, "live_result_or_score");
    expect(s).toBeUndefined();
  });
});

// ── Cluster 5: 当前时间/日期依赖 ─────────────────────────────────────────

describe("KB Signals: current_environment_fact", () => {
  it("KB-T01: 今天星期几 → 命中 current_environment_fact", () => {
    const signals = detectKnowledgeBoundarySignals("今天星期几");
    const s = findSignal(signals, "current_environment_fact");
    expect(s).toBeDefined();
    expect(s!.strength).toBeGreaterThanOrEqual(0.90);
  });

  it("KB-T02: 现在北京时间几点 → 命中 time", () => {
    const signals = detectKnowledgeBoundarySignals("现在北京时间几点");
    const s = findSignal(signals, "current_environment_fact");
    expect(s).toBeDefined();
  });

  it("KB-T03: What day is it today? → 命中英文 time", () => {
    const signals = detectKnowledgeBoundarySignals("What day is it today?");
    const s = findSignal(signals, "current_environment_fact");
    expect(s).toBeDefined();
  });

  it("KB-T04: 今天几号了 → 命中 date", () => {
    const signals = detectKnowledgeBoundarySignals("今天几号了");
    const s = findSignal(signals, "current_environment_fact");
    expect(s).toBeDefined();
  });
});

// ── Cluster 6: 时间敏感公共事实 ────────────────────────────────────────────

describe("KB Signals: time_sensitive_public_fact", () => {
  it("KB-TS01: 最新 AI 研究成果有哪些 → 命中 time_sensitive", () => {
    const signals = detectKnowledgeBoundarySignals("最新 AI 研究成果有哪些");
    const s = findSignal(signals, "time_sensitive_public_fact");
    expect(s).toBeDefined();
  });

  it("KB-TS02: 当前最新的疫情防控政策是什么 → 命中 time_sensitive", () => {
    const signals = detectKnowledgeBoundarySignals("当前最新的疫情防控政策是什么");
    const s = findSignal(signals, "time_sensitive_public_fact");
    expect(s).toBeDefined();
  });
});

// ── 普通知识查询（不误报） ──────────────────────────────────────────────────

describe("KB Signals: no false positive on stable knowledge", () => {
  const stableQueries = [
    "牛顿三大定律是什么",
    "Python是什么编程语言",
    "如何用 Python 写一个快速排序",
    "解释一下相对论的基本原理",
    "给我写一个问候用户的函数",
    "帮我分析一下这个词的意思",
    "Python 和 JavaScript 有什么区别",
    "设计一个高并发系统的架构",
    "Hello World 的中文是什么",
  ];

  stableQueries.forEach((q) => {
    it(`KB-ST01: "${q}" → 不应命中强 knowledge boundary signal`, () => {
      const signals = detectKnowledgeBoundarySignals(q);
      // 允许有微弱 signal（0.75 以下），但不应有强 signal
      const hasStrong = hasStrongBoundarySignal(signals, 0.80);
      expect(hasStrong).toBe(false);
    });
  });
});

// ── 工具函数测试 ───────────────────────────────────────────────────────────

describe("KB Signals: utility functions", () => {
  it("hasStrongBoundarySignal: 有 ≥ 0.80 signal 时返回 true", () => {
    const signals = detectKnowledgeBoundarySignals("深圳今天天气怎么样");
    expect(hasStrongBoundarySignal(signals, 0.80)).toBe(true);
  });

  it("hasStrongBoundarySignal: 无强 signal 时返回 false", () => {
    const signals = detectKnowledgeBoundarySignals("Python是什么");
    expect(hasStrongBoundarySignal(signals, 0.80)).toBe(false);
  });

  it("getStrongestSignal: 返回强度最高的 signal", () => {
    const signals = detectKnowledgeBoundarySignals("今天星期几");
    const strongest = getStrongestSignal(signals);
    expect(strongest).toBeDefined();
    expect(strongest!.type).toBe("current_environment_fact");
    expect(strongest!.strength).toBe(0.90);
  });

  it("getStrongestSignal: 空数组返回 null", () => {
    const signals: KnowledgeBoundarySignal[] = [];
    expect(getStrongestSignal(signals)).toBeNull();
  });

  it("isCalibratableSignal: 强度 ≥ 0.75 的 signal 可参与校准", () => {
    const signals = detectKnowledgeBoundarySignals("今天星期几");
    const s = findSignal(signals, "current_environment_fact");
    expect(s).toBeDefined();
    expect(isCalibratableSignal(s!)).toBe(true);
  });

  it("isCalibratableSignal: 强度 < 0.75 不参与校准", () => {
    // 一个自定义的低强度 signal
    const weakSignal: KnowledgeBoundarySignal = {
      id: "test-weak",
      type: "time_sensitive_public_fact",
      strength: 0.60,
      reasons: ["test"],
      matched_patterns: ["test"],
    };
    expect(isCalibratableSignal(weakSignal)).toBe(false);
  });

  it("空输入返回空数组", () => {
    expect(detectKnowledgeBoundarySignals("")).toHaveLength(0);
    expect(detectKnowledgeBoundarySignals("   ")).toHaveLength(0);
    expect(detectKnowledgeBoundarySignals("")).toHaveLength(0);
  });

  it("去重：同一类型多个匹配保留最强 signal", () => {
    // 两个 cluster 都命中 live_weather_data 的 case
    const signals = detectKnowledgeBoundarySignals("今天天气气温多少度");
    const weatherSignals = signals.filter((s) => s.type === "live_weather_data");
    expect(weatherSignals.length).toBeLessThanOrEqual(1);
  });
});
