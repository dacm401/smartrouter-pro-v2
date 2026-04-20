// workspace: 20260416214742
/**
 * IT-002: TaskRepo Integration Tests — Sprint 10
 *
 * Validates real SQL contracts for:
 *   - create / getById / list
 *   - updateExecution
 *   - createTrace / getTraces
 *   - getSummary
 *
 * Infrastructure: tests/db/harness.ts
 *   Setup:  DATABASE_URL → smartrouter_test (vitest env)
 *   Schema: CREATE TABLE IF NOT EXISTS on startup (idempotent)
 *   Isolation: beforeEach → truncateTables() → COMMIT
 *
 * Sort contracts confirmed from code:
 *   list()       → ORDER BY updated_at DESC
 *   getTraces()  → ORDER BY created_at ASC
 *   updateExecution on non-existent taskId → silent success (0 rows affected, no error)
 */

import { v4 as uuid } from "uuid";
import { TaskRepo } from "../../src/db/repositories.js";
import { truncateTables } from "../db/harness.js";

const USER_A = uuid();
const USER_B = uuid();
const SESSION_A = uuid();
const SESSION_B = uuid();

beforeEach(async () => {
  await truncateTables();
});

// ── create() ──────────────────────────────────────────────────────────────────

test("create() writes all required fields", async () => {
  const id = uuid();
  await TaskRepo.create({
    id,
    user_id: USER_A,
    session_id: SESSION_A,
    title: "Test Task",
    mode: "execute",
    complexity: "high",
    risk: "medium",
    goal: "Achieve something",
  });

  const row = await TaskRepo.getById(id);
  expect(row).not.toBeNull();
  expect(row!.task_id).toBe(id);
  expect(row!.user_id).toBe(USER_A);
  expect(row!.session_id).toBe(SESSION_A);
  expect(row!.title).toBe("Test Task");
  expect(row!.mode).toBe("execute");
  expect(row!.status).toBe("completed");
  expect(row!.complexity).toBe("high");
  expect(row!.risk).toBe("medium");
  expect(row!.goal).toBe("Achieve something");
  expect(row!.created_at).toBeTruthy();
  expect(row!.updated_at).toBeTruthy();
});

test("create() goal defaults to null when omitted", async () => {
  const id = uuid();
  await TaskRepo.create({
    id,
    user_id: USER_A,
    session_id: SESSION_A,
    title: "No Goal",
    mode: "direct",
    complexity: "low",
    risk: "low",
  });

  const row = await TaskRepo.getById(id);
  expect(row!.goal).toBeNull();
});

test("create() tokens_used defaults to 0", async () => {
  const id = uuid();
  await TaskRepo.create({ id, user_id: USER_A, session_id: SESSION_A, title: "Tokens Test", mode: "direct", complexity: "low", risk: "low" });

  const row = await TaskRepo.getById(id);
  expect(row!.tokens_used).toBe(0);
});

test("create() budget_profile defaults to {}", async () => {
  const id = uuid();
  await TaskRepo.create({ id, user_id: USER_A, session_id: SESSION_A, title: "Budget Test", mode: "direct", complexity: "low", risk: "low" });

  const row = await TaskRepo.getById(id);
  expect(row!.budget_profile).toEqual({});
});

test("create() summary_ref is null (not written)", async () => {
  const id = uuid();
  await TaskRepo.create({ id, user_id: USER_A, session_id: SESSION_A, title: "Summary Ref Test", mode: "direct", complexity: "low", risk: "low" });

  const row = await TaskRepo.getById(id);
  expect(row!.summary_ref).toBeNull();
});

// ── getById() ──────────────────────────────────────────────────────────────────

test("getById() returns complete record when found", async () => {
  const id = uuid();
  await TaskRepo.create({ id, user_id: USER_A, session_id: SESSION_A, title: "Found", mode: "research", complexity: "medium", risk: "low" });

  const row = await TaskRepo.getById(id);
  expect(row).not.toBeNull();
  expect(row!.task_id).toBe(id);
  expect(row!.title).toBe("Found");
});

