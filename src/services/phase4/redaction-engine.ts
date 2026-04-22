/**
 * RedactionEngine — Phase 4.2 数据脱敏引擎
 *
 * 职责：
 * 1. 根据 DataRedactionRule 规则集对内容进行脱敏处理
 * 2. 支持字符串和对象两种输入
 * 3. 提供灵活的规则管理（添加、删除、禁用规则）
 */

import {
  DataRedactionRule,
  RedactedContent,
  RedactionContext,
  RedactionAction,
  DEFAULT_REDACTION_RULES,
} from "../../types";

/**
 * 脱敏引擎配置
 */
export interface RedactionEngineConfig {
  /** 规则列表 */
  rules?: DataRedactionRule[];
  /** 是否默认启用所有规则 */
  defaultEnabled?: boolean;
  /** 最大处理深度（防止循环引用） */
  maxDepth?: number;
  /** 是否保留原始内容（用于审计） */
  preserveOriginal?: boolean;
  /** 是否启用审计日志 */
  enableAudit?: boolean;
}

/**
 * RedactionEngine — 数据脱敏引擎
 */
export class RedactionEngine {
  private rules: Map<string, DataRedactionRule> = new Map();
  private config: Required<RedactionEngineConfig>;

  constructor(config: RedactionEngineConfig = {}) {
    this.config = {
      rules: config.rules ?? [...DEFAULT_REDACTION_RULES],
      defaultEnabled: config.defaultEnabled ?? true,
      maxDepth: config.maxDepth ?? 10,
      preserveOriginal: config.preserveOriginal ?? false,
      enableAudit: config.enableAudit ?? false,
    };

    // 初始化规则映射
    for (const rule of this.config.rules) {
      if (rule.enabled !== false) {
        rule.enabled = true;
      }
      this.rules.set(rule.id, rule);
    }

    // 按优先级排序
    this.sortRulesByPriority();
  }

  /**
   * 对内容进行脱敏处理
   */
  redact(
    content: string | object,
    context?: RedactionContext
  ): RedactedContent {
    // 安全处理 null / undefined
    if (content == null) {
      return {
        content: content as unknown as string,
        originalContent: undefined,
        appliedRuleIds: [],
        stats: { totalMatches: 0, fieldsRedacted: 0, charactersMasked: 0 },
        isFullyRedacted: false,
        reason: "输入为空，跳过处理",
      };
    }

    const appliedRuleIds: string[] = [];
    let totalMatches = 0;
    let charactersMasked = 0;

    // 深度复制原始内容
    let processedContent =
      typeof content === "string"
        ? content
        : this.deepClone(content as Record<string, unknown>);

    // 对每个启用的规则进行处理
    for (const rule of this.rules.values()) {
      if (!rule.enabled) {
        continue;
      }

      if (typeof processedContent === "string") {
        const result = this.redactString(
          processedContent,
          rule,
          context
        );
        if (result.matched) {
          appliedRuleIds.push(rule.id);
          totalMatches += result.matchCount;
          charactersMasked += result.charactersMasked;
          processedContent = result.content;
        }
      } else {
        const result = this.redactObject(
          processedContent as Record<string, unknown>,
          rule,
          context,
          0
        );
        if (result.matched) {
          appliedRuleIds.push(rule.id);
          totalMatches += result.matchCount;
          charactersMasked += result.charactersMasked;
          processedContent = result.content as Record<string, unknown>;
        }
      }
    }

    return {
      content: processedContent,
      originalContent: this.config.preserveOriginal ? content : undefined,
      appliedRuleIds: [...new Set(appliedRuleIds)],
      stats: {
        totalMatches,
        fieldsRedacted: totalMatches,
        charactersMasked,
      },
      isFullyRedacted: appliedRuleIds.length > 0,
      reason:
        appliedRuleIds.length > 0
          ? `应用了 ${appliedRuleIds.length} 条脱敏规则`
          : "无匹配规则，内容保持不变",
    };
  }

