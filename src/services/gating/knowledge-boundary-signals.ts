/**
 * Knowledge Boundary Signals — KB-1 核心检测模块
 *
 * 【设计原则】
 * - 只检测，不动作：输出 signal，不决定路由
 * - 最小规则集：第一版不超过 8~12 个 cluster
 * - 信号优先，动作由 G1/G2/G3 校准后决定
 *
 * 【不做的】
 * - 不做 pattern → action 硬路由
 * - 不直接强制 delegate_to_slow
 * - 不直接调用工具
 * - 不改写用户请求
 *
 * ref: docs/KNOWLEDGE-BOUNDARY-CALIBRATION-v1.md
 */

import type {
  KnowledgeBoundarySignal,
  KnowledgeBoundarySignalType,
  KnowledgeBoundaryContext,
} from "../../types/index.js";

// ── Cluster Pattern 定义 ────────────────────────────────────────────────────

interface SignalPatternCluster {
  id: string;
  signalType: KnowledgeBoundarySignalType;
  /** strength 基础值（匹配时使用） */
  strength: number;
  /**
   * 匹配规则：
   * - 数组内多个 pattern 为 OR 关系（命中任一即匹配）
   * - 使用 .* 代替严格的顺序紧邻，允许关键词之间有其他文字
   * - 不做 AND（避免过度要求导致漏检）
   */
  patterns: Array<{ regex: RegExp; reason: string }>;
  /**
   * 时态联用检测：
   * 某些信号需要与当前时态词联用才高强度命中
   * 如果没有时态词，strength 打折扣
   */
  temporalBoostPatterns?: RegExp | RegExp[];
  /** temporal 联用时的 strength 加成 */
  temporalBoostStrength?: number;
}

/**
 * 第一版 cluster（6 个，共 10 个 pattern 组）。
 * 严格控制数量，每条规则说明存在理由。
 *
 * 设计依据：
 * - weather/stock/news/score/time 都属于"参数内不可靠"的已知类型
 * - 不依赖 LLM 自报，系统可直接识别
 * - 这类 case 的 direct_answer 应当被校准压制
 *
 * 【Pattern 编写原则】
 * - 使用 .* 而非严格的紧邻匹配，保证匹配灵活性
 * - 独立关键词足以识别类型时，直接写关键词
 * - 覆盖中英文双语
 */
