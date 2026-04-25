/**
 * Sprint 58: L2 在线 Benchmark — LLM 路由 vs 离线规则
 *
 * 加载 30 条 L2 测试用例，直接调用 Fast 模型（Manager）做路由判决，
 * 与离线规则基线对比，建立 LLM 路由在 L2 场景的真实基线。
 *
 * SiliconFlow: node benchmark-routing.cjs --mode layer2 --provider siliconflow
 * Ollama:      node benchmark-routing.cjs --mode layer2 --provider ollama
 * 离线规则:   node benchmark-routing.cjs --mode layer2 --provider offline
 *
 * 注：离线规则基线使用 benchmark-ci.cjs 的 L2 套件规则集（与 Sprint 56 一致）。
 */

// ── .env 加载（必须最早执行，在 API 调用前注入 key）──────────────────────────────
const _fs = require("fs");
const _path = require("path");
try {
  const envContent = _fs.readFileSync(_path.join(__dirname, ".env"), "utf8");
  envContent.split("\n").forEach((line) => {
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) return;
    const key = line.slice(0, eqIdx).trim();
    const val = line.slice(eqIdx + 1).trim();
    if (key && !key.startsWith("#") && !process.env[key]) {
      process.env[key] = val;
    }
  });
} catch (_) { /* .env 不存在则跳过 */ }

const fs = _fs;
const path = _path;

// ── 参数解析 ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const modeArg = args.includes("--mode") ? args[args.indexOf("--mode") + 1] : "layer2";
const provider = args.includes("--provider") ? args[args.indexOf("--provider") + 1] : "siliconflow";

// ── 测试用例加载 ─────────────────────────────────────────────────────────────
const CASES = JSON.parse(
  fs.readFileSync(path.join(__dirname, "evaluation", "tasks", "benchmark-layer2.json"), "utf8")
);

// ── Manager System Prompt（诊断后验证：Qwen2.5-7B 可稳定输出）
// 与 llm-native-router.ts 保持对齐，但 benchmark 使用更简洁的输出 schema
// （避免可选字段导致模型输出混乱）
const MANAGER_PROMPT = `You are SmartRouter Pro's Manager.

Given the user message, score each action and output your decision in JSON.

【Four Actions】
- direct_answer: reply directly (low cost, for chat/simple Q&A)
- ask_clarification: request more info from user
- delegate_to_slow: route to slow model (deep analysis/multi-step reasoning)
- execute_task: execute task (needs tool calls/code/multi-step)

【Scoring Principles】
- Score each action 0.0-1.0 (relative merit, not just possibility)
- delegate_to_slow/execute_task are high-cost → need higher scores to pass
- ask_clarification is not free → it interrupts the user
- Consider: missing_info, needs_long_reasoning, needs_external_tool,
  high_risk_action, query_too_vague, requires_multi_step

【Output JSON Schema】 (respond with ONLY valid JSON, no extra text)

\`\`\`json
{
  "schema_version": "manager_decision_v2",
  "scores": {
    "direct_answer": 0.0-1.0,
    "ask_clarification": 0.0-1.0,
    "delegate_to_slow": 0.0-1.0,
    "execute_task": 0.0-1.0
  },
  "confidence_hint": 0.0-1.0,
  "features": {
    "missing_info": boolean,
    "needs_long_reasoning": boolean,
    "needs_external_tool": boolean,
    "high_risk_action": boolean,
    "query_too_vague": boolean,
    "requires_multi_step": boolean
  },
  "rationale": "one sentence reason",
  "decision": "direct_answer|ask_clarification|delegate_to_slow|execute_task",
  "direct_response": { "content": "only if decision=direct_answer" },
  "clarification": { "question_text": "only if decision=ask_clarification" },
  "command": { "task_brief": "only if decision=delegate_to_slow or execute_task" }
}
\`\`\`

【Rules】
- Output ONLY the JSON object, no additional text
- JSON must include all fields`;

// ── 决策类型 → fast/slow 标准化 ────────────────────────────────────────────
function normalizeMode(decisionType) {
  if (!decisionType) return "unknown";
  if (["delegate_to_slow", "execute_task"].includes(decisionType)) return "slow";
  if (["direct_answer", "ask_clarification"].includes(decisionType)) return "fast";
  return decisionType;
}