  /**
   * 脱敏字符串内容
   */
  private redactString(
    content: string,
    rule: DataRedactionRule,
    _context?: RedactionContext
  ): { content: string; matched: boolean; matchCount: number; charactersMasked: number } {
    let matchCount = 0;
    let charactersMasked = 0;

    // ── 正则匹配 ────────────────────────────────────────────────────────────
    if (rule.match.regex) {
      try {
        const regex = new RegExp(rule.match.regex, "gi");
        let match;

        while ((match = regex.exec(content)) !== null) {
          matchCount++;
          const original = match[0];

          const redacted = this.applyMaskAction(original, rule);
          content = content.replace(original, redacted);
          charactersMasked += Math.max(0, original.length - redacted.length);

          // 防止无限循环
          if (matchCount > 1000) break;
        }
      } catch {
        // 无效正则，跳过
      }
    }

    // ── 关键词匹配 ──────────────────────────────────────────────────────────
    // 对于 TRUNCATE / HASH 动作：检测到关键词后对整体内容处理
    // 对于其他动作：替换关键词本身
    if (rule.match.keywords && rule.match.keywords.length > 0) {
      const hasKeyword = rule.match.keywords.some((kw) =>
        content.toLowerCase().includes(kw.toLowerCase())
      );

      if (hasKeyword) {
        if (rule.action === RedactionAction.TRUNCATE || rule.action === RedactionAction.HASH) {
          // 对整个内容执行动作
          matchCount++;
          const original = content;
          const redacted = this.applyMaskAction(content, rule);
          charactersMasked += Math.max(0, original.length - redacted.length);
          content = redacted;
        } else {
          // 替换每个关键词出现的位置
          for (const keyword of rule.match.keywords) {
            const regex = new RegExp(this.escapeRegex(keyword), "gi");
            let match;

            while ((match = regex.exec(content)) !== null) {
              matchCount++;
              const original = match[0];
              const redacted = this.applyMaskAction(original, rule);
              content = content.replace(original, redacted);
              charactersMasked += Math.max(0, original.length - redacted.length);
              // replace 会改变字符串，需要重置 regex lastIndex
              regex.lastIndex = 0;
              break; // 每个关键词只替换一轮，避免无限循环
            }
          }
        }
      }
    }

    return {
      content,
      matched: matchCount > 0,
      matchCount,
      charactersMasked,
    };
  }

  /**
   * 脱敏对象内容
   */
  private redactObject(
    obj: Record<string, unknown>,
    rule: DataRedactionRule,
    _context?: RedactionContext,
    depth: number = 0
  ): {
    content: Record<string, unknown>;
    matched: boolean;
    matchCount: number;
    charactersMasked: number;
  } {
    if (depth > this.config.maxDepth) {
      return { content: obj, matched: false, matchCount: 0, charactersMasked: 0 };
    }

    let totalMatchCount = 0;
    let totalCharsMasked = 0;
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      // ── 字段路径匹配 ─────────────────────────────────────────────────────
      if (rule.match.fieldPath) {
        if (!this.matchFieldPath(key, rule.match.fieldPath)) {
          result[key] = value;
          continue;
        }
      }

      // ── 字段路径匹配（fieldPath 存在时：只处理匹配的字段）──────────────
      if (rule.match.fieldPath) {
        if (!this.matchFieldPath(key, rule.match.fieldPath)) {
          result[key] = value;
          continue;
        }
      }

      // ── 关键词匹配字段名 ─────────────────────────────────────────────
      // 如果规则有 keywords，检查字段名是否匹配
      let fieldNameMatched = false;
      if (rule.match.keywords && rule.match.keywords.length > 0) {
        const keyLower = key.toLowerCase();
        fieldNameMatched = rule.match.keywords.some((kw) =>
          keyLower.includes(kw.toLowerCase())
        );
        // 规则只有 keywords（无 fieldPath 且无 regex）时，不匹配字段名则跳过
        if (!fieldNameMatched && !rule.match.fieldPath && !rule.match.regex) {
          result[key] = value;
          continue;
        }
      }

      // ── 处理值 ──────────────────────────────────────────────────────────
      if (typeof value === "string") {
        if (fieldNameMatched) {
          // 字段名匹配关键词：直接对整个值执行 action（优先级高于值内容扫描）
          const redacted = this.applyMaskAction(value, rule);
          totalMatchCount++;
          totalCharsMasked += Math.max(0, value.length - redacted.length);
          result[key] = redacted;
          continue;
        }
        const redactResult = this.redactString(value, rule, _context);
        if (redactResult.matched) {
          totalMatchCount += redactResult.matchCount;
          totalCharsMasked += redactResult.charactersMasked;
          result[key] = redactResult.content;
          continue;
        }
      } else if (typeof value === "object" && value !== null) {
        const nestedResult = this.redactObject(
          value as Record<string, unknown>,
          rule,
          _context,
          depth + 1
        );
        if (nestedResult.matched) {
          totalMatchCount += nestedResult.matchCount;
          totalCharsMasked += nestedResult.charactersMasked;
          result[key] = nestedResult.content;
          continue;
        }
      }

      result[key] = value;
    }

