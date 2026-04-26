/**
 * Sprint 64 — Permission Manager 单元测试
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  classifyField,
  DataPermissionLevel,
  buildWorkerContextPrompt,
  buildPermissionRequestPrompt,
  type FilteredContext,
} from "../../src/services/permission-manager.js";
import type { PermissionRequestRecord } from "../../src/db/repositories.js";

// ── classifyField ─────────────────────────────────────────────────────────────

describe("classifyField", () => {
  it("BLOCKED: password 字段", () => {
    const cls = classifyField("password", "secret123");
    expect(cls.level).toBe(DataPermissionLevel.BLOCKED);
  });

  it("BLOCKED: api_key 字段", () => {
    const cls = classifyField("api_key", "sk-xxx");
    expect(cls.level).toBe(DataPermissionLevel.BLOCKED);
  });

  it("BLOCKED: private_key 字段", () => {
    const cls = classifyField("private_key", "pem...");
    expect(cls.level).toBe(DataPermissionLevel.BLOCKED);
  });

  it("BLOCKED: id_card 字段", () => {
    const cls = classifyField("id_card", "440101199001011234");
    expect(cls.level).toBe(DataPermissionLevel.BLOCKED);
  });

  it("IMPORTANT: phone 字段，含脱敏预览", () => {
    const cls = classifyField("phone", "13812345678");
    expect(cls.level).toBe(DataPermissionLevel.IMPORTANT);
    expect(cls.maskedPreview).toBeDefined();
    expect(cls.maskedPreview).not.toBe("13812345678"); // 必须脱敏
  });

  it("IMPORTANT: email 字段", () => {
    const cls = classifyField("email", "user@example.com");
    expect(cls.level).toBe(DataPermissionLevel.IMPORTANT);
  });

  it("IMPORTANT: name 字段", () => {
    const cls = classifyField("name", "张三");
    expect(cls.level).toBe(DataPermissionLevel.IMPORTANT);
  });

  it("IMPORTANT: address 字段", () => {
    const cls = classifyField("address", "深圳市南山区");
    expect(cls.level).toBe(DataPermissionLevel.IMPORTANT);
  });

  it("NECESSARY: 普通任务字段", () => {
    const cls = classifyField("destination", "东京");
    expect(cls.level).toBe(DataPermissionLevel.NECESSARY);
  });

  it("NECESSARY: 预算字段", () => {
    const cls = classifyField("budget", "5000");
    expect(cls.level).toBe(DataPermissionLevel.NECESSARY);
  });

  it("NECESSARY: 日期字段", () => {
    const cls = classifyField("travel_date", "2026-05-01");
    expect(cls.level).toBe(DataPermissionLevel.NECESSARY);
  });
});

// ── buildWorkerContextPrompt ──────────────────────────────────────────────────

describe("buildWorkerContextPrompt", () => {
  const base: FilteredContext = {
    allowed: { destination: "东京", budget: "5000 CNY" },
    blocked: ["password", "id_card"],
    pendingApproval: [{ key: "phone", requestId: "req-001" }],
  };

  it("包含任务目标", () => {
    const prompt = buildWorkerContextPrompt(base, "安排日本五日游");
    expect(prompt).toContain("安排日本五日游");
  });

  it("包含 allowed 字段", () => {
    const prompt = buildWorkerContextPrompt(base, "任务");
    expect(prompt).toContain("destination");
    expect(prompt).toContain("东京");
    expect(prompt).toContain("budget");
  });

  it("blocked 字段有提示但不含原始值", () => {
    const prompt = buildWorkerContextPrompt(base, "任务");
    expect(prompt).toContain("password");
    expect(prompt).toContain("id_card");
    expect(prompt).not.toContain("secret123");
  });

  it("pendingApproval 字段有等待提示", () => {
    const prompt = buildWorkerContextPrompt(base, "任务");
    expect(prompt).toContain("phone");
    expect(prompt).toContain("待确认");
  });

  it("无 blocked/pending 时不出现相关段落", () => {
    const clean: FilteredContext = {
      allowed: { destination: "上海" },
      blocked: [],
      pendingApproval: [],
    };
    const prompt = buildWorkerContextPrompt(clean, "任务");
    expect(prompt).not.toContain("被安全策略屏蔽");
    expect(prompt).not.toContain("待确认");
  });
});

// ── buildPermissionRequestPrompt ─────────────────────────────────────────────

describe("buildPermissionRequestPrompt", () => {
  it("空请求列表返回空字符串", () => {
    expect(buildPermissionRequestPrompt([])).toBe("");
  });

  it("包含字段名和用途", () => {
    const fakeReq: PermissionRequestRecord = {
      id: "aabbccdd-1234-5678-abcd-ef0123456789",
      task_id: "t1",
      worker_id: "w1",
      user_id: "u1",
      session_id: "s1",
      field_name: "手机号",
      field_key: "phone",
      purpose: "注册旅行账号",
      value_preview: "138****5678",
      status: "pending",
      expires_in: 300,
      created_at: new Date().toISOString(),
    };

    const prompt = buildPermissionRequestPrompt([fakeReq]);
    expect(prompt).toContain("手机号");
    expect(prompt).toContain("138****5678");
    expect(prompt).toContain("注册旅行账号");
    expect(prompt).toContain("授权确认");
  });
});
