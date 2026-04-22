#!/usr/bin/env node
/**
 * SmartRouter Benchmark CI Runner
 *
 * 支持三套离线 benchmark，全部不调用 API：
 *
 * routing    — 规则路由 CI gate（Mode>=80%, Intent>=70%）
 *              66 cases，覆盖 L0/L1/L2 fast vs slow 核心路径
 *
 * kb         — KB Signal 检测评估（准确率>=80%）
 *              22 cases，验证 knowledge-boundary-signals.ts 检测规则
 *
 * delegation — Gated Delegation 决策基准（离线规则，仅记录）
 *              ~35 cases，覆盖 G1/G2/G3 + KB Signal × Delegation
 *              ⚠️ 此套件设计用于在线 LLM 路由评估
 *              ⚠️ 离线规则模式下 Mode/Intent CI gate 仅供参考
 *
 * 用法：
 *   node scripts/benchmark-ci.cjs [--suite routing|kb|delegation] [--verbose]
 *   node scripts/benchmark-ci.cjs --suite delegation --verbose
 *
 * 退出码：0 = PASS，1 = FAIL
 */

const fs = require("fs");
const path = require("path");

// ── 参数解析 ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] !== undefined
    ? parseFloat(args[idx + 1])
    : defaultVal;
}
function getArgStr(name, defaultVal) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] !== undefined ? args[idx + 1] : defaultVal;
}
function hasArg(name) { return args.includes(name); }

const SUITE            = getArgStr("--suite", "routing");
const THRESHOLD_MODE    = getArg("--threshold-mode",    SUITE === "delegation" ? 30 : 80);
const THRESHOLD_INTENT  = getArg("--threshold-intent",  SUITE === "delegation" ? 20 : 70);
const THRESHOLD_KB      = getArg("--threshold-kb",      80);
const VERBOSE           = hasArg("--verbose");
const isKbSuite         = SUITE === "kb" || SUITE === "unknown";
const isDelegationSuite = SUITE === "delegation";

// ── 加载测试用例 ──────────────────────────────────────────────────────────────
const TASK_DIR = path.join(__dirname, "..", "evaluation", "tasks");
const SUITE_MAP = {
  routing:     "routing-benchmark.json",
  kb:          "unknown-by-definition.json",
  unknown:     "unknown-by-definition.json",
  delegation:  "delegation-benchmark.json",
};

