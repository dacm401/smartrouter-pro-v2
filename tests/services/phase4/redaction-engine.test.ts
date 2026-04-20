/**
 * Phase 4.2 RedactionEngine 单元测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  RedactionEngine,
  getRedactionEngine,
  resetRedactionEngine,
} from "../../src/services/phase4/redaction-engine";
import {
  DataRedactionRule,
  RedactionAction,
  RedactionContext,
} from "../../src/types";

// 测试数据
const TEST_CONTEXT: RedactionContext = {
  sessionId: "test-session",
  userId: "test-user",
  dataType: "conversation_history",
  targetClassification: "cloud_allowed",
  enableAudit: true,
};

describe("RedactionEngine", () => {
  beforeEach(() => {
    resetRedactionEngine();
  });

  describe("基本功能", () => {
    it("应该正确实例化", () => {
      const engine = new RedactionEngine();
      expect(engine).toBeDefined();
      expect(engine.getRuleCount().total).toBeGreaterThan(0);
    });

    it("应该默认启用所有内置规则", () => {
      const engine = new RedactionEngine();
      expect(engine.getRuleCount().enabled).toBe(engine.getRuleCount().total);
    });

    it("应该支持自定义规则", () => {
      const customRule: DataRedactionRule = {
        id: "custom_rule",
        name: "自定义规则",
        match: { regex: "CUSTOM_TOKEN_\\w+" },
        action: RedactionAction.REPLACE,
        config: { replacement: "***TOKEN***" },
        enabled: true,
      };

      const engine = new RedactionEngine({ rules: [customRule] });
      expect(engine.getRules()).toHaveLength(1);
      expect(engine.getRules()[0].id).toBe("custom_rule");
    });
  });

  describe("字符串脱敏", () => {
    let engine: RedactionEngine;

    beforeEach(() => {
      engine = new RedactionEngine();
    });

    it("应该正确脱敏中国手机号", () => {
      const result = engine.redact("联系电话：13812345678", TEST_CONTEXT);
      const content = result.content as string;

      expect(content).toContain("138****5678");
      expect(result.appliedRuleIds).toContain("phone_cn");
      expect(result.stats.totalMatches).toBe(1);
    });

    it("应该正确脱敏邮箱地址", () => {
      const result = engine.redact("邮箱：user@example.com", TEST_CONTEXT);
      const content = result.content as string;

      // 邮箱脱敏应保留部分显示
      expect(content).not.toContain("user@example.com");
      expect(result.appliedRuleIds).toContain("email");
    });

    it("应该正确脱敏中国身份证", () => {
      const result = engine.redact("身份证号：110101199001011234", TEST_CONTEXT);
      const content = result.content as string;

      expect(content).toContain("******1234");
      expect(result.appliedRuleIds).toContain("id_card_cn");
    });

    it("应该正确脱敏 API Key", () => {
      const result = engine.redact("API_KEY=sk-abcdefgh1234567890", TEST_CONTEXT);
      const content = result.content as string;

      expect(content).toContain("***REDACTED***");
      expect(result.appliedRuleIds).toContain("api_key");
    });

    it("应该正确脱敏 IP 地址", () => {
      const result = engine.redact("IP地址：192.168.1.100", TEST_CONTEXT);
      const content = result.content as string;

      expect(content).toContain("***.***.***.***");
      expect(result.appliedRuleIds).toContain("ip_address");
    });

    it("应该正确脱敏信用卡号", () => {
      const result = engine.redact("卡号：4532-1234-5678-9012", TEST_CONTEXT);
      const content = result.content as string;

      expect(content).not.toContain("4532");
      expect(result.appliedRuleIds).toContain("credit_card");
    });

    it("应该正确脱敏银行账号", () => {
      const result = engine.redact("账号：6222021234567890123", TEST_CONTEXT);
      const content = result.content as string;

      expect(content).not.toContain("622202");
      expect(result.appliedRuleIds).toContain("bank_account");
    });

    it("应该正确处理无敏感信息的内容", () => {
      const result = engine.redact("这是一段普通文本，没有任何敏感信息。", TEST_CONTEXT);
      const content = result.content as string;

      expect(content).toBe("这是一段普通文本，没有任何敏感信息。");
      expect(result.appliedRuleIds).toHaveLength(0);
      expect(result.stats.totalMatches).toBe(0);
    });

    it("应该处理多个敏感信息", () => {
      const result = engine.redact(
        "手机：13812345678，邮箱：test@example.com，IP：10.0.0.1",
        TEST_CONTEXT
      );

      expect(result.stats.totalMatches).toBeGreaterThanOrEqual(3);
    });

    it("应该正确处理空字符串", () => {
      const result = engine.redact("", TEST_CONTEXT);

      expect(result.content).toBe("");
      expect(result.appliedRuleIds).toHaveLength(0);
    });
  });

  describe("对象脱敏", () => {
    let engine: RedactionEngine;

    beforeEach(() => {
      engine = new RedactionEngine();
    });

    it("应该正确脱敏对象中的敏感字段", () => {
      const input = {
        name: "张三",
        phone: "13812345678",
        email: "zhangsan@example.com",
        address: "北京市朝阳区",
      };

      const result = engine.redact(input, TEST_CONTEXT);
      const content = result.content as Record<string, unknown>;

      expect(content.name).toBe("张三");
      expect(content.phone).toContain("***");
      expect(content.email).not.toBe("zhangsan@example.com");
      expect(content.address).toBe("北京市朝阳区");
    });

    it("应该正确脱敏嵌套对象", () => {
      const input = {
        user: {
          profile: {
            phone: "13900001111",
          },
        },
        settings: {
          api_key: "sk-test123456",
        },
      };

      const result = engine.redact(input, TEST_CONTEXT);
      const content = result.content as Record<string, unknown>;

      const user = content.user as Record<string, unknown>;
      const profile = user.profile as Record<string, unknown>;
      const settings = content.settings as Record<string, unknown>;

      expect(profile.phone).toContain("***");
      expect(settings.api_key).toBe("***REDACTED***");
    });

    it("应该保留非敏感字段", () => {
      const input = {
        id: 12345,
        active: true,
        score: 95.5,
        tags: ["admin", "vip"],
      };

      const result = engine.redact(input, TEST_CONTEXT);
      const content = result.content as Record<string, unknown>;

      expect(content.id).toBe(12345);
      expect(content.active).toBe(true);
      expect(content.score).toBe(95.5);
      expect(content.tags).toEqual(["admin", "vip"]);
    });

    it("应该正确处理数组", () => {
      const input = {
        users: [
          { name: "用户1", phone: "13812345678" },
          { name: "用户2", phone: "13900001111" },
        ],
      };

      const result = engine.redact(input, TEST_CONTEXT);
      const content = result.content as Record<string, unknown>;
      const users = content.users as Array<Record<string, unknown>>;

      expect(users[0].name).toBe("用户1");
      expect(users[0].phone).toContain("***");
      expect(users[1].phone).toContain("***");
    });
  });

  describe("脱敏规则管理", () => {
    it("应该能够添加新规则", () => {
      const engine = new RedactionEngine();

      const newRule: DataRedactionRule = {
        id: "ssn",
        name: "社保号脱敏",
        match: { regex: "\\d{9}" },
        action: RedactionAction.MASK,
        config: { maskPattern: "full" },
        enabled: true,
      };

      engine.addRule(newRule);
      expect(engine.getRules()).toHaveLength(9); // 8 内置 + 1 自定义
    });

    it("应该能够删除规则", () => {
      const engine = new RedactionEngine();
      const initialCount = engine.getRuleCount().total;

      engine.removeRule("phone_cn");
      expect(engine.getRuleCount().total).toBe(initialCount - 1);
    });

    it("应该能够禁用规则", () => {
      const engine = new RedactionEngine();

      engine.disableRule("phone_cn");
      expect(engine.getEnabledRules().find((r) => r.id === "phone_cn")).toBeUndefined();

      const result = engine.redact("手机：13812345678", TEST_CONTEXT);
      expect(result.appliedRuleIds).not.toContain("phone_cn");
    });

    it("应该能够启用规则", () => {
      const engine = new RedactionEngine();

      engine.disableRule("phone_cn");
      engine.enableRule("phone_cn");

      const result = engine.redact("手机：13812345678", TEST_CONTEXT);
      expect(result.appliedRuleIds).toContain("phone_cn");
    });

    it("应该按优先级排序规则", () => {
      const engine = new RedactionEngine();
      const rules = engine.getRules();

      // password 规则优先级最高（130）
      expect(rules[0].id).toBe("password");
    });
  });

  describe("脱敏动作类型", () => {
    it("MASK 动作应该正确工作", () => {
      const rule: DataRedactionRule = {
        id: "test_mask",
        name: "测试MASK",
        match: { regex: "\\d{6}" },
        action: RedactionAction.MASK,
        config: { maskPattern: "full", maskChar: "#" },
        enabled: true,
      };

      const engine = new RedactionEngine({ rules: [rule] });
      const result = engine.redact("验证码：123456", TEST_CONTEXT);

      expect((result.content as string)).toContain("######");
    });

    it("REPLACE 动作应该正确工作", () => {
      const rule: DataRedactionRule = {
        id: "test_replace",
        name: "测试REPLACE",
        match: { regex: "REDACT" },
        action: RedactionAction.REPLACE,
        config: { replacement: "[已脱敏]" },
        enabled: true,
      };

      const engine = new RedactionEngine({ rules: [rule] });
      const result = engine.redact("内容包含 REDACT", TEST_CONTEXT);

      expect(result.content).toContain("[已脱敏]");
      expect(result.content).not.toContain("REDACT");
    });

    it("TRUNCATE 动作应该正确工作", () => {
      const rule: DataRedactionRule = {
        id: "test_truncate",
        name: "测试TRUNCATE",
        match: { keywords: ["secret"] },
        action: RedactionAction.TRUNCATE,
        config: { maxLength: 10 },
        enabled: true,
      };

      const engine = new RedactionEngine({ rules: [rule] });
      const result = engine.redact("这是一个很长的secret内容不应该完全显示", TEST_CONTEXT);

      expect(result.content).toContain("...");
    });

    it("HASH 动作应该正确工作", () => {
      const rule: DataRedactionRule = {
        id: "test_hash",
        name: "测试HASH",
        match: { keywords: ["hashme"] },
        action: RedactionAction.HASH,
        config: {},
        enabled: true,
      };

      const engine = new RedactionEngine({ rules: [rule] });
      const result = engine.redact("请对这段文字进行hashme处理", TEST_CONTEXT);

      // 哈希后应该是 8 位十六进制
      const content = result.content as string;
      expect(content).toMatch(/^[0-9a-f]{8}$/);
    });
  });

  describe("配置选项", () => {
    it("应该支持禁用 preserveOriginal", () => {
      const engine = new RedactionEngine({ preserveOriginal: false });
      const result = engine.redact("手机：13812345678", TEST_CONTEXT);

      expect(result.originalContent).toBeUndefined();
    });

    it("应该支持启用 preserveOriginal", () => {
      const engine = new RedactionEngine({ preserveOriginal: true });
      const result = engine.redact("手机：13812345678", TEST_CONTEXT);

      expect(result.originalContent).toBe("手机：13812345678");
    });

    it("应该支持自定义最大深度", () => {
      const deepObject = {
        level1: {
          level2: {
            level3: {
              phone: "13812345678",
            },
          },
        },
      };

      // 默认 maxDepth=10，应该能处理
      const engine1 = new RedactionEngine();
      const result1 = engine1.redact(deepObject, TEST_CONTEXT);
      expect(result1.stats.totalMatches).toBe(1);

      // maxDepth=1，应该无法到达深层
      const engine2 = new RedactionEngine({ maxDepth: 1 });
      const result2 = engine2.redact(deepObject, TEST_CONTEXT);
      expect(result2.stats.totalMatches).toBe(0);
    });
  });

  describe("边缘情况", () => {
    it("应该处理无效正则表达式", () => {
      const rule: DataRedactionRule = {
        id: "invalid_regex",
        name: "无效正则",
        match: { regex: "[invalid(" }, // 无效正则
        action: RedactionAction.MASK,
        config: {},
        enabled: true,
      };

      const engine = new RedactionEngine({ rules: [rule] });

      // 不应该抛出错误
      expect(() => {
        engine.redact("测试文本", TEST_CONTEXT);
      }).not.toThrow();
    });

    it("应该处理 null 和 undefined 值", () => {
      const engine = new RedactionEngine();

      expect(() => {
        engine.redact(null as unknown as string, TEST_CONTEXT);
      }).not.toThrow();

      expect(() => {
        engine.redact(undefined as unknown as string, TEST_CONTEXT);
      }).not.toThrow();
    });

    it("应该处理特殊字符", () => {
      const engine = new RedactionEngine();

      const result = engine.redact("特殊字符：<>&\"'", TEST_CONTEXT);

      expect(result.content).toBe("特殊字符：<>&\"'");
      expect(result.stats.totalMatches).toBe(0);
    });
  });

  describe("单例模式", () => {
    it("应该返回相同的全局实例", () => {
      const engine1 = getRedactionEngine();
      const engine2 = getRedactionEngine();

      expect(engine1).toBe(engine2);
    });

    it("应该能够重置全局实例", () => {
      const engine1 = getRedactionEngine();
      resetRedactionEngine();
      const engine2 = getRedactionEngine();

      expect(engine1).not.toBe(engine2);
    });
  });
});

describe("脱敏统计", () => {
  let engine: RedactionEngine;

  beforeEach(() => {
    resetRedactionEngine();
    engine = new RedactionEngine();
  });

  it("应该正确统计匹配数量", () => {
    const result = engine.redact(
      "手机1：13812345678，手机2：13900001111，手机3：13700002222",
      TEST_CONTEXT
    );

    expect(result.stats.totalMatches).toBe(3);
  });

  it("应该正确统计被脱敏的字符数", () => {
    const result = engine.redact("API_KEY=sk-abcdefgh1234567890", TEST_CONTEXT);

    expect(result.stats.charactersMasked).toBeGreaterThan(0);
  });

  it("应该标记为完全脱敏", () => {
    const result = engine.redact("手机：13812345678", TEST_CONTEXT);

    expect(result.isFullyRedacted).toBe(true);
  });

  it("无匹配时应该标记为未完全脱敏", () => {
    const result = engine.redact("普通文本", TEST_CONTEXT);

    expect(result.isFullyRedacted).toBe(false);
  });
});
