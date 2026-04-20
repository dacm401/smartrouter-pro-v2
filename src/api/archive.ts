/**
 * Task Archive API — LLM-Native 路由专用
 *
 * Fast/Slow 共享工作台接口：
 * POST   /v1/archive/tasks        — Fast 创建任务档案
 * GET    /v1/archive/tasks/:id     — Slow/Fast 查询上下文
 * PATCH  /v1/archive/tasks/:id/status — Slow 更新状态
 * PATCH  /v1/archive/tasks/:id/observation — Fast 追加观察
 * PATCH  /v1/archive/tasks/:id/execution  — Slow 写入执行结果
 * DELETE /v1/archive/tasks/:id     — Fast 清理完成的任务
 * GET    /v1/archive/tasks        — 按 session 查历史
 */

import { Hono } from "hono";
import { v4 as uuid } from "uuid";
import { TaskArchiveRepo } from "../db/repositories.js";
import { getContextUserId } from "../middleware/identity.js";
import type { TaskArchiveEntry } from "../db/repositories.js";

const archiveRouter = new Hono();

// ── 创建任务档案 ─────────────────────────────────────────────────────────────

archiveRouter.post("/v1/archive/tasks", async (c) => {
  const rawBody = await c.req.raw.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const userId = getContextUserId(c) || (body.user_id as string);
  const sessionId = body.session_id as string;
  const command = body.command as TaskArchiveEntry["command"];

  if (!sessionId) return c.json({ error: "session_id is required" }, 400);
  if (!command || !command.action || !command.task) {
    return c.json({ error: "command with action and task is required" }, 400);
  }

  try {
    const entry = await TaskArchiveRepo.create({
      task_id: uuid(),
      session_id: sessionId,
      turn_id: (body.turn_id as number) ?? 0,
      command,
      user_input: body.user_input as string || "",
      constraints: (body.constraints as string[]) ?? [],
    });
    return c.json(entry, 201);
  } catch (e: any) {
    console.error("[archive] create failed:", e.message);
    return c.json({ error: e.message }, 500);
  }
});

// ── 查询任务上下文 ────────────────────────────────────────────────────────────

archiveRouter.get("/v1/archive/tasks/:id", async (c) => {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "id is required" }, 400);

  const entry = await TaskArchiveRepo.getById(id);
  if (!entry) return c.json({ error: "Task archive not found" }, 404);

  return c.json(entry);
});

// ── 按 session 查历史 ────────────────────────────────────────────────────────

archiveRouter.get("/v1/archive/tasks", async (c) => {
  const sessionId = c.req.query("session_id");
  if (!sessionId) return c.json({ error: "session_id query param is required" }, 400);

  const limit = Math.min(parseInt(c.req.query("limit") || "10"), 100);
  const entries = await TaskArchiveRepo.getBySession(sessionId, limit);

  return c.json({ entries, count: entries.length });
});

// ── 追加 Fast 观察 ───────────────────────────────────────────────────────────

archiveRouter.patch("/v1/archive/tasks/:id/observation", async (c) => {
  const id = c.req.param("id");
  const rawBody = await c.req.raw.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  if (!body.observation) return c.json({ error: "observation is required" }, 400);

  await TaskArchiveRepo.appendObservation(id, {
    timestamp: Date.now(),
    observation: body.observation as string,
  });

  return c.json({ success: true });
});

// ── 写入执行结果 ────────────────────────────────────────────────────────────

archiveRouter.patch("/v1/archive/tasks/:id/execution", async (c) => {
  const id = c.req.param("id");
  const rawBody = await c.req.raw.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const status = body.status as "done" | "failed";
  if (!status || !["done", "failed"].includes(status)) {
    return c.json({ error: "status must be 'done' or 'failed'" }, 400);
  }

  await TaskArchiveRepo.writeExecution({
    id,
    status,
    result: body.result as string | undefined,
    errors: body.errors as string[] | undefined,
    started_at: body.started_at as string | undefined,
    deviations: body.deviations as string[] | undefined,
  });

  return c.json({ success: true, status });
});

// ── 更新状态 ────────────────────────────────────────────────────────────────

archiveRouter.patch("/v1/archive/tasks/:id/status", async (c) => {
  const id = c.req.param("id");
  const rawBody = await c.req.raw.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const status = body.status as TaskArchiveEntry["status"];
  const validStatuses: TaskArchiveEntry["status"][] = ["pending", "running", "done", "failed", "cancelled"];
  if (!status || !validStatuses.includes(status)) {
    return c.json({ error: `status must be one of: ${validStatuses.join(", ")}` }, 400);
  }

  await TaskArchiveRepo.updateStatus(id, status);
  return c.json({ success: true, status });
});

// ── 清理完成的任务 ─────────────────────────────────────────────────────────

archiveRouter.delete("/v1/archive/tasks/:id", async (c) => {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "id is required" }, 400);

  const entry = await TaskArchiveRepo.getById(id);
  if (!entry) return c.json({ error: "Task archive not found" }, 404);

  if (!["done", "failed", "cancelled"].includes(entry.status)) {
    return c.json({ error: "Can only delete tasks with status done/failed/cancelled" }, 400);
  }

  const { query } = await import("../db/connection.js");
  await query(`DELETE FROM task_archives WHERE id=$1`, [id]);

  return c.json({ success: true });
});

export { archiveRouter };