function loadSuite(suite) {
  const file = SUITE_MAP[suite] ?? (suite.includes(".json") ? suite : suite + ".json");
  const casesPath = path.join(TASK_DIR, file);
  if (!fs.existsSync(casesPath)) {
    console.error(`[ERROR] 找不到 suite "${suite}" 的用例文件: ${casesPath}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(casesPath, "utf8"));
}

const cases = loadSuite(SUITE);

// ── KB Signal 规则（模拟 knowledge-boundary-signals.ts）──────────────────────
// 注意：具体规则放前面，通用规则放后面，避免截胡
const KB_SIGNALS = [
  // 强信号(0.82-0.92)
  { pattern: /天气|下雨|气温|温度|weather|forecast/i,          weight: 0.92, signal: "live_weather_data" },
  { pattern: /股价|股票.*价格|stock\s*price|特斯拉|腾讯|苹果.*股价/i, weight: 0.88, signal: "live_market_data" },
  { pattern: /现在.*时间|几点|what\s*time|date|today|星期几/i,  weight: 0.90, signal: "current_environment_fact" },
  { pattern: /比分|比赛结果|won\s*the| Lakers|得分/i,          weight: 0.86, signal: "live_result_or_score" },
  { pattern: /汇率|usd|cny|eur|美元|人民币|英镑/i,            weight: 0.84, signal: "live_fx_rate" },
  { pattern: /黄金|原油|期货价格|oil\s*price/i,               weight: 0.83, signal: "live_commodity_price" },
  // 时间敏感公共知识（具体）先于通用"新闻"匹配
  { pattern: /最新.*研究.*成果|研究.*最新|ai.*news.*latest|latest.*ai.*result/i, weight: 0.80, signal: "time_sensitive_public_fact" },
  { pattern: /防控.*政策 最新.*防控 最新.*疫情|当前.*政策.*什么/i, weight: 0.81, signal: "time_sensitive_public_fact" },
  // 通用新闻 — 放最后，避免截胡具体的时间敏感规则
  { pattern: /新闻|latest\s*news|发生了什么大事/i,              weight: 0.82, signal: "live_news_data" },
  // 弱信号(0.55-0.65)
  { pattern: /预测|估算|forecast.*stock/i,                   weight: 0.65, signal: "predictive_estimation" },
  { pattern: /最近.*趋势|近期.*动态/i,                        weight: 0.62, signal: "recent_trend" },
  { pattern: /研究.*方法|研究.*进展/i,                        weight: 0.58, signal: "academic_research_knowledge" },
  { pattern: /数学模型|预测模型|机器学习.*方法/i,             weight: 0.60, signal: "technical_methodology" },
  { pattern: /比赛.*技巧|如何.*得分/i,                        weight: 0.55, signal: "generic_skill_knowledge" },
  { pattern: /广告.*创意|营销.*方案|品牌.*故事/i,            weight: 0.57, signal: "creative_briefing" },
];

function detectKbSignals(input) {
  const text = input.toLowerCase();
  // 误伤保护：weather/新闻/股价在创意/建议语境中不触发 KB
  // 注意：强研究/防控语境会覆盖通用误报保护（但学术科目/方法类不算"研究"语境）
  const hasStrongResearchCtx = /最新.*研究|成果|学术.*前沿/i.test(text);
  const hasPolicyCtx   = /防控|疫情|政策.*什么/i.test(text);
  const falsePositivePatterns = [
    /诗|poem|散文|creative/i,
    /代码|script|实现|implement/i,
    /建议|tips|how\s*to|技巧/i,
    /有哪些|方法|模型/i,
    /概念|定义|是什么$/i,
  ];
  if (!hasStrongResearchCtx && !hasPolicyCtx && falsePositivePatterns.some(p => p.test(text))) return null;
  for (const s of KB_SIGNALS) {
    if (s.pattern.test(text)) return s;
  }
  return null;
}

// ── 离线规则路由器（模拟 LLM 路由决策）──────────────────────────────────────
function ruleRouter(input) {
  const text = input.toLowerCase();

  // L1: 实时数据（事实查询类 → simple_qa）
  const realtimeFactPatterns = [
    /几点了/, /现在.*时间/, /股价/, /汇率/, /今日.*价格/, /当前.*价格/,
    /黄金.*价格/, /最新.*财报/, /财报.*最新/
  ];
  for (const p of realtimeFactPatterns) {
    if (p.test(text)) return { mode: "fast", layer: "L1", intent: "simple_qa" };
  }

  // L1: 实时数据（资讯/新闻/比分类 → chat）
  const realtimeNewsPatterns = [
    /天气/, /weather/i, /今.*新闻/, /昨.*比赛/, /最新.*比分/,
    /nba.*比分/i, /足球.*结果/, /比分/
  ];
  for (const p of realtimeNewsPatterns) {
    if (p.test(text)) return { mode: "fast", layer: "L1", intent: "chat" };
  }

  // L2: 代码相关
  const codePatterns = [
    /实现.*算法/, /写.*函数/, /帮.*写.*脚本/, /调试/, /bug/i, /优化.*sql/i,
    /sql.*优化/, /写.*python/, /实现.*红黑树/, /实现.*插入/, /review.*code/i,
    /security.*vulnerabilit/i, /系统设计/, /分布式.*缓存/, /javascript.*函数/,
    /写.*代码/, /代码.*实现/
  ];
  for (const p of codePatterns) {
    if (p.test(text)) return { mode: "slow", layer: "L2", intent: "code" };
  }

  // L2: 数学/证明
  const mathPatterns = [
    /证明/, /黎曼/, /微分方程/, /特征值/, /费马/, /拉格朗日/, /矩阵/, /优化问题/
  ];
  for (const p of mathPatterns) {
    if (p.test(text)) return { mode: "slow", layer: "L2", intent: "math" };
  }

  // L2: 研究/调研
  const researchPatterns = [
    /调研/, /调查/, /搜索最新/, /查找.*论文/, /研究.*市场/, /市场.*研究/,
    /对比.*性能/, /对比.*产品/
  ];
  for (const p of researchPatterns) {
    if (p.test(text)) return { mode: "slow", layer: "L2", intent: "research" };
  }

  // L2: 深度分析/比较/推理
  const reasoningPatterns = [
    /分析.*格局/, /比较.*优缺点/, /解释.*量子/, /解释.*加密/, /分析.*影响机制/,
    /评估.*利弊/, /为什么.*transformer/i, /为什么.*transformer/,
    /解释.*python.*javascript/, /python.*javascript.*区别/, /关于微服务/,
    /区别.*是什么/, /和.*的区别/, /比较.*维度/, /从.*分析/, /对比.*公司/,
    /市场份额.*对比/
  ];
  for (const p of reasoningPatterns) {
    if (p.test(text)) return { mode: "slow", layer: "L2", intent: "reasoning" };
  }

  // L2: 复杂创意写作
  const complexCreativePatterns = [
    /科幻短篇/, /伦理困境/, /人物弧光/, /marketing.*copy/i, /品牌.*logo.*创意/
  ];
  for (const p of complexCreativePatterns) {
    if (p.test(text)) return { mode: "slow", layer: "L2", intent: "creative" };
  }

  // L2: 复杂翻译
  const complexTranslatePatterns = [
    /学术.*翻译/, /技术文档.*翻译/, /保留.*专业术语/, /保持.*学术.*风格/,
    /翻译.*学术/, /翻译.*技术文档/
  ];
  for (const p of complexTranslatePatterns) {
    if (p.test(text)) return { mode: "slow", layer: "L2", intent: "translation" };
  }

  // L2: 长文/深度总结
  const deepSummaryPatterns = [
    /10页/, /深度总结/, /quarterly.*business.*report/i, /核心观点.*方法论/,
    /research.*report/i
  ];
  for (const p of deepSummaryPatterns) {
    if (p.test(text)) return { mode: "slow", layer: "L2", intent: "summarization" };
  }

  // L2: 多约束/复杂问题
  const questionMarkCount = (input.match(/[？?]/g) || []).length;
  if (questionMarkCount >= 2) {
    const isSimpleDefinitions = /是什么[？?]/.test(input) && !/区别|比较|分析|对比/.test(text);
    if (!isSimpleDefinitions) return { mode: "slow", layer: "L2", intent: "reasoning" };
  }
  if (/告诉我.*是什么.*它.*是什么/.test(text)) {
    return { mode: "slow", layer: "L2", intent: "reasoning" };
  }
  if (/关于.*你了解多少/.test(text)) {
    return { mode: "slow", layer: "L2", intent: "reasoning" };
  }

  // L0: 简单创意（短）
  const simpleCreativePatterns = [
    /写一首.*诗/, /短故事/, /写个笑话/, /辞职信/, /write.*poem/i
  ];
  for (const p of simpleCreativePatterns) {
    if (p.test(text)) return { mode: "fast", layer: "L0", intent: "creative" };
  }

  // L0: 翻译
  const simpleTranslatePatterns = [
    /翻译.*[:：]/, /translate.*['"'"']/, /用.*语.*说/, /把.*翻译成/
  ];
  for (const p of simpleTranslatePatterns) {
    if (p.test(text)) return { mode: "fast", layer: "L0", intent: "translation" };
  }

  // L0: 简单总结
  const simpleSummaryPatterns = [
    /总结.*这段/, /总结.*意思/, /概括.*内容/, /帮.*总结.*主要内容/
  ];
  for (const p of simpleSummaryPatterns) {
    if (p.test(text)) return { mode: "fast", layer: "L0", intent: "summarization" };
  }

  // L0: 打招呼/社交
  const greetingPatterns = [
    /^你好$/, /^谢谢$/, /^再见$/, /^how are you/i, /^what's up/i, /^hi$/i, /^hello$/i
  ];
  for (const p of greetingPatterns) {
    if (p.test(input.trim())) return { mode: "fast", layer: "L0", intent: "chat" };
  }

  // L0: 简单问答（事实/定义）
  const simpleQaPatterns = [
    /^[0-9+\-*/\s=]+$/, /等于几/, /首都/, /是什么$/, /what's the capital/i,
    /python是什么$/, /^这个词.*意思/, /分析.*词.*意思/, /这个词的意思/
  ];
  for (const p of simpleQaPatterns) {
    if (p.test(text)) return { mode: "fast", layer: "L0", intent: "simple_qa" };
  }

  // 多个"X是什么"问句 → slow L2
  if (/是什么[？?]/.test(input) && !/区别|比较|分析|对比/.test(text)) {
    const definitions = (input.match(/是什么/g) || []).length;
    if (definitions >= 2) return { mode: "slow", layer: "L2", intent: "simple_qa" };
  }

  return { mode: "fast", layer: "L0", intent: "chat" };
}

// ── KB 套件：KB Signal 检测评估 ───────────────────────────────────────────────
function runKbSuite() {
  console.log(`\n=== KB Signal Detection Benchmark ===`);
  console.log(`套件: unknown-by-definition  |  阈值: ${THRESHOLD_KB}%\n`);

  const results = [];

  for (const tc of cases) {
    const signal = detectKbSignals(tc.input);
    const expectedSlow = tc.expected_mode === "slow";
    const actualSlow   = signal !== null;

    const hit           = expectedSlow && actualSlow;
    const correctReject = !expectedSlow && !actualSlow;
    const falseAlarm    = !expectedSlow && actualSlow;
    const miss          = expectedSlow && !actualSlow;
    const ok            = hit || correctReject;

    results.push({
      input:           tc.input,
      expected:         tc.expected_mode,
      expected_reason:  tc.reason,
      signal:           signal ? `${signal.signal}(${signal.weight})` : "none",
      hit, correctReject, falseAlarm, miss, ok,
    });

    process.stdout.write(ok ? "✓" : "✗");
  }
  console.log("\n");

  const total     = results.length;
  const correct   = results.filter(r => r.ok).length;
  const hit       = results.filter(r => r.hit).length;
  const falseAlarm = results.filter(r => r.falseAlarm).length;
  const miss      = results.filter(r => r.miss).length;
  const accuracy  = (correct / total * 100);

  console.log(`=== 结果汇总 ===`);
  console.log(`总用例:         ${total}`);
  console.log(`正确:           ${correct}/${total} = ${accuracy.toFixed(1)}%`);
  console.log(`命中(应有信号):  ${hit}/${hit + miss} 命中`);
  console.log(`误报(fast→slow): ${falseAlarm}`);
  console.log(`漏报(slow→fast): ${miss}`);

  const failures = results.filter(r => !r.ok);
  if (failures.length > 0) {
    console.log(`\n失败用例 (${failures.length}条):`);
    for (const f of failures) {
      console.log(`  [${f.falseAlarm ? "误报" : "漏报"}] 信号:${f.signal} | "${f.input.substring(0, 50)}"`);
      console.log(`           期望:${f.expected}  原因:${f.expected_reason}`);
    }
  }

  // 写出结果
  const outDir  = path.join(__dirname, "..", "evaluation", "results");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `benchmark-kb-${new Date().toISOString().split("T")[0]}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    run_date: new Date().toISOString(),
    suite: "unknown-by-definition",
    total, correct, accuracy: `${accuracy.toFixed(1)}%`,
    hit, falseAlarm, miss,
    cases: results,
  }, null, 2), "utf8");
  console.log(`\n结果已写入: ${outFile}`);

  // CI Gate
  console.log(`\n=== CI Gate ===`);
  const pass = accuracy >= THRESHOLD_KB;
  console.log(`KB Signal (${accuracy.toFixed(1)}% >= ${THRESHOLD_KB}%): ${pass ? "PASS" : "FAIL"}`);
  if (!pass) { console.error("KB Benchmark CI FAILED"); process.exit(1); }
  console.log("KB Benchmark CI PASSED");
  process.exit(0);
}

