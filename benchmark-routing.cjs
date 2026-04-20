/**
 * Sprint 44: LLM-Native Routing Benchmark
 * 支持 SiliconFlow (默认) 和 Ollama 本地模型
 *
 * SiliconFlow: node benchmark-routing.cjs
 * Ollama:      node benchmark-routing.cjs --provider ollama
 */

const BASE = "http://localhost:3001";
const fs = require("fs");
const path = require("path");

// ── 参数解析 ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const provider = args.includes("--provider") ? args[args.indexOf("--provider") + 1] : "siliconflow";
const ollamaBase = "http://localhost:11434/v1";

// ── 测试用例加载 ──────────────────────────────────────────────────────────────
const cases = JSON.parse(fs.readFileSync(
  path.join(__dirname, "evaluation", "tasks", "routing-benchmark.json"),
  "utf8"
));

// ── Manager Prompt (用于 Ollama 直调) ────────────────────────────────────────
const MANAGER_PROMPT = `You are an AI routing assistant. Your job is to analyze each user request and decide how to route it.

## Available Routes

**fast (direct_answer)**: Simple questions, greetings, factual lookups, single-step tasks.
**slow (delegate_to_slow)**: Complex tasks requiring deep reasoning, multi-step workflows, code generation, analysis, creative work, or specialized knowledge.

## Decision Protocol

Return a JSON object with these fields:
- "routing_layer": "L0" for fast, "L1" for simple slow, "L2" for complex slow
- "routing_intent": one of [general, factual, code, math, creative, reasoning, research, conversation]
- "routing_mode": "direct_answer" or "delegate_to_slow"

Analyze the request, then output ONLY the JSON object.`;

// ── SiliconFlow 路径（调用后端 /api/eval/routing）────────────────────────────
async function runSiliconFlow(tc) {
  const start = Date.now();
  try {
    const res = await fetch(`${BASE}/api/eval/routing`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User-Id": "benchmark-user" },
      body: JSON.stringify({ message: tc.input, language: "zh" }),
    });
    const latency = Date.now() - start;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { ...parseCase(tc), latency_ms: latency, error: null, raw: data };
  } catch (e) {
    return { ...parseCase(tc), latency_ms: Date.now() - start, error: e.message, raw: null };
  }
}

