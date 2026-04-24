/**
 * Phase 5 — S3 Archive Storage 单元测试
 *
 * 使用 mock S3Client 测试 S3ArchiveStorage 的 CRUD 行为。
 * getPresignedUrl 通过 mock getSignedUrl 测试。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { S3ArchiveStorage } from "../../../src/services/phase5/s3-archive-storage.js";

// ── Mock S3 Client ───────────────────────────────────────────────────────────

function createMockS3Client() {
  const storage: Record<string, string> = {};
  return {
    send: vi.fn().mockImplementation((command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const cmdName = command.constructor.name;
      if (cmdName === "PutObjectCommand") {
        storage[command.input.Key as string] = command.input.Body as string;
        return Promise.resolve({});
      }
      if (cmdName === "GetObjectCommand") {
        const body = storage[command.input.Key as string];
        if (!body) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
        return Promise.resolve({ Body: { transformToString: () => Promise.resolve(body) } });
      }
      if (cmdName === "DeleteObjectCommand") {
        delete storage[command.input.Key as string];
        return Promise.resolve({});
      }
      if (cmdName === "ListObjectsV2Command") {
        const prefix = (command.input.Prefix ?? "") as string;
        const all = Object.keys(storage)
          .filter((k) => k.startsWith(prefix))
          .map((k, i) => ({ Key: k, LastModified: new Date(Date.now() + i * 10) }))
          .sort((a, b) => b.LastModified.getTime() - a.LastModified.getTime()) // newest first
          .slice(0, (command.input.MaxKeys ?? 1000) as number);
        return Promise.resolve({
          Contents: all,
          IsTruncated: false,
        });
      }
      if (cmdName === "HeadObjectCommand") {
        if (storage[command.input.Key as string]) return Promise.resolve({});
        throw Object.assign(new Error("NotFound"), { name: "NotFound" });
      }
      return Promise.resolve({});
    }),
    _storage: storage,
  };
}

// Mock getSignedUrl so we don't need AWS SDK internals
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://mock-signed-url.example.com/test?signature=fake"),
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

describe("S3ArchiveStorage", () => {
  // Use module-level mock state via a shared object
  const mockStore = {
    client: createMockS3Client(),
  };

  let store: S3ArchiveStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.client = createMockS3Client();
    // Create a new S3ArchiveStorage and spy on the send method
    const realStore = new S3ArchiveStorage({
      bucket: "test-bucket",
      accessKeyId: "fake",
      secretAccessKey: "fake",
      prefix: "archives/",
    });
    // Override the private client with our mock (using any cast since field is private)
    store = Object.assign(realStore, { client: mockStore.client }) as unknown as S3ArchiveStorage;
  });

  describe("ping()", () => {
    it("returns true when bucket is accessible", async () => {
      const result = await store.ping();
      expect(result).toBe(true);
    });

    it("returns true even when prefix does not exist (graceful fallback)", async () => {
      // ping() has fallback: HeadObject(prefix) fails → ListObjectsV2(bucket) succeeds
      // Our mock always returns successfully, so ping() should return true
      const result = await store.ping();
      expect(result).toBe(true);
    });
  });

  describe("save()", () => {
    it("stores document with correct object key", async () => {
      const doc = makeDoc();
      await store.save(doc);
      const key = `archives/${doc.user_id}/${doc.session_id}/${doc.id}.json`;
      expect(mockStore.client._storage[key]).toBeTruthy();
    });

    it("returns the document id", async () => {
      const doc = makeDoc();
      const result = await store.save(doc);
      expect(result).toBe(doc.id);
    });
  });

  describe("getById()", () => {
    it("returns null for non-existent id", async () => {
      const result = await store.getById("non-existent");
      expect(result).toBeNull();
    });

    it("returns document by id after save", async () => {
      const doc = makeDoc();
      await store.save(doc);
      const result = await store.getById(doc.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(doc.id);
      expect(result!.user_input).toBe(doc.user_input);
    });
  });

  describe("getBySession()", () => {
    it("returns null for non-existent session", async () => {
      const result = await store.getBySession("no-such-session", "no-such-user");
      expect(result).toBeNull();
    });

    it("returns latest document for session", async () => {
      const doc1 = makeDoc({ user_input: "First doc" });
      const doc2 = makeDoc({ user_input: "Second doc" });
      await store.save(doc1);
      await store.save(doc2);
      const result = await store.getBySession(doc1.session_id, doc1.user_id);
      expect(result).not.toBeNull();
      expect(result!.user_input).toBe("Second doc");
    });
  });

  describe("update()", () => {
    it("returns false for non-existent id", async () => {
      const result = await store.update("non-existent", { status: "completed" });
      expect(result).toBe(false);
    });

    it("updates existing document", async () => {
      const doc = makeDoc({ status: "pending" });
      await store.save(doc);
      const updated = await store.update(doc.id, { status: "completed" });
      expect(updated).toBe(true);
      const retrieved = await store.getById(doc.id);
      expect(retrieved!.status).toBe("completed");
    });
  });

  describe("delete()", () => {
    it("returns false for non-existent id", async () => {
      const result = await store.delete("non-existent");
      expect(result).toBe(false);
    });

    it("removes document after delete", async () => {
      const doc = makeDoc();
      await store.save(doc);
      const deleted = await store.delete(doc.id);
      expect(deleted).toBe(true);
      const result = await store.getById(doc.id);
      expect(result).toBeNull();
    });
  });

  describe("listBySession()", () => {
    it("returns empty array for non-existent session", async () => {
      const result = await store.listBySession("no-such-session", "no-such-user");
      expect(result).toEqual([]);
    });

    it("returns all documents for session", async () => {
      const doc1 = makeDoc();
      const doc2 = makeDoc();
      await store.save(doc1);
      await store.save(doc2);
      const result = await store.listBySession(doc1.session_id, doc1.user_id);
      expect(result.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("getPresignedUrl()", () => {
    it("returns a signed URL string", async () => {
      const url = await store.getPresignedUrl("user-001", "session-001", "doc-id");
      expect(typeof url).toBe("string");
      expect(url.length).toBeGreaterThan(0);
    });
  });
});