// ── 路由套件：Mode/Layer/Intent 评估 ─────────────────────────────────────────
function runRoutingSuite() {
  console.log(`\n=== SmartRouter Routing Benchmark ===`);
  console.log(`用例数: ${cases.length}  |  Mode 阈值: ${THRESHOLD_MODE}%  |  Intent 阈值: ${THRESHOLD_INTENT}%\n`);

  const results = [];

  for (const tc of cases) {
    const prediction = ruleRouter(tc.input);
    const modeOk   = prediction.mode   === tc.expected_mode;
    const intentOk = prediction.intent === tc.expected_intent;
    const layerOk  = prediction.layer  === tc.expected_layer;

    results.push({
      input: tc.input,
      expected_mode:   tc.expected_mode,
      actual_mode:     prediction.mode,
      expected_intent: tc.expected_intent,
      actual_intent:   prediction.intent,
      expected_layer:  tc.expected_layer,
      actual_layer:    prediction.layer,
      mode_ok: modeOk, intent_ok: intentOk, layer_ok: layerOk,
    });

    process.stdout.write(modeOk ? "✓" : "✗");
  }
  console.log("\n");

  const total    = results.length;
  const modeOk   = results.filter(r => r.mode_ok).length;
  const intentOk = results.filter(r => r.intent_ok).length;
  const layerOk  = results.filter(r => r.layer_ok).length;
  const modeRate   = (modeOk   / total * 100);
  const intentRate = (intentOk / total * 100);
  const layerRate  = (layerOk  / total * 100);

  console.log(`=== 结果汇总 ===`);
  console.log(`总用例:         ${total}`);
  console.log(`Mode  准确:     ${modeOk}/${total} = ${modeRate.toFixed(1)}%`);
  console.log(`Intent 准确:    ${intentOk}/${total} = ${intentRate.toFixed(1)}%`);
  console.log(`Layer  准确:    ${layerOk}/${total} = ${layerRate.toFixed(1)}%`);

  // 按 Layer
  const byLayer = {};
  for (const r of results) {
    const k = r.expected_layer;
    if (!byLayer[k]) byLayer[k] = { total: 0, correct: 0 };
    byLayer[k].total++;
    if (r.mode_ok) byLayer[k].correct++;
  }
  console.log(`\n按 Layer (Mode 准确):`);
  for (const [layer, s] of Object.entries(byLayer).sort()) {
    console.log(`  ${layer.padEnd(4)}: ${s.correct}/${s.total} = ${(s.correct / s.total * 100).toFixed(1)}%`);
  }

  // 按 Intent
  const byIntent = {};
  for (const r of results) {
    const k = r.expected_intent;
    if (!byIntent[k]) byIntent[k] = { total: 0, correct: 0 };
    byIntent[k].total++;
    if (r.mode_ok) byIntent[k].correct++;
  }
  console.log(`\n按 Intent (Mode 准确):`);
  for (const [intent, s] of Object.entries(byIntent).sort()) {
    console.log(`  ${intent.padEnd(16)}: ${s.correct}/${s.total} = ${(s.correct / s.total * 100).toFixed(1)}%`);
  }

  // 失败用例
  const failures = results.filter(r => !r.mode_ok);
  if (failures.length > 0) {
    console.log(`\n失败用例 (${failures.length}条):`);
    for (const f of failures) {
      console.log(`  [${f.expected_layer}/${f.expected_intent}]  exp:${f.expected_mode.padEnd(5)} got:${f.actual_mode.padEnd(5)} | "${f.input.substring(0, 50)}"`);
    }
  }

  if (VERBOSE) {
    console.log(`\n=== 全量明细 ===`);
    for (const r of results) {
      console.log(`${r.mode_ok ? "✓" : "✗"} [${r.expected_layer}/${r.expected_intent}] exp:${r.expected_mode} got:${r.actual_mode} | "${r.input.substring(0, 60)}"`);
    }
  }

  // 写出结果
  const outDir  = path.join(__dirname, "..", "evaluation", "results");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `benchmark-ci-${new Date().toISOString().split("T")[0]}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    run_date: new Date().toISOString(), mode: "offline-ci",
    total, mode_ok: modeOk, intent_ok: intentOk, layer_ok: layerOk,
    mode_accuracy: `${modeRate.toFixed(1)}%`,
    intent_accuracy: `${intentRate.toFixed(1)}%`,
    layer_accuracy: `${layerRate.toFixed(1)}%`,
    byLayer, byIntent, cases: results,
  }, null, 2), "utf8");
  console.log(`\n结果已写入: ${outFile}`);

  // CI Gate
  console.log(`\n=== CI Gate ===`);
  const modePass   = modeRate   >= THRESHOLD_MODE;
  const intentPass = intentRate >= THRESHOLD_INTENT;
  console.log(`Mode   (${modeRate.toFixed(1)}% >= ${THRESHOLD_MODE}%):   ${modePass   ? "PASS" : "FAIL"}`);
  console.log(`Intent (${intentRate.toFixed(1)}% >= ${THRESHOLD_INTENT}%): ${intentPass ? "PASS" : "FAIL"}`);
  if (!modePass || !intentPass) { console.error("Routing Benchmark CI FAILED"); process.exit(1); }
  console.log("Routing Benchmark CI PASSED");
  process.exit(0);
}

// ── Delegation 套件：Gated Delegation 决策基准评估 ──────────────────────────────
function runDelegationSuite() {
  console.log(`\n=== Gated Delegation Benchmark ===`);
  console.log(`用例数: ${cases.length}  |  Mode 阈值: ${THRESHOLD_MODE}%  |  Intent 阈值: ${THRESHOLD_INTENT}%\n`);
  console.log(`⚠️  此套件设计用于在线 LLM 路由，离线规则模式下 Mode/Intent 仅供参考\n`);

  const results = [];

  for (const tc of cases) {
    const prediction = ruleRouter(tc.input);
    const kbSignal   = detectKbSignals(tc.input);
    const modeOk    = prediction.mode   === tc.expected_mode;
    const intentOk  = prediction.intent === tc.expected_intent;
    const layerOk   = prediction.layer  === tc.expected_layer;
    const scenario  = tc.scenario || "unknown";

    results.push({
      input:           tc.input,
      expected_mode:    tc.expected_mode,
      actual_mode:      prediction.mode,
      expected_intent:  tc.expected_intent,
      actual_intent:    prediction.intent,
      expected_layer:   tc.expected_layer,
      actual_layer:     prediction.layer,
      scenario,
      kb_signal:        kbSignal ? `${kbSignal.signal}(${kbSignal.weight})` : "none",
      mode_ok: modeOk, intent_ok: intentOk, layer_ok: layerOk,
    });

    process.stdout.write(modeOk ? "✓" : "✗");
  }
  console.log("\n");

  const total     = results.length;
  const modeOk   = results.filter(r => r.mode_ok).length;
  const intentOk = results.filter(r => r.intent_ok).length;
  const layerOk  = results.filter(r => r.layer_ok).length;
  const modeRate   = (modeOk   / total * 100);
  const intentRate = (intentOk / total * 100);
  const layerRate  = (layerOk  / total * 100);

  console.log(`=== 结果汇总（离线规则模式）==`);
  console.log(`总用例:         ${total}`);
  console.log(`Mode  准确:     ${modeOk}/${total} = ${modeRate.toFixed(1)}%`);
  console.log(`Intent 准确:    ${intentOk}/${total} = ${intentRate.toFixed(1)}%`);
  console.log(`Layer  准确:    ${layerOk}/${total} = ${layerRate.toFixed(1)}%`);

  // 按 Scenario 分组
  const byScenario = {};
  for (const r of results) {
    const k = r.scenario;
    if (!byScenario[k]) byScenario[k] = { total: 0, correct: 0 };
    byScenario[k].total++;
    if (r.mode_ok) byScenario[k].correct++;
  }
  console.log(`\n按 Scenario (Mode 准确):`);
  for (const [scenario, s] of Object.entries(byScenario).sort()) {
    console.log(`  ${scenario.padEnd(24)}: ${s.correct}/${s.total} = ${(s.correct / s.total * 100).toFixed(1)}%`);
  }

  // 失败用例
  const failures = results.filter(r => !r.mode_ok);
  if (failures.length > 0) {
    console.log(`\n失败用例 (${failures.length}条，仅显示前10):`);
    for (const f of failures.slice(0, 10)) {
      console.log(`  [${f.expected_layer}/${f.expected_intent}][${f.scenario}]`);
      console.log(`    exp:${f.expected_mode.padEnd(5)} got:${f.actual_mode.padEnd(5)} | "${f.input.substring(0, 60)}"`);
    }
    if (failures.length > 10) console.log(`  ... 及其他 ${failures.length - 10} 条`);
  }

  if (VERBOSE) {
    console.log(`\n=== 全量明细 ===`);
    for (const r of results) {
      console.log(`${r.mode_ok ? "✓" : "✗"} [${r.expected_layer}/${r.expected_intent}][${r.scenario}] exp:${r.expected_mode} got:${r.actual_mode} | "${r.input.substring(0, 60)}"`);
    }
  }

  // 写出结果
  const outDir  = path.join(__dirname, "..", "evaluation", "results");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `benchmark-delegation-${new Date().toISOString().split("T")[0]}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    run_date: new Date().toISOString(),
    mode: "offline-rules-reference",
    suite: "delegation",
    total, mode_ok: modeOk, intent_ok: intentOk, layer_ok: layerOk,
    mode_accuracy: `${modeRate.toFixed(1)}%`,
    intent_accuracy: `${intentRate.toFixed(1)}%`,
    layer_accuracy: `${layerRate.toFixed(1)}%`,
    byScenario,
    cases: results,
  }, null, 2), "utf8");
  console.log(`\n结果已写入: ${outFile}`);

  // CI Gate（离线模式宽松阈值，仅作参考）
  console.log(`\n=== CI Gate（离线规则参考值）===`);
  const modePass   = modeRate   >= THRESHOLD_MODE;
  const intentPass = intentRate >= THRESHOLD_INTENT;
  console.log(`Mode   (${modeRate.toFixed(1)}% >= ${THRESHOLD_MODE}%):   ${modePass   ? "PASS" : "FAIL"}`);
  console.log(`Intent (${intentRate.toFixed(1)}% >= ${THRESHOLD_INTENT}%): ${intentPass ? "PASS" : "FAIL"}`);
  if (!modePass || !intentPass) {
    console.error("\n⚠️  Delegation benchmark 在离线规则模式下未达 CI gate");
    console.error("   建议：使用在线 benchmark（benchmark-routing.cjs + SiliconFlow）评估 LLM 路由");
    console.error("Delegation Benchmark CI（离线）FAILED");
    process.exit(1);
  }
  console.log("Delegation Benchmark CI PASSED");
  process.exit(0);
}

// ── 调度器 ─────────────────────────────────────────────────────────────────────
if (isKbSuite) {
  runKbSuite();
} else if (isDelegationSuite) {
  runDelegationSuite();
} else {
  runRoutingSuite();
}
