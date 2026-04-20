import { Hono } from "hono";
import { TaskRepo, DecisionRepo } from "../db/repositories.js";
import { formatTraceSummaries } from "../services/trace-formatter.js";
import { getContextUserId } from "../middleware/identity.js";

// Mounted at /v1/tasks via index.ts
export const taskRouter = new Hono();

// GET /v1/tasks/all — list all tasks (uses /all to avoid /:task_id shadowing the "" route)
taskRouter.get("/all", async (c) => {
  // C3a: userId from middleware context (trusted source)
  const userId = getContextUserId(c)!;
  const sessionId = c.req.query("session_id") || undefined;
  try {
    const tasks = await TaskRepo.list(userId, sessionId);
    return c.json({ tasks });
  } catch (error: any) {
    console.error("Task list error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// GET /v1/tasks/:task_id/summary — must be registered before /:task_id
taskRouter.get("/:task_id/summary", async (c) => {
  const taskId = c.req.param("task_id");
  try {
    // First check if task exists
    const task = await TaskRepo.getById(taskId);
    if (!task) return c.json({ error: `Task not found: ${taskId}` }, 404);

    const summary = await TaskRepo.getSummary(taskId);
    if (!summary) return c.json({ error: `Summary not found for task: ${taskId}` }, 404);
    return c.json({ summary });
  } catch (error: any) {
    console.error("Task summary error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// GET /v1/tasks/:task_id/traces — must be registered before /:task_id
taskRouter.get("/:task_id/traces", async (c) => {
  const taskId = c.req.param("task_id");
  const type = c.req.query("type") || undefined;
  const limitParam = c.req.query("limit");
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 100, 500) : 100;

  try {
    const task = await TaskRepo.getById(taskId);
    if (!task) return c.json({ error: `Task not found: ${taskId}` }, 404);

    const traces = await TaskRepo.getTraces(taskId, { type, limit });
    const summaries = formatTraceSummaries(traces);

    return c.json({
      task_id: taskId,
      count: traces.length,
      traces,
      summaries,
    });
  } catch (error: any) {
    console.error("Task traces error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// GET /v1/tasks/:task_id/decision — get latest decision log for a task (before /:task_id to avoid shadowing)
taskRouter.get("/:task_id/decision", async (c) => {
  const taskId = c.req.param("task_id");
  try {
    const task = await TaskRepo.getById(taskId);
    if (!task) return c.json({ error: `Task not found: ${taskId}` }, 404);
    const decision = await DecisionRepo.getByTaskId(taskId);
    if (!decision) return c.json({ error: `No decision found for task: ${taskId}` }, 404);
    return c.json({ decision });
  } catch (error: any) {
    console.error("Task decision error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// GET /v1/tasks/:task_id — get task detail
taskRouter.get("/:task_id", async (c) => {
  const taskId = c.req.param("task_id");
  try {
    const task = await TaskRepo.getById(taskId);
    if (!task) return c.json({ error: `Task not found: ${taskId}` }, 404);
    return c.json({ task });
  } catch (error: any) {
    console.error("Task detail error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// PATCH /v1/tasks/:task_id — control task lifecycle (T1: resume / pause / cancel)
taskRouter.patch("/:task_id", async (c) => {
  const taskId = c.req.param("task_id");
  // C3a: userId from middleware context
  const userId = getContextUserId(c);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const action = body.action as string | undefined;
  if (!action) return c.json({ error: "body.action is required (resume | pause | cancel)" }, 400);

  const validActions = ["resume", "pause", "cancel"];
  if (!validActions.includes(action)) {
    return c.json({ error: `Invalid action '${action}'. Must be one of: ${validActions.join(", ")}` }, 400);
  }

  // Validate task exists and belongs to user
  const task = await TaskRepo.getById(taskId);
  if (!task) return c.json({ error: `Task not found: ${taskId}` }, 404);
  if (task.user_id !== userId) return c.json({ error: "Forbidden: task does not belong to this user" }, 403);

  // Map action to status
  const statusMap: Record<string, string> = {
    resume: "responding",
    pause: "paused",
    cancel: "cancelled",
  };
  const newStatus = statusMap[action];

  try {
    await TaskRepo.setStatus(taskId, newStatus);
    return c.json({ task_id: taskId, action, status: newStatus });
  } catch (error: any) {
    console.error("Task PATCH error:", error);
    return c.json({ error: error.message }, 500);
  }
});