test("getById() returns null when not found", async () => {
  const row = await TaskRepo.getById(uuid());
  expect(row).toBeNull();
});

// ── list() ─────────────────────────────────────────────────────────────────────

test("list() filters by user_id", async () => {
  const idA = uuid();
  const idB = uuid();
  await TaskRepo.create({ id: idA, user_id: USER_A, session_id: SESSION_A, title: "A's task", mode: "direct", complexity: "low", risk: "low" });
  await TaskRepo.create({ id: idB, user_id: USER_B, session_id: SESSION_B, title: "B's task", mode: "direct", complexity: "low", risk: "low" });

  const rows = await TaskRepo.list(USER_A);
  expect(rows).toHaveLength(1);
  expect(rows[0].task_id).toBe(idA);
});

test("list() orders by updated_at DESC (newest first)", async () => {
  const id1 = uuid();
  const id2 = uuid();
  const id3 = uuid();
  await TaskRepo.create({ id: id1, user_id: USER_A, session_id: SESSION_A, title: "First", mode: "direct", complexity: "low", risk: "low" });
  await TaskRepo.create({ id: id2, user_id: USER_A, session_id: SESSION_A, title: "Second", mode: "direct", complexity: "low", risk: "low" });
  await TaskRepo.create({ id: id3, user_id: USER_A, session_id: SESSION_A, title: "Third", mode: "direct", complexity: "low", risk: "low" });

  // updateExecution touches updated_at — make id1 the most recent
  await TaskRepo.updateExecution(id1, 100);

  const rows = await TaskRepo.list(USER_A);
  expect(rows.map(r => r.task_id)).toEqual([id1, id3, id2]);
});

test("list() with sessionId returns only that session's tasks", async () => {
  const idA = uuid();
  const idB = uuid();
  await TaskRepo.create({ id: idA, user_id: USER_A, session_id: SESSION_A, title: "Session A", mode: "direct", complexity: "low", risk: "low" });
  await TaskRepo.create({ id: idB, user_id: USER_A, session_id: SESSION_B, title: "Session B", mode: "direct", complexity: "low", risk: "low" });

  const rows = await TaskRepo.list(USER_A, SESSION_A);
  expect(rows).toHaveLength(1);
  expect(rows[0].task_id).toBe(idA);
});

test("list() with non-existent sessionId returns empty array", async () => {
  const rows = await TaskRepo.list(USER_A, uuid());
  expect(rows).toEqual([]);
});

test("list() returns TaskListItem shape with correct fields", async () => {
  const id = uuid();
  await TaskRepo.create({ id, user_id: USER_A, session_id: SESSION_A, title: "Shape Test", mode: "execute", complexity: "high", risk: "medium" });

  const rows = await TaskRepo.list(USER_A);
  expect(rows[0]).toHaveProperty("task_id");
  expect(rows[0]).toHaveProperty("title");
  expect(rows[0]).toHaveProperty("mode");
  expect(rows[0]).toHaveProperty("status");
  expect(rows[0]).toHaveProperty("complexity");
  expect(rows[0]).toHaveProperty("risk");
  expect(rows[0]).toHaveProperty("updated_at");
  expect(rows[0]).toHaveProperty("session_id");
});

// ── updateExecution() ──────────────────────────────────────────────────────────

test("updateExecution() sets tokens_used to the passed value", async () => {
  const id = uuid();
  await TaskRepo.create({ id, user_id: USER_A, session_id: SESSION_A, title: "Update Test", mode: "direct", complexity: "low", risk: "low" });

  await TaskRepo.updateExecution(id, 500);

  const row = await TaskRepo.getById(id);
  expect(row!.tokens_used).toBe(500);
  expect(row!.steps_used).toBe(1);

  // Second call replaces, does not accumulate
  await TaskRepo.updateExecution(id, 300);

  const row2 = await TaskRepo.getById(id);
  expect(row2!.tokens_used).toBe(300);
  expect(row2!.steps_used).toBe(2);
});