// ── 解析 v2 JSON 响应（支持新 decision 字段和旧 decision_type 字段）──────────
function parseV2Response(text) {
  try {
    const match =
      text.match(/```json\s*([\s\S]*?)\s*```/)?.[1] ??
      text.match(/```\s*([\s\S]*?)\s*```/)?.[1] ??
      text.match(/(\{[\s\S]*\})/)?.[1];
    if (!match) return null;
    const parsed = JSON.parse(match.trim());
    // 新 schema: decision 字段；旧 schema: decision_type 字段
    return parsed.decision || parsed.decision_type || null;
  } catch {
    return null;
  }
}

// ── SiliconFlow 路径（直调 SiliconFlow API）────────────────────────────────
async function runSiliconFlow(tc) {
  const { input, expected_mode, expected_intent, scenario } = tc;
  const start = Date.now();

  try {
    const apiKey = process.env.SILICONFLOW_API_KEY || process.env.OPENAI_API_KEY;
    const baseUrl = process.env.SILICONFLOW_BASE_URL || "https://api.siliconflow.cn/v1";
    const model = process.env.FAST_MODEL || "Qwen/Qwen2.5-7B-Instruct";

    if (!apiKey) {
      throw new Error("SILICONFLOW_API_KEY 或 OPENAI_API_KEY 未设置");
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: MANAGER_PROMPT },
          { role: "user", content: input },
        ],
        temperature: 0.3,
        max_tokens: 800,
      }),
    });

    const latency = Date.now() - start;
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content?.trim() || "";
    const decisionType = parseV2Response(content);

    return {
      input,
      expected_mode,
      expected_intent,
      scenario,
      actual_mode: normalizeMode(decisionType),
      decision_type: decisionType,
      latency_ms: latency,
      error: null,
      raw: content.substring(0, 300),
    };
  } catch (e) {
    return {
      input,
      expected_mode,
      expected_intent,
      scenario,
      actual_mode: "error",
      decision_type: null,
      latency_ms: Date.now() - start,
      error: e.message,
      raw: null,
    };
  }
}

// ── Ollama 路径（直调本地 Ollama）────────────────────────────────────────────
async function runOllama(tc) {
  const { input, expected_mode, expected_intent, scenario } = tc;
  const start = Date.now();

  try {
    const model = process.env.OLLAMA_MODEL || "qwen2.5:7b";
    const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer ollama",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: MANAGER_PROMPT },
          { role: "user", content: input },
        ],
        temperature: 0.3,
        max_tokens: 800,
      }),
    });

    const latency = Date.now() - start;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content?.trim() || "";
    const decisionType = parseV2Response(content);

    return {
      input,
      expected_mode,
      expected_intent,
      scenario,
      actual_mode: normalizeMode(decisionType),
      decision_type: decisionType,
      latency_ms: latency,
      error: null,
      raw: content.substring(0, 300),
    };
  } catch (e) {
    return {
      input,
      expected_mode,
      expected_intent,
      scenario,
      actual_mode: "error",
      decision_type: null,
      latency_ms: Date.now() - start,
      error: e.message,
      raw: null,
    };
  }
}