    return {
      content: result,
      matched: totalMatchCount > 0,
      matchCount: totalMatchCount,
      charactersMasked: totalCharsMasked,
    };
  }

  /**
   * 应用脱敏动作
   */
  private applyMaskAction(value: string, rule: DataRedactionRule): string {
    const { action, config } = rule;
    const maskChar = config.maskChar || "*";

    switch (action) {
      case RedactionAction.MASK:
        return this.applyMaskPattern(value, config.maskPattern || "full", maskChar);

      case RedactionAction.REPLACE:
        return config.replacement || "***REDACTED***";

      case RedactionAction.TRUNCATE: {
        const maxLen = config.maxLength || 10;
        // 总是追加省略号，表明内容已被截断处理
        return value.substring(0, maxLen) + "...";
      }

      case RedactionAction.HASH:
        return this.simpleHash(value);

      case RedactionAction.REMOVE:
        return "";

      default:
        return value;
    }
  }

  /**
   * 应用脱敏模式
   */
  private applyMaskPattern(
    value: string,
    pattern: string,
    maskChar: string
  ): string {
    switch (pattern) {
      case "last4":
        if (value.length <= 4) return maskChar.repeat(value.length);
        return maskChar.repeat(value.length - 4) + value.slice(-4);

      case "first3_last4":
        if (value.length <= 7) return maskChar.repeat(value.length);
        return (
          value.substring(0, 3) +
          maskChar.repeat(value.length - 7) +
          value.slice(-4)
        );

      case "first6_last4":
        if (value.length <= 10) return maskChar.repeat(value.length);
        return (
          value.substring(0, 6) +
          maskChar.repeat(value.length - 10) +
          value.slice(-4)
        );

      case "email_style": {
        const atIndex = value.indexOf("@");
        if (atIndex === -1) return maskChar.repeat(value.length);
        const localPart = value.substring(0, atIndex);
        const domainPart = value.substring(atIndex);
        if (localPart.length <= 2) {
          return maskChar.repeat(localPart.length) + domainPart;
        }
        return (
          localPart.charAt(0) +
          maskChar.repeat(localPart.length - 2) +
          localPart.charAt(localPart.length - 1) +
          domainPart
        );
      }

      case "full":
      default:
        return maskChar.repeat(value.length);
    }
  }

  /**
   * 简单哈希（用于 HASH 动作）
   */
  private simpleHash(value: string): string {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      const char = value.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, "0");
  }

  /**
   * 匹配字段路径
   */
  private matchFieldPath(fieldName: string, pattern: string): boolean {
    // 支持通配符 *
    if (pattern.includes("*")) {
      const regex = new RegExp(
        "^" + pattern.replace(/\*/g, ".*") + "$",
        "i"
      );
      return regex.test(fieldName);
    }
    return fieldName.toLowerCase() === pattern.toLowerCase();
  }

  /**
   * 转义正则特殊字符
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * 深度克隆对象
   */
  private deepClone(obj: Record<string, unknown>): Record<string, unknown> {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * 按优先级排序规则
   */
  private sortRulesByPriority(): void {
    const sorted = [...this.rules.values()].sort(
      (a, b) => (b.priority || 0) - (a.priority || 0)
    );
    this.rules = new Map(sorted.map((r) => [r.id, r]));
  }

  // ── 规则管理 ─────────────────────────────────────────────────────────────

  /**
   * 添加规则
   */
  addRule(rule: DataRedactionRule): void {
    this.rules.set(rule.id, rule);
    this.sortRulesByPriority();
  }

  /**
   * 删除规则
   */
  removeRule(ruleId: string): boolean {
    return this.rules.delete(ruleId);
  }

  /**
   * 启用规则
   */
  enableRule(ruleId: string): boolean {
    const rule = this.rules.get(ruleId);
    if (rule) {
      rule.enabled = true;
      return true;
    }
    return false;
  }

  /**
   * 禁用规则
   */
  disableRule(ruleId: string): boolean {
    const rule = this.rules.get(ruleId);
    if (rule) {
      rule.enabled = false;
      return true;
    }
    return false;
  }

  /**
   * 获取所有规则
   */
  getRules(): DataRedactionRule[] {
    return [...this.rules.values()];
  }

  /**
   * 获取启用的规则
   */
  getEnabledRules(): DataRedactionRule[] {
    return [...this.rules.values()].filter((r) => r.enabled);
  }

  /**
   * 获取规则数量
   */
  getRuleCount(): { total: number; enabled: number } {
    const all = [...this.rules.values()];
    return {
      total: all.length,
      enabled: all.filter((r) => r.enabled).length,
    };
  }
}

// ── 单例 ─────────────────────────────────────────────────────────────────────

let globalRedactionEngine: RedactionEngine | null = null;

/**
 * 获取全局脱敏引擎实例
 */
export function getRedactionEngine(
  config?: RedactionEngineConfig
): RedactionEngine {
  if (!globalRedactionEngine) {
    globalRedactionEngine = new RedactionEngine(config);
  }
  return globalRedactionEngine;
}

/**
 * 重置全局脱敏引擎（用于测试）
 */
export function resetRedactionEngine(): void {
  globalRedactionEngine = null;
}
