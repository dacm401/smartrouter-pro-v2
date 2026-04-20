/**
 * Phase 4.1 — Data Classification + Permission Layer Tests
 * Sprint 40 单元测试
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DataClassifier,
  getDataClassifier,
  PermissionChecker,
  getPermissionChecker,
  quickPermissionCheck,
  FEATURE_FLAGS,
} from "../../src/services/phase4/index.js";
import {
  DataClassification,
  ClassificationContext,
  PermissionContext,
} from "../../src/types/index.js";

describe("Phase 4.1: DataClassifier", () => {
  let classifier: DataClassifier;

  beforeEach(() => {
    classifier = new DataClassifier();
  });

  describe("默认规则覆盖", () => {
    it("用户标记敏感数据 → LOCAL_ONLY", () => {
      const ctx: ClassificationContext = {
        dataType: "memory",
        sensitivity: "confidential",
        source: "user",
        hasPII: false,
        userMarkedSensitive: true,
      };
      const result = classifier.classify({}, ctx);
      expect(result.classification).toBe(DataClassification.LOCAL_ONLY);
      expect(result.confidence).toBeGreaterThan(0.6); // 有 userMarkedSensitive 提高置信度
    });

    it("含 PII 的用户数据 → LOCAL_ONLY", () => {
      const ctx: ClassificationContext = {
        dataType: "user_profile",
        sensitivity: "confidential",
        source: "user",
        hasPII: true,
      };
      const result = classifier.classify({}, ctx);
      expect(result.classification).toBe(DataClassification.LOCAL_ONLY);
    });

    it("任务归档 → LOCAL_ONLY", () => {
      const ctx: ClassificationContext = {
        dataType: "task_archive",
        sensitivity: "internal",
        source: "system",
        hasPII: false,
      };
      const result = classifier.classify({}, ctx);
      expect(result.classification).toBe(DataClassification.LOCAL_ONLY);
    });

    it("公开搜索结果（近期）→ CLOUD_ALLOWED", () => {
      const ctx: ClassificationContext = {
        dataType: "web_content",
        sensitivity: "public",
        source: "third_party",
        hasPII: false,
        ageHours: 0.5,
      };
      const result = classifier.classify({}, ctx);
      expect(result.classification).toBe(DataClassification.CLOUD_ALLOWED);
    });

    it("旧网页内容 → LOCAL_SUMMARY_SHAREABLE", () => {
      const ctx: ClassificationContext = {
        dataType: "web_content",
        sensitivity: "public",
        source: "third_party",
        hasPII: false,
        ageHours: 48, // 超过 1 小时
      };
      const result = classifier.classify({}, ctx);
      expect(result.classification).toBe(DataClassification.LOCAL_SUMMARY_SHAREABLE);
    });

    it("内部 API 结果 → LOCAL_ONLY", () => {
      const ctx: ClassificationContext = {
        dataType: "tool_result",
        sensitivity: "confidential",
        source: "system",
        hasPII: false,
      };
      const result = classifier.classify({}, ctx);
      expect(result.classification).toBe(DataClassification.LOCAL_ONLY);
    });

    it("短期对话历史 → CLOUD_ALLOWED", () => {
      const ctx: ClassificationContext = {
        dataType: "conversation_history",
        sensitivity: "internal",
        source: "user",
        hasPII: false,
        ageHours: 0.5,
      };
      const result = classifier.classify({}, ctx);
      expect(result.classification).toBe(DataClassification.CLOUD_ALLOWED);
    });

    it("长期对话历史（>24h）→ LOCAL_ONLY", () => {
      const ctx: ClassificationContext = {
        dataType: "conversation_history",
        sensitivity: "internal",
        source: "user",
        hasPII: false,
        ageHours: 48,
      };
      const result = classifier.classify({}, ctx);
      expect(result.classification).toBe(DataClassification.LOCAL_ONLY);
    });

    it("绝密数据 → LOCAL_ONLY", () => {
      const ctx: ClassificationContext = {
        dataType: "memory",
        sensitivity: "secret",
        source: "user",
        hasPII: true,
      };
      const result = classifier.classify({}, ctx);
      expect(result.classification).toBe(DataClassification.LOCAL_ONLY);
    });
  });

  describe("suggestedHandling 映射", () => {
    it("LOCAL_ONLY → block", () => {
      const ctx: ClassificationContext = {
        dataType: "memory",
        sensitivity: "secret",
        source: "user",
        hasPII: true,
      };
      const result = classifier.classify({}, ctx);
      expect(result.suggestedHandling).toBe("block");
    });

    it("LOCAL_SUMMARY_SHAREABLE → summarize", () => {
      // 中期对话（1-24h）返回 LOCAL_SUMMARY_SHAREABLE
      const ctx: ClassificationContext = {
        dataType: "conversation_history",
        sensitivity: "internal",
        source: "user",
        hasPII: false,
        ageHours: 12,
      };
      const result = classifier.classify({}, ctx);
      expect(result.classification).toBe(DataClassification.LOCAL_SUMMARY_SHAREABLE);
      expect(result.suggestedHandling).toBe("summarize");
    });

    it("CLOUD_ALLOWED → expose", () => {
      const ctx: ClassificationContext = {
        dataType: "web_content",
        sensitivity: "public",
        source: "third_party",
        hasPII: false,
        ageHours: 0.5,
      };
      const result = classifier.classify({}, ctx);
      expect(result.suggestedHandling).toBe("expose");
    });
  });

  describe("classifyQuick", () => {
    it("快速分类只返回枚举值", () => {
      const ctx: ClassificationContext = {
        dataType: "task_archive",
        sensitivity: "internal",
        source: "system",
        hasPII: false,
      };
      const result = classifier.classifyQuick({}, ctx);
      expect(typeof result).toBe("string");
      expect(Object.values(DataClassification)).toContain(result);
    });
  });

  describe("自定义规则", () => {
    it("添加自定义规则优先级最高", () => {
      const customRule = {
        name: "custom_test",
        dataType: "conversation_history",
        classification: DataClassification.LOCAL_ONLY,
        reason: "测试自定义规则",
      };
      classifier.addRule(customRule);

      const ctx: ClassificationContext = {
        dataType: "conversation_history",
        sensitivity: "internal",
        source: "user",
        hasPII: false,
        ageHours: 0.5,
      };
      const result = classifier.classify({}, ctx);
      expect(result.classification).toBe(DataClassification.LOCAL_ONLY);
      expect(result.reason).toBe("测试自定义规则");
    });
  });

  describe("置信度计算", () => {
    it("匹配条件越多，置信度越高", () => {
      const sparseCtx: ClassificationContext = {
        dataType: "conversation_history",
        sensitivity: "internal",
        source: "user",
        hasPII: false,
      };
      const richCtx: ClassificationContext = {
        dataType: "conversation_history",
        sensitivity: "internal",
        source: "user",
        hasPII: false,
        userMarkedSensitive: true,
      };

      const sparseResult = classifier.classify({}, sparseCtx);
      const richResult = classifier.classify({}, richCtx);

      // 有 userMarkedSensitive 的上下文应该有更高置信度
      expect(richResult.confidence).toBeGreaterThanOrEqual(sparseResult.confidence);
    });
  });

  describe("默认实例", () => {
    it("getDataClassifier 返回单例", () => {
      const instance1 = getDataClassifier();
      const instance2 = getDataClassifier();
      expect(instance1).toBe(instance2);
    });
  });
});

describe("Phase 4.1: PermissionChecker", () => {
  let checker: PermissionChecker;

  beforeEach(() => {
    checker = new PermissionChecker();
  });

  describe("Feature Flag 控制", () => {
    it("use_permission_layer=false → 放行", () => {
      const ctx: PermissionContext = {
        sessionId: "test-session",
        userId: "test-user",
        requestedTier: DataClassification.CLOUD_ALLOWED,
        featureFlags: { use_permission_layer: false },
        targetModel: "cloud_72b",
      };
      const result = checker.check(ctx);
      expect(result.allowed).toBe(true);
    });

    it("use_permission_layer=true 且无其他限制 → 放行", () => {
      const ctx: PermissionContext = {
        sessionId: "test-session",
        userId: "test-user",
        requestedTier: DataClassification.CLOUD_ALLOWED,
        featureFlags: { use_permission_layer: true },
        targetModel: "cloud_72b",
      };
      const result = checker.check(ctx);
      expect(result.allowed).toBe(true);
    });

    it("use_permission_layer=true 但 LOCAL_ONLY 分类 → 拒绝", () => {
      const ctx: PermissionContext = {
        sessionId: "test-session",
        userId: "test-user",
        requestedTier: DataClassification.LOCAL_ONLY,
        featureFlags: { use_permission_layer: true },
        targetModel: "cloud_72b",
      };
      const result = checker.check(ctx);
      expect(result.allowed).toBe(false);
      expect(result.fallbackAction).toBe("summarize");
    });
  });

  describe("本地模型直通", () => {
    it("目标为本地模型 → 总是允许", () => {
      const ctx: PermissionContext = {
        sessionId: "test-session",
        userId: "test-user",
        requestedTier: DataClassification.LOCAL_ONLY,
        featureFlags: { use_permission_layer: true },
        targetModel: "local_7b",
      };
      const result = checker.check(ctx);
      expect(result.allowed).toBe(true);
      expect(result.tier).toBe(DataClassification.LOCAL_ONLY);
    });
  });

  describe("用户偏好检查", () => {
    it("用户禁止云端对话历史 → 拒绝 CLOUD_ALLOWED 请求", () => {
      const ctx: PermissionContext = {
        sessionId: "test-session",
        userId: "test-user",
        requestedTier: DataClassification.CLOUD_ALLOWED,
        featureFlags: { use_permission_layer: true },
        targetModel: "cloud_72b",
        userDataPreferences: {
          allowCloudConversationHistory: false,
        },
      };
      const result = checker.check(ctx);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("对话历史");
    });

    it("用户禁止云端记忆 → 拒绝", () => {
      const ctx: PermissionContext = {
        sessionId: "test-session",
        userId: "test-user",
        requestedTier: DataClassification.CLOUD_ALLOWED,
        featureFlags: { use_permission_layer: true },
        targetModel: "cloud_72b",
        userDataPreferences: {
          allowCloudMemory: false,
        },
      };
      const result = checker.check(ctx);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("记忆");
    });

    it("用户允许云端访问 → 放行", () => {
      const ctx: PermissionContext = {
        sessionId: "test-session",
        userId: "test-user",
        requestedTier: DataClassification.CLOUD_ALLOWED,
        featureFlags: { use_permission_layer: true },
        targetModel: "cloud_72b",
        userDataPreferences: {
          allowCloudConversationHistory: true,
          allowCloudMemory: true,
        },
      };
      const result = checker.check(ctx);
      expect(result.allowed).toBe(true);
    });
  });

  describe("分类级别决策", () => {
    it("LOCAL_ONLY → 拒绝，摘要暴露", () => {
      const ctx: PermissionContext = {
        sessionId: "test-session",
        userId: "test-user",
        requestedTier: DataClassification.LOCAL_ONLY,
        featureFlags: { use_permission_layer: true },
        targetModel: "cloud_72b",
      };
      const result = checker.check(ctx);
      expect(result.allowed).toBe(false);
      expect(result.tier).toBe(DataClassification.LOCAL_ONLY);
      expect(result.fallbackAction).toBe("summarize");
    });

    it("LOCAL_SUMMARY_SHAREABLE → 允许，仅摘要暴露", () => {
      const ctx: PermissionContext = {
        sessionId: "test-session",
        userId: "test-user",
        requestedTier: DataClassification.LOCAL_SUMMARY_SHAREABLE,
        featureFlags: { use_permission_layer: true },
        targetModel: "cloud_72b",
      };
      const result = checker.check(ctx);
      expect(result.allowed).toBe(true);
      expect(result.tier).toBe(DataClassification.LOCAL_SUMMARY_SHAREABLE);
      expect(result.fallbackAction).toBe("summarize");
    });

    it("CLOUD_ALLOWED → 允许", () => {
      const ctx: PermissionContext = {
        sessionId: "test-session",
        userId: "test-user",
        requestedTier: DataClassification.CLOUD_ALLOWED,
        featureFlags: { use_permission_layer: true },
        targetModel: "cloud_72b",
      };
      const result = checker.check(ctx);
      expect(result.allowed).toBe(true);
      expect(result.tier).toBe(DataClassification.CLOUD_ALLOWED);
    });
  });

  describe("quickPermissionCheck", () => {
    it("Feature Flag 关闭 → true", () => {
      expect(quickPermissionCheck("user1", "session1", {})).toBe(true);
    });

    it("Feature Flag 开启 → 根据分类决定", () => {
      // 默认请求 CLOUD_ALLOWED
      expect(quickPermissionCheck("user1", "session1", { use_permission_layer: true })).toBe(true);
    });
  });

  describe("PermissionChecker.fromClassification", () => {
    it("从分类结果生成权限决策", () => {
      const ctx: PermissionContext = {
        sessionId: "test-session",
        userId: "test-user",
        requestedTier: DataClassification.LOCAL_ONLY,
        featureFlags: { use_permission_layer: true },
        targetModel: "cloud_72b",
      };
      const result = PermissionChecker.fromClassification(DataClassification.LOCAL_ONLY, ctx);
      expect(result.allowed).toBe(false);
    });
  });

  describe("默认实例", () => {
    it("getPermissionChecker 返回单例", () => {
      const instance1 = getPermissionChecker();
      const instance2 = getPermissionChecker();
      expect(instance1).toBe(instance2);
    });
  });
});

describe("Phase 4.1: Feature Flags", () => {
  it("FEATURE_FLAGS 包含必需字段", () => {
    expect(FEATURE_FLAGS.PERMISSION_LAYER).toBe("use_permission_layer");
    expect(FEATURE_FLAGS.DATA_CLASSIFICATION).toBe("use_data_classification");
    expect(FEATURE_FLAGS.CLOUD_MEMORY).toBe("allow_cloud_memory");
    expect(FEATURE_FLAGS.CLOUD_HISTORY).toBe("allow_cloud_conversation_history");
    expect(FEATURE_FLAGS.CLOUD_TOOLS).toBe("allow_cloud_tool_results");
  });
});