// ── 离线规则基准（与 benchmark-ci.cjs L2 套件规则集对齐）──────────────────────
function runOfflineRules(tc) {
  const { input, expected_mode, expected_intent, scenario } = tc;
  const s = input.trim();
  const text = s.toLowerCase();

  // === Sprint 56 benchmark-ci.cjs ruleRouter L2 patterns ===

  // L2: 推理/分析（复杂比较/因果/预测）
  const reasoningPatterns = [
    /分析.*格局/, /比较.*优缺点/, /解释.*量子/, /解释.*加密/, /分析.*影响机制/,
    /评估.*利弊/, /为什么.*transformer/i, /解释.*python.*javascript/,
    /python.*javascript.*区别/, /关于微服务/, /区别.*是什么/, /和.*的区别/,
    /比较.*维度/, /从.*分析/, /对比.*公司/, /市场份额.*对比/,
  ];
  for (const p of reasoningPatterns) {
    if (p.test(text)) {
      return { ...base(tc), actual_mode: "slow" };
    }
  }

  // L2: 代码（强信号）
  const codePatterns = [
    /实现.*算法/, /写.*函数/, /帮.*写.*脚本/, /调试/, /bug/i, /优化.*sql/i,
    /sql.*优化/, /写.*python/, /实现.*红黑树/, /系统设计/, /分布式.*缓存/,
    /javascript.*函数/, /写.*代码/, /代码.*实现/
  ];
  for (const p of codePatterns) {
    if (p.test(text)) return { ...base(tc), actual_mode: "slow" };
  }

  // L2: 工具链（搜索→处理多步链）
  const toolChainPatterns = [
    /调研/, /调查/, /搜索最新/, /查找.*论文/, /研究.*市场/, /市场.*研究/,
    /对比.*性能/, /对比.*产品/,
    // 多步链：先X再Y
    /先.*搜索.*再/, /先.*查找.*再/, /先.*调研.*再/, /先.*查.*再/,
    /先.*搜索.*然后/, /先.*查找.*然后/, /先.*调研.*然后/, /先.*查.*然后/,
    /先.*搜索.*最后/, /先.*查找.*最后/, /先.*调研.*最后/, /先.*查.*最后/,
  ];
  for (const p of toolChainPatterns) {
    if (p.test(text)) return { ...base(tc), actual_mode: "slow" };
  }

  // L2: 深度摘要（长文档/多维分析）
  const deepSummaryPatterns = [
    /阅读.*报告/, /阅读.*文档/, /阅读.*论文/, /分析.*报告/, /分析.*文档/, /分析.*论文/,
    /总结.*报告/, /总结.*文档/, /quarterly.*business.*report/i,
    /核心观点.*方法论/, /research.*report/i,
  ];
  for (const p of deepSummaryPatterns) {
    if (p.test(text)) return { ...base(tc), actual_mode: "slow" };
  }

  // L2: 跨会话续接
  if (/继续|接着/.test(s) && s.length > 10) {
    return { ...base(tc), actual_mode: "slow" };
  }

  // L2: 边缘：中英混合强信号
  const zhChars = (s.match(/[\u4e00-\u9fa5]/g) || []).length;
  const enWords = (s.match(/[a-zA-Z]{3,}/g) || []).length;
  if (zhChars > 3 && enWords > 1) {
    // 中英混合通常需要 slow 模型理解混合语境
    return { ...base(tc), actual_mode: "slow" };
  }

  // Fast: 空白/纯礼貌
  if (s.length < 5 || s === "请问有什么可以帮助你的吗？") {
    return { ...base(tc), actual_mode: "fast" };
  }

  // 默认 fast（大多数输入走 fast，slow 是例外）
  return { ...base(tc), actual_mode: "fast" };
}

function base(tc) {
  return {
    input: tc.input,
    expected_mode: tc.expected_mode,
    expected_intent: tc.expected_intent,
    scenario: tc.scenario,
    actual_mode: "unknown",
    decision_type: null,
    latency_ms: 0,
    error: null,
    raw: null,
  };
}

// ── 汇总统计 ─────────────────────────────────────────────────────────────────
function summarize(results, label) {
  const total = results.length;
  const errors = results.filter((r) => r.actual_mode === "error").length;
  const valid = results.filter((r) => r.actual_mode !== "error");
  const modeOk = valid.filter((r) => r.expected_mode === r.actual_mode).length;
  const intentOk = valid.filter((r) => r.expected_intent === r.actual_intent).length;
  const rate = valid.length > 0 ? (modeOk / valid.length) * 100 : 0;
  const avgLat = valid.length > 0
    ? Math.round(valid.reduce((s, r) => s + r.latency_ms, 0) / valid.length)
    : 0;

  console.log(`\n=== ${label} ===`);
  console.log(`  总用例:   ${total}`);
  console.log(`  错误:     ${errors}`);
  console.log(`  有效:     ${valid.length}`);
  console.log(`  Mode准确: ${modeOk}/${valid.length} = ${rate.toFixed(1)}%`);
  console.log(`  Intent准: ${intentOk}/${valid.length} = ${((intentOk / valid.length) * 100).toFixed(1)}%`);
  if (avgLat > 0) console.log(`  平均延迟: ${avgLat}ms`);

  // 按场景分类
  const byScenario = {};
  for (const r of valid) {
    if (!byScenario[r.scenario]) byScenario[r.scenario] = { total: 0, correct: 0 };
    byScenario[r.scenario].total++;
    if (r.expected_mode === r.actual_mode) byScenario[r.scenario].correct++;
  }
  console.log(`\n  按场景:`);
  for (const [sc, stat] of Object.entries(byScenario)) {
    const pct = (stat.correct / stat.total) * 100;
    console.log(`    ${sc.padEnd(20)} ${stat.correct}/${stat.total} = ${pct.toFixed(1)}%`);
  }

  // 失败用例（最多显示10条）
  const failures = valid.filter((r) => r.expected_mode !== r.actual_mode);
  if (failures.length > 0) {
    console.log(`\n  失败用例 (${failures.length}条):`);
    for (const f of failures.slice(0, 8)) {
      console.log(`    [${f.scenario}/${f.expected_intent}] expected:${f.expected_mode} got:${f.actual_mode} | "${f.input.substring(0, 40)}"`);
    }
    if (failures.length > 8) console.log(`    ... 及其他 ${failures.length - 8} 条`);
  }

  return { total, valid: valid.length, modeOk, intentOk, errors, rate, avgLat, byScenario, failures };
}

