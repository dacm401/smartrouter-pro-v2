/**
 * Phase 5 — PGArchiveStorage 单元测试
 *
 * 使用 mock DB connection 测试 PGArchiveStorage 的 CRUD 行为。
 * PGArchiveQuery 语义搜索的 mock 测试也在此文件。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PGArchiveStorage, PGArchiveQuery } from "../../../src/services/phase5/pg-archive-storage.js";

// ── Mock query ───────────────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock("../../../src/db/connection.js", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// ── Test Helpers ─────────────────────────────────────────────────────────────

function makeDoc(overrides: Record<string, unknown> = {}) {
  const id = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id,
    task_id: "task-001",
    session_id: "session-001",
    user_id: "user-001",
    manager_decision: { type: "delegate_to_slow" },
    command: { tool: "web_search" },
    user_input: "查询天气",
    task_brief: "Weather query",
    goal: "Get weather",
    state: "delegated",
    status: "pending",
    constraints: {},
    fast_observations: [],
    slow_execution: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as import("../../../src/services/phase5/storage-backend.js").ArchiveDocument;
}

function pgRow(doc: Record<string, unknown>): Record<string, unknown> {
  return {
    id: doc.id,
    task_id: doc.task_id ?? null,
    session_id: doc.session_id,
    user_id: doc.user_id,
    manager_decision: JSON.stringify(doc.manager_decision),
    command: doc.command ? JSON.stringify(doc.command) : null,
    user_input: doc.user_input,
    task_brief: doc.task_brief ?? null,
    goal: doc.goal ?? null,
    state: doc.state,
    status: doc.status,
    constraints: JSON.stringify(doc.constraints ?? {}),
    fast_observations: JSON.stringify(doc.fast_observations ?? []),
    slow_execution: JSON.stringify(doc.slow_execution ?? {}),
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  };
}

// ── PGArchiveStorage Tests ────────────────────────────────────────────────────

describe("PGArchiveStorage", () => {
  let store: PGArchiveStorage;

  beforeEach(() => {
    mockQuery.mockReset();
    store = new PGArchiveStorage();
  });

  describe("save()", () => {
    it("calls INSERT with correct parameters", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      const doc = makeDoc();
      await store.save(doc);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("INSERT INTO task_archives");
      expect(params[0]).toBe(doc.id);
      expect(params[6]).toBe(doc.user_input);
    });
  });

  describe("getById()", () => {
    it("returns null when no row found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const result = await store.getById("non-existent");
      expect(result).toBeNull();
    });

    it("parses row correctly", async () => {
      const doc = makeDoc();
      mockQuery.mockResolvedValueOnce({ rows: [pgRow(doc)], rowCount: 1 });
      const result = await store.getById(doc.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(doc.id);
      expect(result!.user_input).toBe(doc.user_input);
      expect(result!.manager_decision).toEqual(doc.manager_decision);
    });

    it("handles JSON fields correctly", async () => {
      const doc = makeDoc({ constraints: { lang: "zh" }, fast_observations: [{ step: 1 }] });
      mockQuery.mockResolvedValueOnce({ rows: [pgRow(doc)], rowCount: 1 });
      const result = await store.getById(doc.id);
      expect(result!.constraints).toEqual({ lang: "zh" });
      expect(result!.fast_observations).toEqual([{ step: 1 }]);
    });
  });

  describe("getBySession()", () => {
    it("returns null when no row found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const result = await store.getBySession("no-such-session", "no-such-user");
      expect(result).toBeNull();
    });

    it("returns the latest document", async () => {
      const doc = makeDoc();
      mockQuery.mockResolvedValueOnce({ rows: [pgRow(doc)], rowCount: 1 });
      const result = await store.getBySession("session-001", "user-001");
      expect(result).not.toBeNull();
      expect(result!.id).toBe(doc.id);
    });
  });

  describe("update()", () => {
    it("returns false when no rows affected", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const result = await store.update("non-existent", { status: "completed" });
      expect(result).toBe(false);
    });

    it("returns true and calls UPDATE on success", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      const result = await store.update("doc-1", { status: "completed" });
      expect(result).toBe(true);
      const [sql] = mockQuery.mock.calls[0] as [string];
      expect(sql).toContain("UPDATE task_archives");
    });

    it("maps JSON fields correctly in update", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      await store.update("doc-1", {
        constraints: { updated: true },
        fast_observations: [{ note: "test" }],
      });
      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      // JSON fields should be stringified
      expect(params.some((p) => typeof p === "string")).toBe(true);
    });

    it("returns false when no fields to update", async () => {
      const result = await store.update("doc-1", {});
      expect(result).toBe(false);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe("delete()", () => {
    it("returns false when no rows affected", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const result = await store.delete("non-existent");
      expect(result).toBe(false);
    });

    it("returns true on successful delete", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      const result = await store.delete("doc-1");
      expect(result).toBe(true);
    });
  });

  describe("listBySession()", () => {
    it("returns empty array when no rows found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const result = await store.listBySession("no-such-session", "no-such-user");
      expect(result).toEqual([]);
    });

    it("maps all rows to ArchiveDocument", async () => {
      const doc1 = makeDoc({ id: "doc-1" });
      const doc2 = makeDoc({ id: "doc-2" });
      mockQuery.mockResolvedValueOnce({ rows: [pgRow(doc1), pgRow(doc2)], rowCount: 2 });
      const result = await store.listBySession("session-001", "user-001");
      expect(result.length).toBe(2);
      expect(result[0].id).toBe("doc-1");
      expect(result[1].id).toBe("doc-2");
    });
  });

  describe("ping()", () => {
    it("returns true on successful query", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{}], rowCount: 1 });
      const result = await store.ping();
      expect(result).toBe(true);
    });

    it("returns false on query error", async () => {
      mockQuery.mockRejectedValueOnce(new Error("DB error"));
      const result = await store.ping();
      expect(result).toBe(false);
    });
  });
});

// ── PGArchiveQuery Tests ──────────────────────────────────────────────────────

describe("PGArchiveQuery", () => {
  let query: PGArchiveQuery;

  beforeEach(() => {
    mockQuery.mockReset();
    query = new PGArchiveQuery();
  });

  describe("searchByEmbedding()", () => {
    it("calls SELECT with cosine similarity", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await query.searchByEmbedding("user-001", [0.1, 0.2, 0.3]);
      const [sql] = mockQuery.mock.calls[0] as [string];
      expect(sql).toContain("<=>");
      expect(sql).toContain("task_archives");
    });

    it("returns empty array when pgvector is not installed", async () => {
      mockQuery.mockRejectedValueOnce(new Error("function embedding does not exist"));
      const result = await query.searchByEmbedding("user-001", [0.1, 0.2, 0.3]);
      expect(result).toEqual([]);
    });

    it("returns results with similarity scores", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "doc-1",
            session_id: "s1",
            user_id: "u1",
            user_input: "test query",
            task_brief: null,
            state: "done",
            created_at: "2026-04-01T00:00:00Z",
            updated_at: "2026-04-01T00:00:00Z",
            similarity: 0.85,
          },
        ],
        rowCount: 1,
      });
      const result = await query.searchByEmbedding("user-001", [0.1, 0.2, 0.3]);
      expect(result.length).toBe(1);
      expect(result[0].archiveId).toBe("doc-1");
      expect(result[0].similarity).toBe(0.85);
    });

    it("applies filters correctly", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await query.searchByEmbedding("user-001", [0.1, 0.2], 5, {
        sessionId: "session-001",
        taskType: "analysis",
        state: "completed",
        fromDate: "2026-01-01",
        toDate: "2026-12-31",
      });
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("session_id = $2");
      expect(sql).toContain("task_brief LIKE $3");
      expect(sql).toContain("state = $4");
      expect(sql).toContain("created_at >= $5");
      expect(sql).toContain("created_at <= $6");
    });
  });

  describe("searchByKeyword()", () => {
    it("uses ILIKE for case-insensitive search", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await query.searchByKeyword("user-001", "weather");
      const [sql] = mockQuery.mock.calls[0] as [string];
      expect(sql).toContain("ILIKE $2");
      expect(sql).toContain("user_input");
      expect(sql).toContain("task_brief");
      expect(sql).toContain("goal");
    });

    it("returns results with highlight", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "doc-1",
            session_id: "s1",
            user_id: "u1",
            user_input: "weather today",
            task_brief: null,
            state: "done",
            created_at: "2026-04-01T00:00:00Z",
            updated_at: "2026-04-01T00:00:00Z",
          },
        ],
        rowCount: 1,
      });
      const result = await query.searchByKeyword("user-001", "weather");
      expect(result.length).toBe(1);
      expect(result[0].highlight).toContain("<mark>weather</mark>");
    });

    it("respects limit parameter", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await query.searchByKeyword("user-001", "test", 5);
      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(params[2]).toBe(5);
    });
  });
});
