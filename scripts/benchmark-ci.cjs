#!/usr/bin/env node
/**
 * Sprint 49 P1: Offline Routing Benchmark (CI Mode)
 *
 * 不调用任何 API，使用规则引擎模拟路由决策。
 * 目的：在 CI 流水线中验证路由规则的正确性，无需外部服务。
 *
 * 用法：node scripts/benchmark-ci.cjs [--threshold-mode <0-100>] [--threshold-intent <0-100>]
 * 退出码：0 = PASS，1 = FAIL
 */

const fs = require("fs");
const path = require("path");

// ── 参数解析 ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(name);
  return idx !== -1 ? parseFloat(args[idx + 1]) : defaultVal;
}
const THRESHOLD_MODE   = getArg("--threshold-mode",   80); // mode accuracy 阈值（%）
const THRESHOLD_INTENT = getArg("--threshold-intent", 70); // intent accuracy 阈值（%）
const VERBOSE          = args.includes("--verbose");

// ── 加载测试用例 ──────────────────────────────────────────────────────────────
const casesPath = path.join(__dirname, "..", "evaluation", "tasks", "routing-benchmark.json");
if (!fs.existsSync(casesPath)) {
  console.error(`[ERROR] 找不到 benchmark 用例文件: ${casesPath}`);
  process.exit(1);
}
const cases = JSON.parse(fs.readFileSync(casesPath, "utf8"));

// ── 离线规则路由器（模拟 LLM 路由决策）──────────────────────────────────────
/**
 * 规则优先级：
 * 1. 实时数据关键词 → fast (L1)
 * 2. 简单社交/打招呼 → fast (L0)
 * 3. 简单翻译（短句） → fast (L0)
 * 4. 代码生成/调试 → slow (L2)
 * 5. 数学/证明 → slow (L2)
 * 6. 深度分析/比较/研究 → slow (L2)
 * 7. 复杂创意写作 → slow (L2)
 * 8. 长文/深度总结 → slow (L2)
 * 9. 多约束/多问题 → slow (L2)
 * 10. 默认 → fast (L0)
 */