// ── 主函数 ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== Sprint 58: L2 在线 Benchmark ===`);
  console.log(`  Provider: ${provider}`);
  console.log(`  Cases:    ${CASES.length}`);
  console.log(`  Model:    ${provider === "siliconflow" ? (process.env.FAST_MODEL || "Qwen/Qwen2.5-7B-Instruct") : provider === "ollama" ? (process.env.OLLAMA_MODEL || "qwen2.5:7b") : "offline_rule"}\n`);

  const allResults = [];
  let runFn;

  if (provider === "offline") {
    runFn = (tc) => Promise.resolve(runOfflineRules(tc));
  } else if (provider === "ollama") {
    runFn = runOllama;
  } else {
    runFn = runSiliconFlow;
  }

  // 顺序执行（避免 API 限流）
  for (let i = 0; i < CASES.length; i++) {
    const r = await runFn(CASES[i]);
    allResults.push(r);
    const icon = r.error ? "⚠" : (r.expected_mode === r.actual_mode ? "✓" : "✗");
    process.stdout.write(`${icon}`);
    if ((i + 1) % 10 === 0) process.stdout.write(` (${i + 1}/${CASES.length})\n`);
  }
  console.log();

  // 在线 LLM 结果
  const llmStats = provider !== "offline"
    ? summarize(allResults, `LLM 路由 [${provider.toUpperCase()}]`)
    : null;

  // 离线规则结果（当运行在线时，一并跑离线作对比）
  if (provider !== "offline") {
    const offlineResults = CASES.map((tc) => runOfflineRules(tc));
    const offlineStats = summarize(offlineResults, "离线规则基线（对比）");

    // 对比摘要
    console.log(`\n=== LLM vs 离线规则 对比 ===`);
    console.log(`  LLM Mode准确:  ${llmStats.rate.toFixed(1)}%`);
    console.log(`  规则 Mode准确:  ${offlineStats.rate.toFixed(1)}%`);
    console.log(`  提升:          +${(llmStats.rate - offlineStats.rate).toFixed(1)}pp`);
    console.log(`  LLM对规则提升:  ${offlineStats.rate > 0 ? `+${((llmStats.rate - offlineStats.rate) / offlineStats.rate * 100).toFixed(0)}%` : "N/A"}`);
  }

  // 保存结果
  const outDir = path.join(__dirname, "results");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `layer2-benchmark-${provider}-${new Date().toISOString().split("T")[0]}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    provider,
    model: provider === "siliconflow"
      ? (process.env.FAST_MODEL || "Qwen/Qwen2.5-7B-Instruct")
      : provider === "ollama"
      ? (process.env.OLLAMA_MODEL || "qwen2.5:7b")
      : "offline_rule",
    total: allResults.length,
    llm_stats: llmStats,
    cases: allResults.map((r) => ({
      scenario: r.scenario,
      expected_mode: r.expected_mode,
      actual_mode: r.actual_mode,
      decision_type: r.decision_type,
      latency_ms: r.latency_ms,
      error: r.error,
    })),
    run_date: new Date().toISOString(),
  }, null, 2));
  console.log(`\n结果已保存: ${outFile}`);
}

main().catch(console.error);