test("updateExecution() updates updated_at", async () => {
  const id = uuid();
  await TaskRepo.create({ id, user_id: USER_A, session_id: SESSION_A, title: "Time Test", mode: "direct", complexity: "low", risk: "low" });

  const before = (await TaskRepo.getById(id))!.updated_at;
  await TaskRepo.updateExecution(id, 1);

  const after = (await TaskRepo.getById(id))!.updated_at;
  expect(new Date(after) >= new Date(before)).toBe(true);
});

test("updateExecution() on non-existent taskId does NOT throw", async () => {
  // Real contract: UPDATE WHERE id=non-existent → 0 rows affected, no error
  await expect(TaskRepo.updateExecution(uuid(), 100)).resolves.toBeUndefined();
});

test("updateExecution() on non-existent taskId does NOT pollute DB", async () => {
  const realId = uuid();
  await TaskRepo.create({ id: realId, user_id: USER_A, session_id: SESSION_A, title: "Real", mode: "direct", complexity: "low", risk: "low" });

  await TaskRepo.updateExecution(uuid(), 100);  // non-existent

  const row = await TaskRepo.getById(realId);
  expect(row!.tokens_used).toBe(0);  // unchanged
});

// ── createTrace() ───────────────────────────────────────────────────────────────

test("createTrace() writes a trace record", async () => {
  const taskId = uuid();
  await TaskRepo.create({ id: taskId, user_id: USER_A, session_id: SESSION_A, title: "Trace Test", mode: "direct", complexity: "low", risk: "low" });
  const traceId = uuid();

  await TaskRepo.createTrace({ id: traceId, task_id: taskId, type: "loop_start", detail: null });

  const traces = await TaskRepo.getTraces(taskId);
  expect(traces).toHaveLength(1);
  expect(traces[0].trace_id).toBe(traceId);
  expect(traces[0].type).toBe("loop_start");
  expect(traces[0].created_at).toBeTruthy();
});

test("createTrace() detail JSON round-trips correctly", async () => {
  const taskId = uuid();
  await TaskRepo.create({ id: taskId, user_id: USER_A, session_id: SESSION_A, title: "JSON Test", mode: "direct", complexity: "low", risk: "low" });

  const complexDetail = {
    step: { index: 0, title: "Do it", status: "in_progress" },
    tools: ["read_file", "execute_command"],
    nested: { a: { b: { c: 1 } } },
    list: [1, 2, 3],
  };

  await TaskRepo.createTrace({ id: uuid(), task_id: taskId, type: "step_start", detail: complexDetail });

  const traces = await TaskRepo.getTraces(taskId);
  expect(traces).toHaveLength(1);
  expect(traces[0].detail).toEqual(complexDetail);
});

test("createTrace() detail null is stored and retrieved", async () => {
  const taskId = uuid();
  await TaskRepo.create({ id: taskId, user_id: USER_A, session_id: SESSION_A, title: "Null Detail", mode: "direct", complexity: "low", risk: "low" });

  await TaskRepo.createTrace({ id: uuid(), task_id: taskId, type: "loop_end", detail: null });

  const traces = await TaskRepo.getTraces(taskId);
  expect(traces[0].detail).toBeNull();
});

// ── getTraces() ────────────────────────────────────────────────────────────────

test("getTraces() orders by created_at ASC (oldest first)", async () => {
  const taskId = uuid();
  await TaskRepo.create({ id: taskId, user_id: USER_A, session_id: SESSION_A, title: "Order Test", mode: "direct", complexity: "low", risk: "low" });

  const t1 = uuid();
  const t2 = uuid();
  const t3 = uuid();
  await TaskRepo.createTrace({ id: t1, task_id: taskId, type: "step_start" });
  await TaskRepo.createTrace({ id: t2, task_id: taskId, type: "step_complete" });
  await TaskRepo.createTrace({ id: t3, task_id: taskId, type: "loop_end" });

  const traces = await TaskRepo.getTraces(taskId);
  expect(traces.map(t => t.trace_id)).toEqual([t1, t2, t3]);
});