// ── Ollama 路径（直调 Ollama API，不走 backend）───────────────────────────────
async function runOllama(tc) {
  const start = Date.now();
  try {
    const res = await fetch(`${ollamaBase}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer ollama" },
      body: JSON.stringify({
        model: "gemma4:e4b",
        messages: [
          { role: "system", content: MANAGER_PROMPT },
          { role: "user", content: tc.input },
        ],
        temperature: 0.3,
        max_tokens: 500,
      }),
    });
    const latency = Date.now() - start;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content?.trim() || "";

    // 解析 JSON 响应
    let routing_mode = "fast"; // 默认为 fast
    let routing_intent = "general";
    let routing_layer = "L0";

    try {
      // 去掉 markdown code block 包裹
      const cleanContent = content.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
      const jsonMatch = cleanContent.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        routing_mode = normalizeMode(parsed.routing_mode || "direct_answer");
        routing_intent = parsed.routing_intent || "general";
        routing_layer = parsed.routing_layer || "L0";
      }
    } catch (_) {
      // JSON 解析失败，尝试关键词推断
      if (content.includes("delegate") || content.includes("slow")) routing_mode = "slow";
      if (content.includes("code") || content.includes("代码")) routing_intent = "code";
      else if (content.includes("math") || content.includes("数学")) routing_intent = "math";
    }

    return {
      input: tc.input,
      expected_mode: tc.expected_mode,
      actual_mode: routing_mode,
      expected_intent: tc.expected_intent,
      actual_intent: routing_intent,
      expected_layer: tc.expected_layer,
      actual_layer: routing_layer,
      latency_ms: latency,
      error: null,
      raw: content.substring(0, 200),
    };
  } catch (e) {
    return {
      input: tc.input,
      expected_mode: tc.expected_mode,
      actual_mode: "error",
      expected_intent: tc.expected_intent,
      actual_intent: "error",
      expected_layer: tc.expected_layer,
      actual_layer: "error",
      latency_ms: Date.now() - start,
      error: e.message,
      raw: null,
    };
  }
}

// 标准化：benchmark 用 "fast"/"slow"，router 用 "direct_answer"/"delegate_to_slow"
function normalizeMode(m) {
  if (m === "fast" || m === "direct_answer") return "fast";
  if (m === "slow" || m === "delegate_to_slow") return "slow";
  return m;
}

function parseCase(tc) {
  return {
    input: tc.input,
    expected_mode: tc.expected_mode,
    actual_mode: tc.actual_mode || "unknown",
    expected_intent: tc.expected_intent,
    actual_intent: tc.actual_intent || "unknown",
    expected_layer: tc.expected_layer,
    actual_layer: tc.actual_layer || "L0",
    latency_ms: tc.latency_ms || 0,
    error: tc.error || null,
  };
}

// ── 主函数 ────────────────────────────────────────────────────────────────────
async function main() {
  const runFn = provider === "ollama" ? runOllama : runSiliconFlow;
  console.log(`\n=== Routing Benchmark [${provider.toUpperCase()}] — ${cases.length} cases ===\n`);

  const results = [];
  for (let i = 0; i < cases.length; i++) {
    const r = await runFn(cases[i]);
    // SiliconFlow 路径从 raw 数据里取结果
    if (provider === "siliconflow" && r.raw) {
      r.actual_mode = normalizeMode(r.raw.selected_role || "direct_answer");
      r.actual_intent = r.raw.routing_intent || "unknown";
      r.actual_layer = r.raw.routing_layer || "L0";
    }
    results.push(r);
    // 统一用 normalizeMode 比较
    const expNorm = normalizeMode(r.expected_mode);
    const actNorm = normalizeMode(r.actual_mode);
    const icon = (expNorm === actNorm) ? "✓" : "✗";
    process.stdout.write(`${icon}`);
    if ((i + 1) % 10 === 0) process.stdout.write(` (${i + 1}/${cases.length})\n`);
  }

  console.log(`\n\n=== 结果汇总 ===`);

  const total = results.length;
  const modeOk = results.filter(r => normalizeMode(r.expected_mode) === normalizeMode(r.actual_mode)).length;
  const intentOk = results.filter(r => r.expected_intent === r.actual_intent).length;
  const layerOk = results.filter(r => r.expected_layer === r.actual_layer).length;
  const errors = results.filter(r => r.actual_mode === "error").length;
  const totalLatency = results.reduce((s, r) => s + r.latency_ms, 0);

  console.log(`总用例:    ${total}`);
  console.log(`错误:      ${errors}`);
  console.log(`Mode准确:  ${modeOk}/${total} = ${(modeOk/total*100).toFixed(1)}%`);
  console.log(`Intent准确: ${intentOk}/${total} = ${(intentOk/total*100).toFixed(1)}%`);
  console.log(`Layer准确: ${layerOk}/${total} = ${(layerOk/total*100).toFixed(1)}%`);
  console.log(`平均延迟:  ${(totalLatency/total).toFixed(0)}ms`);

  // 按 layer 分类
  const byLayer = {};
  for (const r of results) {
    if (!byLayer[r.expected_layer]) byLayer[r.expected_layer] = { total: 0, correct: 0 };
    byLayer[r.expected_layer].total++;
    if (normalizeMode(r.expected_mode) === normalizeMode(r.actual_mode)) byLayer[r.expected_layer].correct++;
  }
  console.log(`\n按 Layer:`);
  for (const [layer, stat] of Object.entries(byLayer)) {
    console.log(`  ${layer.padEnd(4)}: ${stat.correct}/${stat.total} = ${(stat.correct/stat.total*100).toFixed(1)}%`);
  }

  // 按 intent 分类
  const byIntent = {};
  for (const r of results) {
    if (!byIntent[r.expected_intent]) byIntent[r.expected_intent] = { total: 0, correct: 0 };
    byIntent[r.expected_intent].total++;
    if (normalizeMode(r.expected_mode) === normalizeMode(r.actual_mode)) byIntent[r.expected_intent].correct++;
  }
  console.log(`\n按 Intent:`);
  for (const [intent, stat] of Object.entries(byIntent)) {
    console.log(`  ${intent.padEnd(15)}: ${stat.correct}/${stat.total} = ${(stat.correct/stat.total*100).toFixed(1)}%`);
  }

  // 失败用例
  const failures = results.filter(r => normalizeMode(r.expected_mode) !== normalizeMode(r.actual_mode) && r.actual_mode !== "error");
  if (failures.length > 0) {
    console.log(`\n失败用例 (${failures.length}条):`);
    for (const f of failures.slice(0, 10)) {
      console.log(`  [${f.expected_layer}/${f.expected_intent}] => expected:${f.expected_mode} got:${f.actual_mode} | "${f.input.substring(0,40)}"`);
    }
    if (failures.length > 10) console.log(`  ... 及其他 ${failures.length - 10} 条`);
  }

  // 写 JSON
  const outPath = path.join(__dirname, "..", "results", `routing-benchmark-${provider}-${new Date().toISOString().split("T")[0]}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    provider,
    model: provider === "ollama" ? "gemma4:e4b" : "Qwen2.5-7B",
    total, modeOk, intentOk, layerOk, errors,
    mode_accuracy: `${(modeOk/total*100).toFixed(1)}%`,
    intent_accuracy: `${(intentOk/total*100).toFixed(1)}%`,
    layer_accuracy: `${(layerOk/total*100).toFixed(1)}%`,
    avg_latency_ms: parseInt(totalLatency/total),
    byLayer, byIntent,
    cases: results.map(r => ({ ...r, actual_mode: normalizeMode(r.actual_mode) })),
    run_date: new Date().toISOString(),
  }, null, 2));
  console.log(`\n结果已保存: ${outPath}`);

  // CI 判断
  const modeRate = modeOk / total * 100;
  const intentRate = intentOk / total * 100;
  const ciMode = modeRate >= 50 ? "✅ PASS" : "❌ FAIL";
  const ciIntent = intentRate >= 70 ? "✅ PASS" : "❌ FAIL";
  console.log(`\nCI Gate: Mode(${modeRate.toFixed(1)}% >= 50%) ${ciMode} | Intent(${intentRate.toFixed(1)}% >= 70%) ${ciIntent}`);
}

main().catch(console.error);
