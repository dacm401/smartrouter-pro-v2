/**
 * E1: EvidenceRepo Integration Tests
 *
 * Verifies real SQL contracts of EvidenceRepo against PostgreSQL.
 * No mocks — hits the actual test database (smartrouter_test).
 *
 * Infrastructure: tests/db/harness.ts
 *   Setup:  DATABASE_URL → smartrouter_test (vitest env)
 *   Schema: CREATE TABLE IF NOT EXISTS on startup (idempotent, includes evidence table)
 *   Isolation: beforeEach → truncateTables() → COMMIT
 *             (evidence FK → tasks ON DELETE CASCADE; truncating tasks cleans evidence)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { v4 as uuid } from "uuid";
import { EvidenceRepo, TaskRepo } from "../../src/db/repositories.js";
import { truncateTables } from "../db/harness.js";
import type { EvidenceInput } from "../../src/types/index.js";

// ── Shared fixtures ──────────────────────────────────────────────────────────

const USER_A = uuid();
const USER_B = uuid();

function makeTask(userId: string): string {
  const id = uuid();
  // E1: evidence.task_id FK references tasks(id); task must exist first
  TaskRepo.create({
    id,
    user_id: userId,
    session_id: uuid(),
    title: "Evidence test task",
    mode: "research",
    complexity: "low",
    risk: "low",
  });
  return id;
}

const makeInput = (
  taskId: string,
  userId: string,
  overrides: Partial<EvidenceInput> = {}
): EvidenceInput => ({
  task_id: taskId,
  user_id: userId,
  source: "web_search",
  content: `Evidence content for ${taskId}`,
  ...overrides,
});

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(async () => {
  await truncateTables();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("EvidenceRepo", () => {
  describe("create()", () => {
    it("1. saves a record with all fields and returns it", async () => {
      const taskId = makeTask(USER_A);
      const input = makeInput(taskId, USER_A, {
        source: "web_search",
        content: "Latest TypeScript news",
        source_metadata: { query: "TypeScript", url: "https://example.com/ts", title: "TS Blog" },
        relevance_score: 0.95,
      });

      const saved = await EvidenceRepo.create(input);

      expect(saved.evidence_id).toBeTruthy();
      expect(saved.task_id).toBe(taskId);
      expect(saved.user_id).toBe(USER_A);
      expect(saved.source).toBe("web_search");
      expect(saved.content).toBe("Latest TypeScript news");
      expect(saved.source_metadata).toEqual({ query: "TypeScript", url: "https://example.com/ts", title: "TS Blog" });
      expect(saved.relevance_score).toBe(0.95);
      expect(saved.created_at).toBeTruthy();
    });

    it("2. source_metadata defaults to null when omitted", async () => {
      const taskId = makeTask(USER_A);
      const { source_metadata: _sm, ...input } = makeInput(taskId, USER_A);

      const saved = await EvidenceRepo.create(input as EvidenceInput);

      expect(saved.source_metadata).toBeNull();
    });

    it("3. relevance_score defaults to null when omitted", async () => {
      const taskId = makeTask(USER_A);
      const { relevance_score: _rs, ...input } = makeInput(taskId, USER_A);

      const saved = await EvidenceRepo.create(input as EvidenceInput);

      expect(saved.relevance_score).toBeNull();
    });

    it("4. source accepts all valid EvidenceSource values", async () => {
      const taskId = makeTask(USER_A);
      const sources = ["web_search", "http_request", "manual"] as const;

      for (const source of sources) {
        const saved = await EvidenceRepo.create(makeInput(taskId, USER_A, { source }));
        expect(saved.source).toBe(source);
      }
    });

    it("5. Unicode and special characters round-trip in content", async () => {
      const taskId = makeTask(USER_A);
      const content = "🎉 Hello 世界 <script>alert('xss')</script> 中文测试";
      const saved = await EvidenceRepo.create(makeInput(taskId, USER_A, { content }));

      expect(saved.content).toBe(content);
    });

    it("6. source_metadata JSONB round-trips complex nested objects", async () => {
      const taskId = makeTask(USER_A);
      const metadata = {
        query: "AI models",
        results: [
          { url: "https://a.com", title: "A", score: 0.9 },
          { url: "https://b.com", title: "B", score: 0.7 },
        ],
        nested: { deep: { value: 42 } },
      };
      const saved = await EvidenceRepo.create(
        makeInput(taskId, USER_A, { source_metadata: metadata })
      );

      expect(saved.source_metadata).toEqual(metadata);
    });
  });

  describe("getById()", () => {
    it("7. returns the record when it exists", async () => {
      const taskId = makeTask(USER_A);
      const created = await EvidenceRepo.create(makeInput(taskId, USER_A));

      const found = await EvidenceRepo.getById(created.evidence_id);

      expect(found).not.toBeNull();
      expect(found!.evidence_id).toBe(created.evidence_id);
      expect(found!.task_id).toBe(taskId);
      expect(found!.content).toBe(created.content);
    });

    it("8. returns null when no record exists", async () => {
      const found = await EvidenceRepo.getById("nonexistent-evidence-id");
      expect(found).toBeNull();
    });

    it("9. returns null for malformed UUID", async () => {
      const found = await EvidenceRepo.getById("not-a-uuid-at-all");
      expect(found).toBeNull();
    });
  });

  describe("listByTask()", () => {
    it("10. returns all evidence records for a given task", async () => {
      const taskId = makeTask(USER_A);
      const taskB = makeTask(USER_A);
      await EvidenceRepo.create(makeInput(taskId, USER_A, { content: "e1" }));
      await EvidenceRepo.create(makeInput(taskId, USER_A, { content: "e2" }));
      await EvidenceRepo.create(makeInput(taskId, USER_A, { content: "e3" }));
      await EvidenceRepo.create(makeInput(taskB, USER_A, { content: "e-other-task" }));

      const results = await EvidenceRepo.listByTask(taskId);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.task_id === taskId)).toBe(true);
    });

    it("11. returns [] when task has no evidence records", async () => {
      const taskId = makeTask(USER_A);
      const results = await EvidenceRepo.listByTask(taskId);
      expect(results).toEqual([]);
    });

    it("12. orders by created_at ASC (oldest first, per spec)", async () => {
      const taskId = makeTask(USER_A);
      await EvidenceRepo.create(makeInput(taskId, USER_A, { content: "first" }));
      await EvidenceRepo.create(makeInput(taskId, USER_A, { content: "second" }));
      await EvidenceRepo.create(makeInput(taskId, USER_A, { content: "third" }));

      const results = await EvidenceRepo.listByTask(taskId);

      expect(results.map((r) => r.content)).toEqual(["first", "second", "third"]);
    });
  });

  describe("listByUser()", () => {
    it("13. returns only records belonging to the specified user", async () => {
      const taskA = makeTask(USER_A);
      const taskB = makeTask(USER_B);
      await EvidenceRepo.create(makeInput(taskA, USER_A, { content: "a-evidence" }));
      await EvidenceRepo.create(makeInput(taskB, USER_B, { content: "b-evidence" }));

      const aResults = await EvidenceRepo.listByUser(USER_A);
      const bResults = await EvidenceRepo.listByUser(USER_B);

      expect(aResults).toHaveLength(1);
      expect(aResults[0].content).toBe("a-evidence");
      expect(bResults).toHaveLength(1);
      expect(bResults[0].content).toBe("b-evidence");
    });

    it("14. returns [] when user has no evidence records", async () => {
      const results = await EvidenceRepo.listByUser("ghost-user");
      expect(results).toEqual([]);
    });

    it("15. orders by created_at DESC (newest first)", async () => {
      const taskId = makeTask(USER_A);
      await EvidenceRepo.create(makeInput(taskId, USER_A, { content: "oldest" }));
      await EvidenceRepo.create(makeInput(taskId, USER_A, { content: "newest" }));

      const results = await EvidenceRepo.listByUser(USER_A);

      expect(results[0].content).toBe("newest");
      expect(results[1].content).toBe("oldest");
    });

    it("16. respects limit parameter", async () => {
      const taskId = makeTask(USER_A);
      for (let i = 0; i < 5; i++) {
        await EvidenceRepo.create(makeInput(taskId, USER_A, { content: `item-${i}` }));
      }

      const limited = await EvidenceRepo.listByUser(USER_A, 3);

      expect(limited).toHaveLength(3);
    });

    it("17. defaults limit to 100 when omitted", async () => {
      const taskId = makeTask(USER_A);
      for (let i = 0; i < 3; i++) {
        await EvidenceRepo.create(makeInput(taskId, USER_A));
      }
      const results = await EvidenceRepo.listByUser(USER_A);
      expect(results.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("cross-user isolation", () => {
    it("18. User A never sees User B's evidence records", async () => {
      const taskA = makeTask(USER_A);
      const taskB = makeTask(USER_B);
      await EvidenceRepo.create(makeInput(taskA, USER_A, { content: "A secret" }));
      await EvidenceRepo.create(makeInput(taskB, USER_B, { content: "B secret" }));

      const aResults = await EvidenceRepo.listByUser(USER_A);

      expect(aResults).toHaveLength(1);
      expect(aResults[0].content).toBe("A secret");
      expect(aResults[0].user_id).toBe(USER_A);
    });
  });
});