test("getTraces() respects limit", async () => {
  const taskId = uuid();
  await TaskRepo.create({ id: taskId, user_id: USER_A, session_id: SESSION_A, title: "Limit Test", mode: "direct", complexity: "low", risk: "low" });
  await TaskRepo.createTrace({ id: uuid(), task_id: taskId, type: "step_start" });
  await TaskRepo.createTrace({ id: uuid(), task_id: taskId, type: "step_start" });
  await TaskRepo.createTrace({ id: uuid(), task_id: taskId, type: "step_start" });

  const traces = await TaskRepo.getTraces(taskId, { limit: 2 });
  expect(traces).toHaveLength(2);
});

test("getTraces() filters by type", async () => {
  const taskId = uuid();
  await TaskRepo.create({ id: taskId, user_id: USER_A, session_id: SESSION_A, title: "Type Filter", mode: "direct", complexity: "low", risk: "low" });
  await TaskRepo.createTrace({ id: uuid(), task_id: taskId, type: "error" });
  await TaskRepo.createTrace({ id: uuid(), task_id: taskId, type: "error" });
  await TaskRepo.createTrace({ id: uuid(), task_id: taskId, type: "step_start" });

  const traces = await TaskRepo.getTraces(taskId, { type: "error" });
  expect(traces).toHaveLength(2);
  expect(traces.every(t => t.type === "error")).toBe(true);
});

test("getTraces() returns empty array for non-existent task", async () => {
  const traces = await TaskRepo.getTraces(uuid());
  expect(traces).toEqual([]);
});

// ── getSummary() ──────────────────────────────────────────────────────────────

test("getSummary() returns null when no summary exists", async () => {
  const taskId = uuid();
  await TaskRepo.create({ id: taskId, user_id: USER_A, session_id: SESSION_A, title: "No Summary", mode: "direct", complexity: "low", risk: "low" });

  const summary = await TaskRepo.getSummary(taskId);
  expect(summary).toBeNull();
});

// ── Unicode / Special Characters ──────────────────────────────────────────────

test("create() handles Unicode title and goal", async () => {
  const id = uuid();
  await TaskRepo.create({
    id,
    user_id: USER_A,
    session_id: SESSION_A,
    title: "🎉 端到端测试 🚀 <script>alert('xss')</script>",
    mode: "research",
    complexity: "medium",
    risk: "high",
    goal: "验证中文和特殊字符没问题\n换行\tTab",
  });

  const row = await TaskRepo.getById(id);
  expect(row!.title).toBe("🎉 端到端测试 🚀 <script>alert('xss')</script>");
  expect(row!.goal).toBe("验证中文和特殊字符没问题\n换行\tTab");
});

// ── Cross-user isolation ──────────────────────────────────────────────────────

test("tasks for different users are completely isolated", async () => {
  const idA1 = uuid();
  const idA2 = uuid();
  const idB1 = uuid();
  await TaskRepo.create({ id: idA1, user_id: USER_A, session_id: SESSION_A, title: "A1", mode: "direct", complexity: "low", risk: "low" });
  await TaskRepo.create({ id: idA2, user_id: USER_A, session_id: SESSION_B, title: "A2", mode: "direct", complexity: "low", risk: "low" });
  await TaskRepo.create({ id: idB1, user_id: USER_B, session_id: SESSION_B, title: "B1", mode: "direct", complexity: "low", risk: "low" });

  const rowsA = await TaskRepo.list(USER_A);
  const rowsB = await TaskRepo.list(USER_B);

  expect(rowsA).toHaveLength(2);
  expect(rowsA.every(r => r.task_id !== idB1)).toBe(true);
  expect(rowsB).toHaveLength(1);
  expect(rowsB[0].task_id).toBe(idB1);
});
