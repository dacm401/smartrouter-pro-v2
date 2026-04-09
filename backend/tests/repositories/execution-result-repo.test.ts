/**
 * IT-001: ExecutionResultRepo Integration Tests
 *
 * Verifies real SQL contracts of ExecutionResultRepo against PostgreSQL.
 * No mocks — hits the actual test database (smartrouter_test).
 *
 * Isolation strategy:
 *   beforeEach → truncateTables() → commits immediately, resets all tables.
 *   Each test file runs in a fresh vitest context (--run tests/repositories/).
 *
 * Infrastructure: tests/db/harness.ts
 *   Setup:  DATABASE_URL → smartrouter_test (vitest env)
 *   Schema: CREATE TABLE IF NOT EXISTS on startup (idempotent)
 *   Isolation: beforeEach → truncateTables() → COMMIT
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ExecutionResultRepo } from "../../src/db/repositories.js";
import { truncateTables } from "../db/harness.js";
import type { ExecutionResultInput } from "../../src/types/index.js";

// ── Shared fixtures ──────────────────────────────────────────────────────────

const makeInput = (userId: string, taskId: string, overrides: Partial<ExecutionResultInput> = {}): ExecutionResultInput => ({
  task_id: taskId,
  user_id: userId,
  session_id: `session-${userId}`,
  final_content: `Content for ${taskId}`,
  steps_summary: {
    totalSteps: 3,
    completedSteps: 3,
    toolCallsExecuted: 2,
    steps: [
      { index: 0, title: "Search", type: "tool_call", status: "completed", tool_name: "web_search" },
      { index: 1, title: "Read", type: "tool_call", status: "completed", tool_name: "http_request" },
      { index: 2, title: "Synthesise", type: "synthesis", status: "completed" },
    ],
  },
  memory_entries_used: ["mem-1", "mem-2"],
  model_used: "gpt-4o",
  tool_count: 2,
  duration_ms: 1500,
  reason: "completed",
  ...overrides,
});

const UID_A = "it-user-a";
const UID_B = "it-user-b";

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(async () => {
  await truncateTables();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("ExecutionResultRepo", () => {
  describe("save()", () => {
    it("1. saves a complete record and returns it", async () => {
      const input = makeInput(UID_A, "task-1");
      const saved = await ExecutionResultRepo.save(input);
      expect(saved.id).toBeTruthy();
      expect(saved.task_id).toBe("task-1");
      expect(saved.user_id).toBe(UID_A);
      expect(saved.final_content).toBe("Content for task-1");
      expect(saved.reason).toBe("completed");
      expect(saved.created_at).toBeTruthy();
    });

    it("2. memory_entries_used defaults to [] when omitted", async () => {
      const input = makeInput(UID_A, "task-2", { memory_entries_used: undefined });
      delete (input as any).memory_entries_used;
      const saved = await ExecutionResultRepo.save(input);
      expect(saved.memory_entries_used).toEqual([]);
    });

    it("3. defaults model_used to null and duration_ms to null when omitted", async () => {
      const input = makeInput(UID_A, "task-3", {
        model_used: undefined,
        duration_ms: undefined,
      });
      const { model_used: _m, duration_ms: _d, ...rest } = input as any;
      const cleanInput = rest;
      const saved = await ExecutionResultRepo.save(cleanInput as ExecutionResultInput);
      expect(saved.model_used).toBeNull();
      expect(saved.duration_ms).toBeNull();
    });
  });

  describe("listByUser()", () => {
    it("4. returns only records belonging to the specified user", async () => {
      await ExecutionResultRepo.save(makeInput(UID_A, "task-a1"));
      await ExecutionResultRepo.save(makeInput(UID_A, "task-a2"));
      await ExecutionResultRepo.save(makeInput(UID_B, "task-b1"));

      const aResults = await ExecutionResultRepo.listByUser(UID_A);
      const bResults = await ExecutionResultRepo.listByUser(UID_B);

      expect(aResults).toHaveLength(2);
      expect(aResults.every((r) => r.user_id === UID_A)).toBe(true);
      expect(bResults).toHaveLength(1);
      expect(bResults[0].task_id).toBe("task-b1");
    });

    it("5. returns [] when user has no records", async () => {
      const results = await ExecutionResultRepo.listByUser("ghost-user");
      expect(results).toEqual([]);
    });

    it("6. orders by created_at DESC (newest first)", async () => {
      await ExecutionResultRepo.save(makeInput(UID_A, "t-first", { reason: "completed" }));
      await ExecutionResultRepo.save(makeInput(UID_A, "t-second", { reason: "completed" }));
      await ExecutionResultRepo.save(makeInput(UID_A, "t-third", { reason: "completed" }));

      const results = await ExecutionResultRepo.listByUser(UID_A);
      expect(results.map((r) => r.task_id)).toEqual(["t-third", "t-second", "t-first"]);
    });

    it("7. respects limit parameter; defaults to 20", async () => {
      await ExecutionResultRepo.save(makeInput(UID_A, "t-1", { reason: "completed" }));
      await ExecutionResultRepo.save(makeInput(UID_A, "t-2", { reason: "completed" }));
      await ExecutionResultRepo.save(makeInput(UID_A, "t-3", { reason: "completed" }));
      await ExecutionResultRepo.save(makeInput(UID_A, "t-4", { reason: "completed" }));
      await ExecutionResultRepo.save(makeInput(UID_A, "t-5", { reason: "completed" }));

      const limited = await ExecutionResultRepo.listByUser(UID_A, 3);
      expect(limited).toHaveLength(3);
      const defaultLimit = await ExecutionResultRepo.listByUser(UID_A);
      expect(defaultLimit.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe("reason field", () => {
    it("8. preserves reason field for all allowed values", async () => {
      const reasons = ["completed", "step_cap", "tool_cap", "no_progress"] as const;
      for (const reason of reasons) {
        await ExecutionResultRepo.save(makeInput(UID_A, `task-${reason}`, { reason }));
      }
      const results = await ExecutionResultRepo.listByUser(UID_A);
      const savedReasons = new Set(results.map((r) => r.reason));
      for (const reason of reasons) {
        expect(savedReasons.has(reason)).toBe(true);
      }
    });
  });

  describe("getByTaskId()", () => {
    it("9. returns the record when it exists", async () => {
      await ExecutionResultRepo.save(makeInput(UID_A, "task-get"));
      const record = await ExecutionResultRepo.getByTaskId("task-get");
      expect(record).not.toBeNull();
      expect(record!.task_id).toBe("task-get");
    });

    it("10. returns null when no record exists", async () => {
      const record = await ExecutionResultRepo.getByTaskId("nonexistent-task");
      expect(record).toBeNull();
    });
  });

  describe("data integrity", () => {
    it("11. final_content handles Unicode and special characters", async () => {
      const emoji = "🎉 Hello 世界 <script>alert('xss')</script>";
      await ExecutionResultRepo.save(makeInput(UID_A, "t-unicode", { final_content: emoji }));
      const results = await ExecutionResultRepo.listByUser(UID_A);
      const row = results.find((r) => r.task_id === "t-unicode");
      expect(row?.final_content).toBe(emoji);
    });
  });

  describe("field round-trips", () => {
    it("12. tool_count round-trips exactly (including zero and large numbers)", async () => {
      await ExecutionResultRepo.save(makeInput(UID_A, "t-zero", { tool_count: 0 }));
      await ExecutionResultRepo.save(makeInput(UID_A, "t-large", { tool_count: 99999 }));

      const records = await ExecutionResultRepo.listByUser(UID_A);
      expect(records.find((r) => r.task_id === "t-zero")?.tool_count).toBe(0);
      expect(records.find((r) => r.task_id === "t-large")?.tool_count).toBe(99999);
    });
  });

  describe("JSONB steps_summary", () => {
    it("13. steps_summary round-trips nested JSON structure correctly", async () => {
      const complex = {
        totalSteps: 5,
        completedSteps: 4,
        toolCallsExecuted: 10,
        steps: [
          { index: 0, title: "Step 1", type: "tool_call" as const, status: "completed" as const, tool_name: "read_file" },
          { index: 1, title: "Step 2", type: "reasoning" as const, status: "completed" as const },
          { index: 2, title: "Step 3", type: "synthesis" as const, status: "in_progress" as const },
          { index: 3, title: "Step 4", type: "tool_call" as const, status: "failed" as const, error: "Permission denied" },
          { index: 4, title: "Step 5", type: "tool_call" as const, status: "pending" as const, tool_name: "execute_command" },
        ],
      };
      await ExecutionResultRepo.save(makeInput(UID_A, "t-json", { steps_summary: complex }));
      const records = await ExecutionResultRepo.listByUser(UID_A);
      const row = records.find((r) => r.task_id === "t-json");
      expect(row?.steps_summary).toEqual(complex);
    });

    it("14. steps_summary handles null gracefully", async () => {
      await ExecutionResultRepo.save(makeInput(UID_A, "null-steps", { steps_summary: undefined as any }));
      const records = await ExecutionResultRepo.listByUser(UID_A);
      const row = records.find((r) => r.task_id === "null-steps");
      expect(row?.steps_summary).toBeNull();
    });
  });

  describe("TEXT[] memory_entries_used", () => {
    it("15. memory_entries_used round-trips arbitrary arrays", async () => {
      const mems = ["a", "b", "c"];
      await ExecutionResultRepo.save(makeInput(UID_A, "t-mems", { memory_entries_used: mems }));
      const records = await ExecutionResultRepo.listByUser(UID_A);
      const row = records.find((r) => r.task_id === "t-mems");
      expect(row?.memory_entries_used).toEqual(mems);
    });
  });

  describe("cross-user isolation", () => {
    it("16. User A never sees User B's data", async () => {
      await ExecutionResultRepo.save(makeInput(UID_A, "t-isol-a"));
      await ExecutionResultRepo.save(makeInput(UID_B, "t-isol-b"));

      const aResults = await ExecutionResultRepo.listByUser(UID_A);
      const bResults = await ExecutionResultRepo.listByUser(UID_B);

      expect(aResults).toHaveLength(1);
      expect(aResults[0].task_id).toBe("t-isol-a");
      expect(bResults).toHaveLength(1);
      expect(bResults[0].task_id).toBe("t-isol-b");
      expect(aResults.every((r) => r.user_id === UID_A)).toBe(true);
    });
  });
});
