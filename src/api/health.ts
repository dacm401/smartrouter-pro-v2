/**
 * H1: Runtime Health Dashboard — GET /health endpoint
 *
 * Returns structured system health information:
 *   - status: "ok" | "degraded" | "error"
 *   - uptime_seconds, version, timestamp
 *   - services: database / model_router / web_search
 *   - stats: task counts, memory entries, evidence
 *
 * No identity middleware — this endpoint is public.
 * Stats queries degrade gracefully: failure → null, does not affect status.
 */

import { Hono } from "hono";
import { query } from "../db/connection.js";
import { config } from "../config.js";

export const healthRouter = new Hono();

const START_TIME = Date.now();

function getProviders(): string[] {
  const providers: string[] = [];
  if (config.openaiApiKey) providers.push("openai");
  if (config.anthropicApiKey) providers.push("anthropic");
  return providers;
}

async function getDbLatencyMs(): Promise<number | null> {
  try {
    const start = Date.now();
    await query("SELECT 1");
    return Date.now() - start;
  } catch {
    return null;
  }
}

async function getStats(): Promise<{
  tasks_total: number;
  tasks_active: number;
  memory_entries: number;
  evidence_total: number;
} | null> {
  try {
    const [tasksResult, memoryResult, evidenceResult] = await Promise.all([
      query(`SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status NOT IN ('completed','failed','cancelled'))::int as active
       FROM tasks`),
      query(`SELECT COUNT(*)::int as count FROM memory_entries`),
      query(`SELECT COUNT(*)::int as count FROM evidence`),
    ]);

    return {
      tasks_total: tasksResult.rows[0]?.total ?? 0,
      tasks_active: tasksResult.rows[0]?.active ?? 0,
      memory_entries: memoryResult.rows[0]?.count ?? 0,
      evidence_total: evidenceResult.rows[0]?.count ?? 0,
    };
  } catch {
    return null;
  }
}

healthRouter.get("/", async (c) => {
  const [dbLatency, stats] = await Promise.all([
    getDbLatencyMs(),
    getStats(),
  ]);

  const dbStatus: "ok" | "error" = dbLatency !== null ? "ok" : "error";
  const webSearchStatus: "configured" | "not_configured" =
    config.webSearch.endpoint ? "configured" : "not_configured";

  const overallStatus: "ok" | "degraded" | "error" =
    dbStatus === "error" ? "degraded" : "ok";

  return c.json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - START_TIME) / 1000),
    version: "1.0.0",
    services: {
      database: {
        status: dbStatus,
        latency_ms: dbLatency,
      },
      model_router: {
        status: "ok",
        providers: getProviders(),
      },
      web_search: {
        status: webSearchStatus,
      },
    },
    stats: stats,
  });
});