const PATTERN_CLUSTERS: SignalPatternCluster[] = [
  // ── Cluster 1: 实时天气 ────────────────────────────────────────────────────
  {
    id: "kbs-weather-001",
    signalType: "live_weather_data",
    strength: 0.85,
    patterns: [
      { regex: /天气\s*(?:怎么样|如何|好吗)/i, reason: "天气查询意图 + 口语化表达" },
      { regex: /(?:今天|现在|今晚|今晚).*(?:天气|下雨|降雨|气温|温度|空气质量|雾霾)/i, reason: "时态词 + 天气相关" },
      { regex: /(?:会|有|下不下|会不会).*下雨/i, reason: "具体天气条件查询（会下雨）" },
      { regex: /weather.*(?:today|now|in\s+\w+)/i, reason: "英文天气查询" },
      { regex: /(?:温度|气温|降雨|雾霾|PM2\.5)/i, reason: "具体气象指标" },
    ],
    temporalBoostPatterns: /(?:今天|现在|今晚|今日|当前)/,
    temporalBoostStrength: 0.92,
  },

  // ── Cluster 2: 实时市场数据 ───────────────────────────────────────────────
  {
    id: "kbs-market-001",
    signalType: "live_market_data",
    strength: 0.88,
    patterns: [
      { regex: /(?:今天|现在|当前|今日).*(?:股价|涨了|跌了|涨跌幅)/i, reason: "股价 + 时态词" },
      { regex: /(?:腾讯|苹果|特斯拉|英伟达|谷歌|微软|茅台|比亚迪).*(?:今天|现在|当前)/i, reason: "具体股票 + 时态词" },
      { regex: /(?:美元|英镑|欧元|日元)\s*(?:兑|对|换)\s*(?:人民币|美元|英镑|欧元|日币)/i, reason: "汇率查询（常带实时性）" },
      { regex: /(?:当前|现在|今天|实时|黄金|原油).*(?:价格|汇价|币价)/i, reason: "实时金融价格查询" },
      { regex: /(?:黄金|原油|大宗商品).*(?:当前|今天|现在|价格)/i, reason: "大宗商品价格查询" },
      { regex: /stock\s*(?:price|quote|now|today)/i, reason: "英文股价查询" },
      { regex: /exchange\s*rate/i, reason: "英文汇率查询" },
      { regex: /(?:涨停|跌停|停牌)/i, reason: "市场交易状态查询" },
    ],
  },

  // ── Cluster 3: 最新新闻/当前事件 ──────────────────────────────────────────
  {
    id: "kbs-news-001",
    signalType: "live_news_data",
    strength: 0.82,
    patterns: [
      { regex: /(?:今天|最新|今日|刚刚|最近).*(?:新闻|头条|消息|发生了什么)/i, reason: "新闻 + 时态词" },
      { regex: /(?:有什么|有啥).*(?:新闻|新鲜事|头条)/i, reason: "询问今日内容" },
      { regex: /(?:AI|科技|国际|国内|财经).*(?:新闻|头条)/i, reason: "垂类新闻关键词" },
      { regex: /breaking\s*news|latest\s*news/i, reason: "英文突发/最新新闻" },
      { regex: /(?:刚刚|刚才)/i, reason: "刚发生事件" },
    ],
  },

  // ── Cluster 4: 比赛比分/赛果 ──────────────────────────────────────────────
  {
    id: "kbs-score-001",
    signalType: "live_result_or_score",
    strength: 0.86,
    patterns: [
      { regex: /(?:今天|昨晚|今晚|这场).*(?:比赛|足球|篮球|网球|欧冠|NBA|英超|世界杯|湖人|皇马|巴萨)/i, reason: "体育赛事 + 时态词" },
      { regex: /(?:赢了|输了|比分|赛果|战绩)/i, reason: "赛事结果查询" },
      { regex: /(?:谁赢了|哪个队赢了)/i, reason: "赛果确认类问题" },
      { regex: /(?:今晚|明早|今天).*(?:球赛|比赛|对决)/i, reason: "赛事安排查询" },
      { regex: /(?:match|score|result|who\s*won)/i, reason: "英文赛事查询" },
    ],
  },

  // ── Cluster 5: 当前时间/日期依赖事实 ─────────────────────────────────────
  {
    id: "kbs-time-001",
    signalType: "current_environment_fact",
    strength: 0.90,
    patterns: [
      { regex: /(?:今天|今日|本日).*(?:星期|周|几号|多少号|什么日子|星期几)/i, reason: "当前日期查询" },
      { regex: /(?:现在|此刻|当前).*(?:几点了|几点|时间|什么时候)/i, reason: "当前时间查询" },
      { regex: /(?:现在|当前).*(?:北京时间|当地时间|UTC|格林威治)/i, reason: "时区时间查询" },
      { regex: /(?:weekday|weekend|today'?s\s*date|current\s*time|what\s*day\s*is\s*it|what\s*time\s*is\s*it)/i, reason: "英文时间查询" },
    ],
  },

  // ── Cluster 6: 时间敏感公共事实 ───────────────────────────────────────────
  {
    id: "kbs-timesensitive-001",
    signalType: "time_sensitive_public_fact",
    strength: 0.72,
    patterns: [
      { regex: /(?:当前|今天|此刻|现在).*(?:政策|法规|标准|规定|法律)/i, reason: "时效性政策查询" },
      { regex: /(?:最新|最近|今日).*(?:研究|发现|突破|成果)/i, reason: "最新研究成果" },
      { regex: /(?:当前|今日|此刻).*(?:比赛|赛事|活动|会议|展览)/i, reason: "当前进行中的活动" },
      { regex: /(?:疫情|感染|确诊|防控)/i, reason: "公卫疫情相关查询" },
    ],
    temporalBoostPatterns: /(?:今天|现在|当前|此刻|今日|最近)/,
    temporalBoostStrength: 0.85,
  },
];

// ── 辅助函数 ────────────────────────────────────────────────────────────────

/**
 * 检测 message 是否命中给定 cluster。
 * 返回命中的 signal（如果有）或 null。
 */
function matchCluster(
  message: string,
  cluster: SignalPatternCluster
): KnowledgeBoundarySignal | null {
  const matchedPatterns: string[] = [];
  const reasons: string[] = [];

  // 检查主 pattern（每个 regex 独立测试）
  for (const { regex, reason } of cluster.patterns) {
    if (regex.test(message)) {
      matchedPatterns.push(regex.source);
      reasons.push(reason);
    }
  }

  if (matchedPatterns.length === 0) return null;

  // 计算最终 strength：有 temporal boost 时提升
  let strength = cluster.strength;
  if (cluster.temporalBoostPatterns && cluster.temporalBoostStrength) {
    const boostPatterns = Array.isArray(cluster.temporalBoostPatterns)
      ? cluster.temporalBoostPatterns
      : [cluster.temporalBoostPatterns];
    if (boostPatterns.some((p) => p.test(message))) {
      strength = cluster.temporalBoostStrength;
      reasons.push("时态词联用，强化信号");
    }
  }

  return {
    id: cluster.id,
    type: cluster.signalType,
    strength: Math.min(1, strength),
    reasons: [...new Set(reasons)], // 去重
    matched_patterns: matchedPatterns,
  };
}

/**
 * 对多个同类型 signal，保留最强的一个。
 * 避免一个请求产生多个同类信号。
 */
function dedupeSignals(signals: KnowledgeBoundarySignal[]): KnowledgeBoundarySignal[] {
  const byType = new Map<KnowledgeBoundarySignalType, KnowledgeBoundarySignal>();
  for (const s of signals) {
    const existing = byType.get(s.type);
    if (!existing || s.strength > existing.strength) {
      byType.set(s.type, s);
    }
  }
  return Array.from(byType.values());
}

// ── 主导出函数 ─────────────────────────────────────────────────────────────

/**
 * detectKnowledgeBoundarySignals — KB-1 核心 API
 *
 * 接收用户消息，检测是否命中知识边界信号。
 * 只做信号检测，不做动作决定。
 *
 * @param message 用户原始消息
 * @param context 可选上下文（第一版暂不使用，保持接口扩展性）
 * @returns 信号数组（可能为空）
 */
export function detectKnowledgeBoundarySignals(
  message: string,
  context?: KnowledgeBoundaryContext
): KnowledgeBoundarySignal[] {
  if (!message || message.trim().length === 0) return [];

  const trimmed = message.trim();

  const signals: KnowledgeBoundarySignal[] = [];
  for (const cluster of PATTERN_CLUSTERS) {
    const signal = matchCluster(trimmed, cluster);
    if (signal) {
      signals.push(signal);
    }
  }

  return dedupeSignals(signals);
}

/**
 * hasStrongBoundarySignal — 快速判断是否存在强信号
 *
 * 供 G1/G2 快速接入使用。
 * 强信号阈值：strength >= 0.80
 */
export function hasStrongBoundarySignal(
  signals: KnowledgeBoundarySignal[],
  threshold = 0.80
): boolean {
  return signals.some((s) => s.strength >= threshold);
}

/**
 * getStrongestSignal — 获取强度最高的信号
 *
 * 供 trace/debug 使用。
 */
export function getStrongestSignal(
  signals: KnowledgeBoundarySignal[]
): KnowledgeBoundarySignal | null {
  if (signals.length === 0) return null;
  return signals.reduce((best, s) => (s.strength > best.strength ? s : best), signals[0]);
}

/**
 * KB_SIGNAL_TYPES — 强知识边界信号类型集合
 *
 * 用于 G1/G2 校准时的类型白名单。
 * 只有这些类型的强信号才会触发校准。
 */
export const KB_CALIBRATABLE_TYPES: KnowledgeBoundarySignalType[] = [
  "realtime_external_fact",
  "current_environment_fact",
  "post_training_event",
  "live_weather_data",
  "live_market_data",
  "live_news_data",
  "live_result_or_score",
  "time_sensitive_public_fact",
];

/**
 * isCalibratableSignal — 判断信号是否可参与 G1/G2 校准
 *
 * @param signal 信号
 * @param threshold 强度阈值
 */
export function isCalibratableSignal(
  signal: KnowledgeBoundarySignal,
  threshold = 0.75
): boolean {
  return (
    KB_CALIBRATABLE_TYPES.includes(signal.type) && signal.strength >= threshold
  );
}
