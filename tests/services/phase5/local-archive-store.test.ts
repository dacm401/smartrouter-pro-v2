/**
 * Phase 5 LocalArchiveStore 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, readdirSync } from "fs";
import { join } from "path";
import { LocalArchiveStore, createArchiveStore } from "../../../src/services/phase5/index.js";

const TEST_BASE_PATH = join(process.cwd(), "test-data", "archive-store");

describe("LocalArchiveStore", () => {
  let store: LocalArchiveStore;

  beforeEach(() => {
    // 清理测试目录
    if (existsSync(TEST_BASE_PATH)) {
      rmSync(TEST_BASE_PATH, { recursive: true, force: true });
    }
    mkdirSync(TEST_BASE_PATH, { recursive: true });

    store = new LocalArchiveStore({
      basePath: TEST_BASE_PATH,
      maxFileSize: 1024 * 1024, // 1MB for testing
      compress: false,
    });
  });

  afterEach(() => {
    // 清理测试目录
    if (existsSync(TEST_BASE_PATH)) {
      rmSync(TEST_BASE_PATH, { recursive: true, force: true });
    }
  });

  describe("基本功能", () => {
    it("应该正确实例化", () => {
      expect(store).toBeDefined();
    });

    it("应该在目录不存在时创建", () => {
      const customPath = join(TEST_BASE_PATH, "nested", "path");
      const customStore = new LocalArchiveStore({ basePath: customPath });

      expect(existsSync(customPath)).toBe(true);
    });
  });

  describe("创建 Archive", () => {
    it("应该创建新的 Archive 记录", async () => {
      const result = await store.create({
        session_id: "session-1",
        user_id: "user-1",
        decision: { type: "direct_answer" },
        user_input: "Hello, world!",
        task_brief: "Test task",
        goal: "Test goal",
      });

      expect(result.id).toBeDefined();
      expect(result.id.length).toBeGreaterThan(0);
    });

    it("应该生成有效的 UUID", async () => {
      const result = await store.create({
        session_id: "session-1",
        user_id: "user-1",
        decision: { type: "direct_answer" },
        user_input: "Test",
      });

      // UUID 格式验证
      expect(result.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it("应该正确保存决策信息", async () => {
      const createResult = await store.create({
        session_id: "session-1",
        user_id: "user-1",
        decision: { type: "delegate_to_slow", command: { tool: "search" } },
        user_input: "Search for information",
        task_brief: "Search task",
      });

      const doc = await store.getById(createResult.id);

      expect(doc).toBeDefined();
      expect(doc!.session_id).toBe("session-1");
      expect(doc!.user_id).toBe("user-1");
      expect(doc!.manager_decision).toEqual({ type: "delegate_to_slow", command: { tool: "search" } });
      expect(doc!.user_input).toBe("Search for information");
    });
  });

  describe("读取 Archive", () => {
    it("应该通过 ID 获取 Archive", async () => {
      const createResult = await store.create({
        session_id: "session-1",
        user_id: "user-1",
        decision: { type: "direct_answer" },
        user_input: "Test",
      });

      const doc = await store.getById(createResult.id);

      expect(doc).toBeDefined();
      expect(doc!.id).toBe(createResult.id);
    });

    it("应该获取不存在的 Archive 返回 null", async () => {
      const doc = await store.getById("non-existent-id");

      expect(doc).toBeNull();
    });

    it("应该获取 session 的最新 Archive", async () => {
      // 创建多个 Archive
      await store.create({
        session_id: "session-1",
        user_id: "user-1",
        decision: { type: "direct_answer" },
        user_input: "First",
      });

      // 等待一点时间确保时间戳不同
      await new Promise((r) => setTimeout(r, 10));

      await store.create({
        session_id: "session-1",
        user_id: "user-1",
        decision: { type: "delegate_to_slow" },
        user_input: "Second",
      });

      const latest = await store.getBySession("session-1", "user-1");

      expect(latest).toBeDefined();
      expect(latest!.user_input).toBe("Second");
    });

    it("应该列出 session 的所有 Archive", async () => {
      await store.create({
        session_id: "session-1",
        user_id: "user-1",
        decision: { type: "direct_answer" },
        user_input: "First",
      });

      await store.create({
        session_id: "session-1",
        user_id: "user-1",
        decision: { type: "delegate_to_slow" },
        user_input: "Second",
      });

      const docs = await store.listBySession("session-1", "user-1");

      expect(docs.length).toBe(2);
    });

    it("应该返回空列表当没有 Archive 时", async () => {
      const docs = await store.listBySession("non-existent", "user-1");

      expect(docs).toEqual([]);
    });
  });

  describe("更新 Archive", () => {
    it("应该更新 Archive 字段", async () => {
      const createResult = await store.create({
        session_id: "session-1",
        user_id: "user-1",
        decision: { type: "direct_answer" },
        user_input: "Test",
      });

      const updated = await store.update(createResult.id, {
        state: "completed",
        status: "done",
      });

      expect(updated).toBe(true);

      const doc = await store.getById(createResult.id);
      expect(doc!.state).toBe("completed");
      expect(doc!.status).toBe("done");
    });

    it("应该更新不存在的 Archive 返回 false", async () => {
      const updated = await store.update("non-existent", { state: "done" });

      expect(updated).toBe(false);
    });

    it("应该更新命令状态", async () => {
      const createResult = await store.create({
        session_id: "session-1",
        user_id: "user-1",
        decision: { type: "delegate_to_slow" },
        user_input: "Test",
      });

      const updated = await store.updateCommandStatus(
        createResult.id,
        "completed",
        { result: "success" }
      );

      expect(updated).toBe(true);

      const doc = await store.getById(createResult.id);
      expect(doc!.status).toBe("completed");
      expect(doc!.slow_execution).toEqual({ result: "success" });
    });
  });

  describe("删除 Archive", () => {
    it("应该删除 Archive", async () => {
      const createResult = await store.create({
        session_id: "session-1",
        user_id: "user-1",
        decision: { type: "direct_answer" },
        user_input: "Test",
      });

      const deleted = await store.delete(createResult.id);

      expect(deleted).toBe(true);

      const doc = await store.getById(createResult.id);
      expect(doc).toBeNull();
    });

    it("应该删除不存在的 Archive 返回 false", async () => {
      const deleted = await store.delete("non-existent");

      expect(deleted).toBe(false);
    });
  });

  describe("目录结构", () => {
    it("应该按 userId/sessionId 组织目录", async () => {
      await store.create({
        session_id: "session-1",
        user_id: "user-1",
        decision: { type: "direct_answer" },
        user_input: "Test",
      });

      const expectedPath = join(TEST_BASE_PATH, "user-1", "session-1");
      expect(existsSync(expectedPath)).toBe(true);

      const files = readdirSync(expectedPath).filter((f) => f.endsWith(".json"));
      expect(files.length).toBe(1);
    });

    it("应该为不同用户创建独立目录", async () => {
      await store.create({
        session_id: "session-1",
        user_id: "user-1",
        decision: { type: "direct_answer" },
        user_input: "User 1 data",
      });

      await store.create({
        session_id: "session-1",
        user_id: "user-2",
        decision: { type: "direct_answer" },
        user_input: "User 2 data",
      });

      expect(existsSync(join(TEST_BASE_PATH, "user-1"))).toBe(true);
      expect(existsSync(join(TEST_BASE_PATH, "user-2"))).toBe(true);

      const user1Doc = await store.getBySession("session-1", "user-1");
      const user2Doc = await store.getBySession("session-1", "user-2");

      expect(user1Doc!.user_input).toBe("User 1 data");
      expect(user2Doc!.user_input).toBe("User 2 data");
    });
  });

  describe("数据完整性", () => {
    it("应该包含创建和更新时间戳", async () => {
      const createResult = await store.create({
        session_id: "session-1",
        user_id: "user-1",
        decision: { type: "direct_answer" },
        user_input: "Test",
      });

      const doc = await store.getById(createResult.id);

      expect(doc!.created_at).toBeDefined();
      expect(doc!.updated_at).toBeDefined();
      expect(doc!.created_at).toBe(doc!.updated_at);
    });

    it("应该在更新时更新 updated_at", async () => {
      const createResult = await store.create({
        session_id: "session-1",
        user_id: "user-1",
        decision: { type: "direct_answer" },
        user_input: "Test",
      });

      const doc = await store.getById(createResult.id);
      const originalUpdatedAt = doc!.updated_at;

      // 等待一点时间
      await new Promise((r) => setTimeout(r, 10));

      await store.update(createResult.id, { state: "completed" });

      const updatedDoc = await store.getById(createResult.id);
      expect(updatedDoc!.updated_at).not.toBe(originalUpdatedAt);
    });

    it("应该保留原始字段不被覆盖", async () => {
      const createResult = await store.create({
        session_id: "session-1",
        user_id: "user-1",
        decision: { type: "direct_answer" },
        user_input: "Test input",
        task_brief: "Brief",
        goal: "Goal",
      });

      await store.update(createResult.id, { state: "done" });

      const doc = await store.getById(createResult.id);

      expect(doc!.user_input).toBe("Test input");
      expect(doc!.task_brief).toBe("Brief");
      expect(doc!.goal).toBe("Goal");
      expect(doc!.manager_decision).toEqual({ type: "direct_answer" });
    });
  });

  describe("错误处理", () => {
    it("应该处理无效的 JSON 文件", async () => {
      // 手动创建一个无效的 JSON 文件
      const testPath = join(TEST_BASE_PATH, "user-1", "session-1");
      mkdirSync(testPath, { recursive: true });
      const { writeFileSync } = require("fs");
      writeFileSync(join(testPath, "invalid.json"), "not valid json{");

      const doc = await store.getBySession("session-1", "user-1");

      // 应该跳过无效文件并返回 null
      expect(doc).toBeNull();
    });
  });
});

describe("ArchiveStore Factory", () => {
  it("应该为 local 类型创建 LocalArchiveStore", () => {
    const store = createArchiveStore("local");

    expect(store).toBeInstanceOf(LocalArchiveStore);
  });

  it("应该为未知类型抛出错误", () => {
    expect(() => {
      createArchiveStore("unknown" as any);
    }).toThrow();
  });
});
