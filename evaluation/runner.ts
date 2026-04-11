/**
 * B2: Benchmark Runner v2 — 接真实 API
 *
 * 升级自 B1 skeleton:
 *   - CLI args: --base-url, --user-id, --suite
 *   - 30s per-request timeout
 *   - printSummary() 格式化摘要
 *   - 输出到 evaluation/results/latest.json
 *
 * Usage:
 *   npx ts-node evaluation/runner.ts
 *   npx ts-node evaluation/runner.ts --base-url http://localhost:3001 --user-id test-user --suite direct
 *   npm run benchmark -- --suite execute
 */

import * as fs from "fs";
import * as path from "path";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BenchmarkTask {
  id: string;
  /** Short human-readable description */
  description: string;
  /** The user message to send */
  prompt: string;
  /** Expected routing mode */
  expected_mode: "direct" | "research" | "execute";
  /** Optional: expected role (fast/slow) */
  expected_role?: "fast" | "slow";
  /** Optional: body.execute flag for execute-mode tasks */
  execute?: boolean;
}

export interface BenchmarkResult {
  task_id: string;
  description: string;
  prompt_preview: string;
  expected_mode: string;
  actual_mode: string | null;
  actual_role: string | null;
  matched: boolean;
  latency_ms: number;
  tokens_used: number;
  error?: string;
}

export interface BenchmarkSummary {
  total: number;
  passed: number;
  failed: number;
  errors: number;
  pass_rate: string;
  total_latency_ms: number;
  avg_latency_ms: number;
  timestamp: string;
}

// ── CLI argument parsing ────────────────────────────────────────────────────────

interface CliArgs {
  baseUrl: string;
  userId: string;
  suite: string | null;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let baseUrl = process.env.API_BASE || "http://localhost:3001";
  let userId = process.env.BENCHMARK_USER_ID || "benchmark-user";
  let suite: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--base-url" && i + 1 < args.length) {
      baseUrl = args[++i];
    } else if (arg === "--user-id" && i + 1 < args.length) {
      userId = args[++i];
    } else if (arg === "--suite" && i + 1 < args.length) {
      suite = args[++i];
    }
  }

  return { baseUrl, userId, suite };
}

// ── Task loading ────────────────────────────────────────────────────────────────

function loadTasks(tasksDir: string, suite: string | null): BenchmarkTask[] {
  const tasks: BenchmarkTask[] = [];

  if (!fs.existsSync(tasksDir)) return tasks;

  const files = suite
    ? [path.join(tasksDir, `${suite}.json`)]
    : fs.readdirSync(tasksDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => path.join(tasksDir, f));

  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, "utf-8");
    try {
      const parsed = JSON.parse(content) as BenchmarkTask[] | BenchmarkTask;
      if (Array.isArray(parsed)) tasks.push(...parsed);
      else tasks.push(parsed);
    } catch {
      console.warn(`Skipping invalid JSON: ${file}`);
    }
  }

  return tasks;
}

// ── Core runner (30s timeout) ──────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 30_000;

