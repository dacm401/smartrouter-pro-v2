/**
 * R1 — E2E Regression Pack: GET /v1/tasks/all + PATCH /v1/tasks/:id
 *
 * Tests tasks endpoint request/response contracts.
 * All DB calls are mocked via vi.mock — no real DB required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { taskRouter } from "../../src/api/tasks.js";

vi.mock("../../src/db/repositories", () => ({
  TaskRepo: {
    list: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    findActiveBySession: vi.fn(),
    setStatus: vi.fn(),
    updateExecution: vi.fn(),
    getSummary: vi.fn(),
    getTraces: vi.fn(),
    createTrace: vi.fn(),
  },
}));

vi.mock("../../src/services/trace-formatter.js", () => ({
  formatTraceSummaries: vi.fn().mockReturnValue([]),
}));

function buildTestApp() {
  const app = new Hono();
  // Stub identity middleware
  app.use("/v1/*", async (c, next) => {
    (c as unknown as { userId: string }).userId = "test-user";
    await next();
  });
  app.route("/v1/tasks", taskRouter);
  return app;
}

const MOCK_TASK = {
  task_id: "task-001",
  user_id: "test-user",
  session_id: "s1",
  title: "Test Task",
  mode: "direct",
  status: "completed",
  complexity: "low",
  risk: "low",
  goal: null,
  budget_profile: {},
  tokens_used: 0,
  tool_calls_used: 0,
  steps_used: 0,
  summary_ref: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe("GET /v1/tasks — R1 E2E Regression Pack", () => {
  let app: Hono;

  beforeEach(() => {
    app = buildTestApp();
    vi.clearAllMocks();
  });

  it("GET /v1/tasks/all → 200 数组", async () => {
    const { TaskRepo } = await import("../../src/db/repositories.js");
    vi.mocked(TaskRepo.list).mockResolvedValueOnce([MOCK_TASK]);

    const res = await app.request("/v1/tasks/all", {
      method: "GET",
      headers: { "X-User-Id": "test-user" },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.tasks)).toBe(true);
    expect(body.tasks.length).toBeGreaterThan(0);
    expect(body.tasks[0].task_id).toBe("task-001");
  });

  it("GET /v1/tasks/all → 空数组时也返回 200", async () => {
    const { TaskRepo } = await import("../../src/db/repositories.js");
    vi.mocked(TaskRepo.list).mockResolvedValueOnce([]);

    const res = await app.request("/v1/tasks/all", {
      method: "GET",
      headers: { "X-User-Id": "test-user" },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.tasks)).toBe(true);
    expect(body.tasks.length).toBe(0);
  });
});

describe("PATCH /v1/tasks/:id — R1 E2E Regression Pack", () => {
  let app: Hono;

  beforeEach(() => {
    app = buildTestApp();
    vi.clearAllMocks();
  });

  it("PATCH /v1/tasks/:id（resume）→ 200", async () => {
    const { TaskRepo } = await import("../../src/db/repositories.js");
    vi.mocked(TaskRepo.getById).mockResolvedValueOnce(MOCK_TASK);
    vi.mocked(TaskRepo.setStatus).mockResolvedValueOnce(undefined);

    const res = await app.request("/v1/tasks/task-001", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-User-Id": "test-user" },
      body: JSON.stringify({ action: "resume" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.action).toBe("resume");
    expect(body.status).toBe("responding");
    expect(TaskRepo.setStatus).toHaveBeenCalledWith("task-001", "responding");
  });

  it("PATCH /v1/tasks/:id（pause）→ 200", async () => {
    const { TaskRepo } = await import("../../src/db/repositories.js");
    vi.mocked(TaskRepo.getById).mockResolvedValueOnce(MOCK_TASK);
    vi.mocked(TaskRepo.setStatus).mockResolvedValueOnce(undefined);

    const res = await app.request("/v1/tasks/task-001", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-User-Id": "test-user" },
      body: JSON.stringify({ action: "pause" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe("paused");
  });

  it("PATCH /v1/tasks/:id（cancel）→ 200", async () => {
    const { TaskRepo } = await import("../../src/db/repositories.js");
    vi.mocked(TaskRepo.getById).mockResolvedValueOnce(MOCK_TASK);
    vi.mocked(TaskRepo.setStatus).mockResolvedValueOnce(undefined);

    const res = await app.request("/v1/tasks/task-001", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-User-Id": "test-user" },
      body: JSON.stringify({ action: "cancel" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe("cancelled");
  });

  it("PATCH /v1/tasks/:id（归属校验失败）→ 403", async () => {
    const { TaskRepo } = await import("../../src/db/repositories.js");
    // Task belongs to a different user
    vi.mocked(TaskRepo.getById).mockResolvedValueOnce({
      ...MOCK_TASK,
      user_id: "other-user",
    });

    const res = await app.request("/v1/tasks/task-001", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-User-Id": "test-user" },
      body: JSON.stringify({ action: "resume" }),
    });

    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.error).toContain("Forbidden");
  });

  it("PATCH /v1/tasks/:id（不存在）→ 404", async () => {
    const { TaskRepo } = await import("../../src/db/repositories.js");
    vi.mocked(TaskRepo.getById).mockResolvedValueOnce(null);

    const res = await app.request("/v1/tasks/not-found", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-User-Id": "test-user" },
      body: JSON.stringify({ action: "resume" }),
    });

    expect(res.status).toBe(404);
  });

  it("PATCH /v1/tasks/:id（缺少 action）→ 400", async () => {
    const res = await app.request("/v1/tasks/task-001", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-User-Id": "test-user" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain("action");
  });

  it("PATCH /v1/tasks/:id（无效 action）→ 400", async () => {
    const res = await app.request("/v1/tasks/task-001", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-User-Id": "test-user" },
      body: JSON.stringify({ action: "invalid_action" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain("Invalid action");
  });
});
