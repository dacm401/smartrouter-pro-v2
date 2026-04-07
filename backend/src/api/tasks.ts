import { Hono } from "hono";
import { TaskRepo } from "../db/repositories.js";

// Mounted at /v1/tasks via index.ts
export const taskRouter = new Hono();

// GET /v1/tasks/all — list all tasks (uses /all to avoid /:task_id shadowing the "" route)
taskRouter.get("/all", async (c) => {
  const userId = c.req.query("user_id") || "default-user";
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
