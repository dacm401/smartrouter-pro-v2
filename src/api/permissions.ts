/**
 * Sprint 64 — Permissions & Task Workspace REST API
 *
 * POST /v1/permissions/request      — Worker 发起授权请求
 * POST /v1/permissions/:id/approve  — 主人批准
 * POST /v1/permissions/:id/deny     — 主人拒绝
 * GET  /v1/permissions/pending      — 主人查看待确认请求
 * GET  /v1/permissions/task/:taskId — 查看任务的所有请求
 *
 * POST /v1/workspaces               — 创建工作空间
 * GET  /v1/workspaces/:taskId       — 获取快照（供 Worker 读）
 * POST /v1/workspaces/:taskId/output — Worker 写入产出
 * GET  /v1/workspaces/user/mine     — 用户当前活跃工作空间
 */

import { Hono } from "hono";
import { randomUUID } from "crypto";
import {
  PermissionRequestRepo,
  ScopedTokenRepo,
} from "../db/repositories.js";
import {
  buildPermissionRequestPrompt,
  issueScopedToken,
} from "../services/permission-manager.js";
import { TaskWorkspaceService } from "../services/task-workspace.js";

export function createPermissionsRouter(): Hono {
  const app = new Hono();

  // ── Permission Requests ────────────────────────────────────────────────────

  /**
   * POST /v1/permissions/request
   * Worker 或 Fast 代为发起授权请求
   */
  app.post("/request", async (c) => {
    const body = await c.req.json();
    const {
      task_id, worker_id, user_id, session_id,
      field_name, field_key, purpose, value_preview, expires_in,
    } = body;

    if (!task_id || !worker_id || !user_id || !session_id || !field_name || !field_key || !purpose) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    const req = await PermissionRequestRepo.create({
      id: randomUUID(),
      task_id, worker_id, user_id, session_id,
      field_name, field_key, purpose,
      value_preview,
      expires_in: expires_in ?? 300,
    });

    return c.json({ request_id: req.id, status: req.status });
  });

  /**
   * POST /v1/permissions/:id/approve
   * 主人批准授权，自动生成 scoped token
   */
  app.post("/:id/approve", async (c) => {
    const reqId = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const resolvedBy = body.resolved_by ?? "owner";
    const approvedScope = body.approved_scope;

    await PermissionRequestRepo.approve(reqId, resolvedBy, approvedScope);

    // 查出 request 记录以发 token
    const allForTask = await PermissionRequestRepo.getByTask(reqId).then(() => []);
    // 简化：token scope = field_key（实际应从 request 读取）
    const scopedToken = await issueScopedToken({
      taskId: reqId,
      workerId: "auto",
      userId: resolvedBy,
      scope: approvedScope ? [approvedScope] : ["*"],
      expiresInSeconds: 300,
    });

    return c.json({ approved: true, scoped_token: scopedToken });
  });

  /**
   * POST /v1/permissions/:id/deny
   * 主人拒绝授权
   */
  app.post("/:id/deny", async (c) => {
    const reqId = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const resolvedBy = body.resolved_by ?? "owner";

    await PermissionRequestRepo.deny(reqId, resolvedBy);
    return c.json({ denied: true });
  });

  /**
   * GET /v1/permissions/pending?user_id=xxx
   * 主人查看所有待确认的权限请求，附带给主人看的提示文本
   */
  app.get("/pending", async (c) => {
    const userId = c.req.query("user_id");
    if (!userId) return c.json({ error: "user_id required" }, 400);

    await PermissionRequestRepo.expireOld();
    const requests = await PermissionRequestRepo.getPending(userId);
    const prompt = buildPermissionRequestPrompt(requests);

    return c.json({ requests, prompt_hint: prompt });
  });

  /**
   * GET /v1/permissions/task/:taskId
   * 查看某任务的所有权限请求
   */
  app.get("/task/:taskId", async (c) => {
    const taskId = c.req.param("taskId");
    const records = await PermissionRequestRepo.getByTask(taskId);
    return c.json({ requests: records });
  });

  /**
   * POST /v1/permissions/token/validate
   * 验证 scoped token（供 Fast 代理调用时校验）
   */
  app.post("/token/validate", async (c) => {
    const body = await c.req.json();
    const { token, required_scope } = body;
    if (!token || !required_scope) {
      return c.json({ valid: false, error: "token and required_scope required" }, 400);
    }

    const record = await ScopedTokenRepo.validate(token);
    if (!record) return c.json({ valid: false, reason: "expired or not found" });

    const hasScope =
      record.scope.includes(required_scope) || record.scope.includes("*");
    return c.json({ valid: hasScope, worker_id: record.worker_id, user_id: record.user_id });
  });

  return app;
}

// ── Task Workspace Router ─────────────────────────────────────────────────────

export function createWorkspacesRouter(): Hono {
  const app = new Hono();

  /**
   * POST /v1/workspaces
   * Fast 创建工作空间
   */
  app.post("/", async (c) => {
    const body = await c.req.json();
    const { task_id, user_id, session_id, objective, constraints } = body;
    if (!task_id || !user_id || !session_id || !objective) {
      return c.json({ error: "task_id, user_id, session_id, objective required" }, 400);
    }

    const ws = await TaskWorkspaceService.create({
      task_id, user_id, session_id, objective,
      constraints: constraints ?? [],
    });
    return c.json(ws);
  });

  /**
   * GET /v1/workspaces/:taskId?worker_id=xxx
   * Worker 获取工作空间快照
   */
  app.get("/:taskId", async (c) => {
    const taskId = c.req.param("taskId");
    const workerId = c.req.query("worker_id") ?? "anonymous";
    const snapshot = await TaskWorkspaceService.getSnapshot(taskId, workerId);
    if (!snapshot) return c.json({ error: "Workspace not found" }, 404);

    const prompt = TaskWorkspaceService.buildWorkspacePrompt(snapshot);
    return c.json({ snapshot, workspace_prompt: prompt });
  });

  /**
   * POST /v1/workspaces/:taskId/output
   * Worker 写入产出
   */
  app.post("/:taskId/output", async (c) => {
    const taskId = c.req.param("taskId");
    const body = await c.req.json();
    const { worker_id, output_key, output_value } = body;
    if (!worker_id || !output_key || output_value === undefined) {
      return c.json({ error: "worker_id, output_key, output_value required" }, 400);
    }

    await TaskWorkspaceService.writeOutput({
      task_id: taskId, worker_id, output_key, output_value,
    });
    return c.json({ written: true });
  });

  /**
   * GET /v1/workspaces/user/mine?user_id=xxx
   * 查看用户当前活跃工作空间列表
   */
  app.get("/user/mine", async (c) => {
    const userId = c.req.query("user_id");
    if (!userId) return c.json({ error: "user_id required" }, 400);
    const list = await TaskWorkspaceService.getByUser(userId);
    return c.json({ workspaces: list });
  });

  /**
   * GET /v1/workspaces/:taskId/collect
   * Fast 收集所有 Worker 产出，汇总后返回主人
   */
  app.get("/:taskId/collect", async (c) => {
    const taskId = c.req.param("taskId");
    const outputs = await TaskWorkspaceService.collectOutputs(taskId);
    return c.json({ outputs });
  });

  return app;
}