async function runBenchmark(
  tasks: BenchmarkTask[],
  apiBase: string,
  userId: string
): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  for (const task of tasks) {
    const start = Date.now();
    try {
      const sessionId = `bench-${task.id}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const fetchOptions: RequestInit = {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User-Id": userId },
        body: JSON.stringify({
          user_id: userId,
          session_id: sessionId,
          message: task.prompt,
          history: [],
          ...(task.execute ? { execute: true } : {}),
        }),
        signal: controller.signal,
      };

      const res = await fetch(`${apiBase}/api/chat`, fetchOptions);
      clearTimeout(timeout);

      const data = await res.json() as any;
      const decision = data?.decision;
      const actualMode = decision?.routing?.selected_role === "fast" ? "direct" : "research";
      const actualRole = decision?.routing?.selected_role ?? null;
      const tokensUsed =
        (decision?.execution?.input_tokens ?? 0) +
        (decision?.execution?.output_tokens ?? 0);

      const matched =
        task.expected_mode === actualMode &&
        (task.expected_role ? task.expected_role === actualRole : true);

      results.push({
        task_id: task.id,
        description: task.description,
        prompt_preview: task.prompt.slice(0, 80),
        expected_mode: task.expected_mode,
        actual_mode: actualMode,
        actual_role: actualRole,
        matched,
        latency_ms: Date.now() - start,
        tokens_used: tokensUsed,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        task_id: task.id,
        description: task.description,
        prompt_preview: task.prompt.slice(0, 80),
        expected_mode: task.expected_mode,
        actual_mode: null,
        actual_role: null,
        matched: false,
        latency_ms: Date.now() - start,
        tokens_used: 0,
        error: message.length > 200 ? message.slice(0, 200) + "..." : message,
      });
    }
  }

  return results;
}

// ── Summary ───────────────────────────────────────────────────────────────────

function printSummary(results: BenchmarkResult[]): void {
  const total = results.length;
  const passed = results.filter((r) => r.matched).length;
  const failed = total - passed - results.filter((r) => r.error).length;
  const errors = results.filter((r) => r.error).length;
  const totalLatency = results.reduce((sum, r) => sum + r.latency_ms, 0);
  const avgLatency = total > 0 ? Math.round(totalLatency / total) : 0;
  const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : "0.0";

  console.log("\n" + "=".repeat(64));
  console.log("  Benchmark Summary");
  console.log("=".repeat(64));
  console.log(`  Total:   ${total}`);
  console.log(`  Passed:  ${passed}  ✅`);
  console.log(`  Failed:  ${failed}  ⚠️`);
  console.log(`  Errors:  ${errors}  ❌`);
  console.log(`  Rate:    ${passRate}%`);
  console.log(`  Latency: avg ${avgLatency}ms  total ${totalLatency}ms`);
  console.log("=".repeat(64));

  if (failed > 0 || errors > 0) {
    console.log("\n  Detail:");
    for (const r of results) {
      if (!r.matched) {
        const icon = r.error ? "❌" : "⚠️";
        console.log(`  ${icon} [${r.task_id}] ${r.description}`);
        console.log(`     Expected: ${r.expected_mode}  Actual: ${r.actual_mode ?? "N/A"}`);
        if (r.error) console.log(`     Error: ${r.error}`);
      }
    }
  }
  console.log();
}

// ── Output file ────────────────────────────────────────────────────────────────

function writeResults(
  results: BenchmarkResult[],
  outputDir: string
): string {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString();
  const summary: BenchmarkSummary = {
    total: results.length,
    passed: results.filter((r) => r.matched).length,
    failed: results.filter((r) => !r.matched && !r.error).length,
    errors: results.filter((r) => r.error).length,
    pass_rate: results.length > 0
      ? ((results.filter((r) => r.matched).length / results.length) * 100).toFixed(1) + "%"
      : "0.0%",
    total_latency_ms: results.reduce((s, r) => s + r.latency_ms, 0),
    avg_latency_ms: results.length > 0
      ? Math.round(results.reduce((s, r) => s + r.latency_ms, 0) / results.length)
      : 0,
    timestamp,
  };

  const output = {
    summary,
    results,
    generated_at: timestamp,
  };

  const outputPath = path.join(outputDir, "latest.json");
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  return outputPath;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const tasksDir = path.join(__dirname, "tasks");
  const resultsDir = path.join(__dirname, "results");

  console.log("🏃 SmartRouter Pro — Benchmark Runner v2");
  console.log(`   API Base: ${args.baseUrl}`);
  console.log(`   User ID:  ${args.userId}`);
  console.log(`   Suite:    ${args.suite ?? "all"}`);
  console.log(`   Timeout:  ${REQUEST_TIMEOUT_MS / 1000}s per request`);

  const tasks = loadTasks(tasksDir, args.suite);
  if (tasks.length === 0) {
    console.error(
      `\nNo tasks found${args.suite ? ` for suite '${args.suite}'` : ""}. ` +
      `Add JSON files to ${tasksDir}/ (e.g. direct.json, research.json, execute.json).`
    );
    process.exit(1);
  }

  console.log(`\nLoaded ${tasks.length} task(s). Running benchmark...\n`);

  const results = await runBenchmark(tasks, args.baseUrl, args.userId);
  printSummary(results);

  const outputPath = writeResults(results, resultsDir);
  console.log(`Results: ${outputPath}`);
}

main().catch((err) => {
  console.error("\nBenchmark runner crashed:", err);
  process.exit(1);
});