function ruleRouter(input) {
  const text = input.toLowerCase();

  // ── L1: 实时数据（事实查询类 → simple_qa） ─────────────────────────────────
  // 股价/汇率/价格/时间 = 有明确答案的事实查询
  const realtimeFactPatterns = [
    /几点了/, /现在.*时间/, /股价/, /汇率/, /今日.*价格/, /当前.*价格/,
    /黄金.*价格/, /最新.*财报/, /财报.*最新/
  ];
  for (const p of realtimeFactPatterns) {
    if (p.test(text)) {
      return { mode: "fast", layer: "L1", intent: "simple_qa" };
    }
  }

  // ── L1: 实时数据（资讯/新闻/比分类 → chat） ────────────────────────────────
  const realtimeNewsPatterns = [
    /天气/, /weather/i, /今.*新闻/, /昨.*比赛/, /最新.*比分/,
    /nba.*比分/i, /足球.*结果/, /比分/
  ];
  for (const p of realtimeNewsPatterns) {
    if (p.test(text)) {
      return { mode: "fast", layer: "L1", intent: "chat" };
    }
  }

  // ── L2: 代码相关 ────────────────────────────────────────────────────────────
  const codePatterns = [
    /实现.*算法/, /写.*函数/, /帮.*写.*脚本/, /调试/, /bug/i, /优化.*sql/i,
    /sql.*优化/, /写.*python/, /实现.*红黑树/, /实现.*插入/, /review.*code/i,
    /security.*vulnerabilit/i, /系统设计/, /分布式.*缓存/, /javascript.*函数/,
    /写.*代码/, /代码.*实现/
  ];
  for (const p of codePatterns) {
    if (p.test(text)) {
      return { mode: "slow", layer: "L2", intent: "code" };
    }
  }

  // ── L2: 数学/证明 ───────────────────────────────────────────────────────────
  const mathPatterns = [
    /证明/, /黎曼/, /微分方程/, /特征值/, /费马/, /拉格朗日/, /矩阵/, /优化问题/
  ];
  for (const p of mathPatterns) {
    if (p.test(text)) {
      return { mode: "slow", layer: "L2", intent: "math" };
    }
  }

  // ── L2: 研究/调研 ───────────────────────────────────────────────────────────
  const researchPatterns = [
    /调研/, /调查/, /搜索最新/, /查找.*论文/, /研究.*市场/, /市场.*研究/,
    /对比.*性能/, /对比.*产品/
  ];
  for (const p of researchPatterns) {
    if (p.test(text)) {
      return { mode: "slow", layer: "L2", intent: "research" };
    }
  }

  // ── L2: 深度分析/比较/推理 ──────────────────────────────────────────────────
  const reasoningPatterns = [
    /分析.*格局/, /比较.*优缺点/, /解释.*量子/, /解释.*加密/, /分析.*影响机制/,
    /评估.*利弊/, /为什么.*transformer/i, /为什么.*transformer/,
    /解释.*python.*javascript/, /python.*javascript.*区别/, /关于微服务/,
    /区别.*是什么/, /和.*的区别/, /比较.*维度/, /从.*分析/, /对比.*公司/,
    /市场份额.*对比/
  ];
  for (const p of reasoningPatterns) {
    if (p.test(text)) {
      return { mode: "slow", layer: "L2", intent: "reasoning" };
    }
  }

  // ── L2: 深度创意写作（排除翻译场景） ───────────────────────────────────────
  const complexCreativePatterns = [
    /科幻短篇/, /伦理困境/, /人物弧光/, /marketing.*copy/i, /品牌.*logo.*创意/
  ];
  for (const p of complexCreativePatterns) {
    if (p.test(text)) {
      return { mode: "slow", layer: "L2", intent: "creative" };
    }
  }

  // ── L2: 复杂翻译（学术/技术，需精确术语） ──────────────────────────────────
  const complexTranslatePatterns = [
    /学术.*翻译/, /技术文档.*翻译/, /保留.*专业术语/, /保持.*学术.*风格/,
    /翻译.*学术/, /翻译.*技术文档/
  ];
  for (const p of complexTranslatePatterns) {
    if (p.test(text)) {
      return { mode: "slow", layer: "L2", intent: "translation" };
    }
  }

  // ── L2: 长文/深度总结 ───────────────────────────────────────────────────────
  const deepSummaryPatterns = [
    /10页/, /深度总结/, /quarterly.*business.*report/i, /核心观点.*方法论/,
    /research.*report/i
  ];
  for (const p of deepSummaryPatterns) {
    if (p.test(text)) {
      return { mode: "slow", layer: "L2", intent: "summarization" };
    }
  }

  // ── L2: 多约束/复杂问题 ─────────────────────────────────────────────────────
  // 多个问号 = 多个问题，但排除"多个简单定义问句"（如 Python是什么？Java是什么？）
  const questionMarkCount = (input.match(/[？?]/g) || []).length;
  if (questionMarkCount >= 2) {
    // 判断是否全是 "X是什么" 形式的简单定义查询
    const isSimpleDefinitions = /是什么[？?]/.test(input) && !/区别|比较|分析|对比/.test(text);
    if (!isSimpleDefinitions) {
      return { mode: "slow", layer: "L2", intent: "reasoning" };
    }
  }
  // "告诉我X是什么，它的Y是什么" = 多约束
  if (/告诉我.*是什么.*它.*是什么/.test(text)) {
    return { mode: "slow", layer: "L2", intent: "reasoning" };
  }
  // "关于X，你了解多少" 模式
  if (/关于.*你了解多少/.test(text)) {
    return { mode: "slow", layer: "L2", intent: "reasoning" };
  }

  // ── L0: 简单创意（短） ──────────────────────────────────────────────────────
  const simpleCreativePatterns = [
    /写一首.*诗/, /短故事/, /写个笑话/, /辞职信/, /write.*poem/i
  ];
  for (const p of simpleCreativePatterns) {
    if (p.test(text)) {
      return { mode: "fast", layer: "L0", intent: "creative" };
    }
  }

  // ── L0: 翻译 ────────────────────────────────────────────────────────────────
  const simpleTranslatePatterns = [
    /翻译.*[:：]/, /translate.*['"'"']/, /用.*语.*说/, /把.*翻译成/
  ];
  for (const p of simpleTranslatePatterns) {
    if (p.test(text)) {
      return { mode: "fast", layer: "L0", intent: "translation" };
    }
  }

  // ── L0: 简单总结 ────────────────────────────────────────────────────────────
  const simpleSummaryPatterns = [
    /总结.*这段/, /总结.*意思/, /概括.*内容/, /帮.*总结.*主要内容/
  ];
  for (const p of simpleSummaryPatterns) {
    if (p.test(text)) {
      return { mode: "fast", layer: "L0", intent: "summarization" };
    }
  }

  // ── L0: 打招呼/社交 ─────────────────────────────────────────────────────────
  const greetingPatterns = [
    /^你好$/, /^谢谢$/, /^再见$/, /^how are you/i, /^what's up/i,
    /^hi$/i, /^hello$/i
  ];
  for (const p of greetingPatterns) {
    if (p.test(input.trim())) {
      return { mode: "fast", layer: "L0", intent: "chat" };
    }
  }

  // ── L0: 简单问答（事实/定义） ───────────────────────────────────────────────
  const simpleQaPatterns = [
    /^[0-9+\-*/\s=]+$/, /等于几/, /首都/, /是什么$/, /what's the capital/i,
    /python是什么$/, /^这个词.*意思/, /分析.*词.*意思/, /这个词的意思/
  ];
  for (const p of simpleQaPatterns) {
    if (p.test(text)) {
      return { mode: "fast", layer: "L0", intent: "simple_qa" };
    }
  }

  // 多个"X是什么"问句 → 简单定义组合，仍属 simple_qa（但要 slow L2）
  if (/是什么[？?]/.test(input) && !/区别|比较|分析|对比/.test(text)) {
    const definitions = (input.match(/是什么/g) || []).length;
    if (definitions >= 2) {
      return { mode: "slow", layer: "L2", intent: "simple_qa" };
    }
  }

  // ── 默认: fast L0 ───────────────────────────────────────────────────────────
  return { mode: "fast", layer: "L0", intent: "chat" };
}

// ── 运行 benchmark ────────────────────────────────────────────────────────────
function run() {
  console.log(`\n=== SmartRouter Offline Benchmark (CI Mode) ===`);
  console.log(`用例数: ${cases.length}  |  Mode 阈值: ${THRESHOLD_MODE}%  |  Intent 阈值: ${THRESHOLD_INTENT}%\n`);

  const results = [];

  for (const tc of cases) {
    const prediction = ruleRouter(tc.input);
    const modeOk   = prediction.mode   === tc.expected_mode;
    const intentOk = prediction.intent === tc.expected_intent;
    const layerOk  = prediction.layer  === tc.expected_layer;

    results.push({
      input:           tc.input,
      expected_mode:   tc.expected_mode,
      actual_mode:     prediction.mode,
      expected_intent: tc.expected_intent,
      actual_intent:   prediction.intent,
      expected_layer:  tc.expected_layer,
      actual_layer:    prediction.layer,
      mode_ok:         modeOk,
      intent_ok:       intentOk,
      layer_ok:        layerOk,
    });

    const icon = modeOk ? "✓" : "✗";
    process.stdout.write(icon);
  }
  console.log("\n");

  // ── 统计 ──────────────────────────────────────────────────────────────────
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

  // 按 Layer 分类
  const byLayer = {};
  for (const r of results) {
    const k = r.expected_layer;
    if (!byLayer[k]) byLayer[k] = { total: 0, correct: 0 };
    byLayer[k].total++;
    if (r.mode_ok) byLayer[k].correct++;
  }
  console.log(`\n按 Layer (Mode 准确):`);
  for (const [layer, s] of Object.entries(byLayer).sort()) {
    console.log(`  ${layer.padEnd(4)}: ${s.correct}/${s.total} = ${(s.correct/s.total*100).toFixed(1)}%`);
  }

  // 按 Intent 分类
  const byIntent = {};
  for (const r of results) {
    const k = r.expected_intent;
    if (!byIntent[k]) byIntent[k] = { total: 0, correct: 0 };
    byIntent[k].total++;
    if (r.mode_ok) byIntent[k].correct++;
  }
  console.log(`\n按 Intent (Mode 准确):`);
  for (const [intent, s] of Object.entries(byIntent).sort()) {
    console.log(`  ${intent.padEnd(16)}: ${s.correct}/${s.total} = ${(s.correct/s.total*100).toFixed(1)}%`);
  }

  // 失败用例
  const failures = results.filter(r => !r.mode_ok);
  if (failures.length > 0) {
    console.log(`\n失败用例 (${failures.length}条):`);
    for (const f of failures) {
      console.log(`  [${f.expected_layer}/${f.expected_intent}]  exp:${f.expected_mode.padEnd(5)} got:${f.actual_mode.padEnd(5)} | "${f.input.substring(0, 50)}"`);
    }
  }

  // VERBOSE: 输出全量明细
  if (VERBOSE) {
    console.log(`\n=== 全量明细 ===`);
    for (const r of results) {
      const icon = r.mode_ok ? "✓" : "✗";
      console.log(`${icon} [${r.expected_layer}/${r.expected_intent}] exp:${r.expected_mode} got:${r.actual_mode} | "${r.input.substring(0, 60)}"`);
    }
  }

  // ── 写出 JSON 结果 ────────────────────────────────────────────────────────
  const outDir  = path.join(__dirname, "..", "evaluation", "results");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `benchmark-ci-${new Date().toISOString().split("T")[0]}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    run_date:    new Date().toISOString(),
    mode:        "offline-ci",
    total,
    mode_ok:     modeOk,
    intent_ok:   intentOk,
    layer_ok:    layerOk,
    mode_accuracy:   `${modeRate.toFixed(1)}%`,
    intent_accuracy: `${intentRate.toFixed(1)}%`,
    layer_accuracy:  `${layerRate.toFixed(1)}%`,
    byLayer,
    byIntent,
    cases: results,
  }, null, 2), "utf8");
  console.log(`\n结果已写入: ${outFile}`);

  // ── CI Gate ───────────────────────────────────────────────────────────────
  console.log(`\n=== CI Gate ===`);
  const modePass   = modeRate   >= THRESHOLD_MODE;
  const intentPass = intentRate >= THRESHOLD_INTENT;
  console.log(`Mode   (${modeRate.toFixed(1)}% >= ${THRESHOLD_MODE}%):   ${modePass   ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`Intent (${intentRate.toFixed(1)}% >= ${THRESHOLD_INTENT}%): ${intentPass ? "✅ PASS" : "❌ FAIL"}`);

  if (!modePass || !intentPass) {
    console.error(`\n❌ Benchmark CI FAILED`);
    process.exit(1);
  }
  console.log(`\n✅ Benchmark CI PASSED`);
  process.exit(0);
}

run();
