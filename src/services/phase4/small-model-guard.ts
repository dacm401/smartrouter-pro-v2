/**
 * SmallModelGuard — Phase 4.3 小模型守卫
 *
 * 职责：
 * 1. 验证小模型输出的安全性
 * 2. 检测提示注入、越狱、数据泄露等攻击
 * 3. 提供可配置的安全规则集
 * 4. 支持 ESCALATE 动作（降级到慢模型处理）
 */

import {
  SmallModelGuardRule,
  SmallModelGuardConfig,
  GuardContext,
  GuardResult,
  GuardAction,
  GuardViolationType,
  GuardPattern,
  DEFAULT_GUARD_RULES,
} from "../../types";

/**
 * 预定义模式检测器
 */
const PATTERN_DETECTORS: Record<GuardPattern, RegExp> = {
  [GuardPattern.URL]: /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi,
  [GuardPattern.FILE_PATH]: /[\/\\]?(?:\w:[\/\\])?[\w\-. \/\\]+\.[a-z]{2,10}/gi,
  [GuardPattern.CODE_BLOCK]: /```[\s\S]*?```|`[^`]+`/g,
  [GuardPattern.BASE64]: /(?:[A-Za-z0-9+/]{4}){10,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?/g,
  [GuardPattern.JSON_DATA]: /\{[\s\S]*?\}/g,
  [GuardPattern.SQL_INJECTION]: /('|('|"))\s*(?:or|and|union|select|insert|delete|drop|update)\b/gi,
  [GuardPattern.COMMAND_INJECTION]: /(?:;|\|\||&&)\s*(?:rm|del|format|mkdir|chmod|wget|curl|nc|bash|sh|powershell|cmd)\b/gi,
};

/**
 * 小模型守卫
 */
export class SmallModelGuard {
  private rules: Map<string, SmallModelGuardRule> = new Map();
  private config: Required<SmallModelGuardConfig>;

  constructor(config: SmallModelGuardConfig = {}) {
    this.config = {
      rules: config.rules ?? [...DEFAULT_GUARD_RULES],
      defaultEnabled: config.defaultEnabled ?? true,
      defaultAction: config.defaultAction ?? GuardAction.ALLOW,
      enableAIDetection: config.enableAIDetection ?? false,
      confidenceThreshold: config.confidenceThreshold ?? 0.7,
      silentMode: config.silentMode ?? false,
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
   * 检查内容安全性
   */
  check(
    content: string,
    context: GuardContext
  ): GuardResult {
    const contentStr = typeof content === "string" ? content : JSON.stringify(content);

    // 遍历所有启用的规则
    for (const rule of this.rules.values()) {
      if (!rule.enabled) {
        continue;
      }

      const matchResult = this.matchRule(contentStr, rule);

      if (matchResult.matched) {
        // 规则匹配，执行动作
        return this.executeAction(rule, matchResult, context);
      }
    }

    // 未匹配任何规则，默认允许
    return {
      passed: this.config.defaultAction === GuardAction.ALLOW,
      violationType: undefined,
    };
  }

  /**
   * 批量检查多个内容
   */
  checkBatch(
    contents: string[],
    context: GuardContext
  ): GuardResult[] {
    return contents.map((content) => this.check(content, context));
  }

  /**
   * 规则匹配
   */
  private matchRule(
    content: string,
    rule: SmallModelGuardRule
  ): { matched: boolean; matchedText?: string } {
    // 1. 检查正则表达式
    if (rule.match.regex) {
      try {
        const regex = new RegExp(rule.match.regex, "gi");
        if (regex.test(content)) {
          return { matched: true, matchedText: "regex" };
        }
      } catch {
        // 无效正则，跳过
      }
    }

    // 2. 检查关键词
    if (rule.match.keywords && rule.match.keywords.length > 0) {
      for (const keyword of rule.match.keywords) {
        if (content.toLowerCase().includes(keyword.toLowerCase())) {
          return { matched: true, matchedText: keyword };
        }
      }
    }

    // 3. 检查预定义模式
    if (rule.match.patterns && rule.match.patterns.length > 0) {
      for (const pattern of rule.match.patterns) {
        const detector = PATTERN_DETECTORS[pattern];
        if (detector && detector.test(content)) {
          return { matched: true, matchedText: pattern };
        }
      }
    }

    return { matched: false };
  }

  /**
   * 执行守卫动作
   */
  private executeAction(
    rule: SmallModelGuardRule,
    matchResult: { matched: boolean; matchedText?: string },
    context: GuardContext
  ): GuardResult {
    const result: GuardResult = {
      passed: rule.action === GuardAction.ALLOW || rule.action === GuardAction.FLAG,
      violationType: rule.violationType,
      details: this.config.silentMode
        ? undefined
        : `匹配规则: ${rule.name} (${matchResult.matchedText || "unknown"})`,
    };

    switch (rule.action) {
      case GuardAction.DENY:
        result.passed = false;
        result.blockedContent = this.config.silentMode ? undefined : "内容已被拦截";
        result.suggestion = "请修改输入内容后重试";
        break;

      case GuardAction.ESCALATE:
        result.passed = true; // 但标记为需要升级
        result.suggestion = "内容已标记为可疑，建议降级到慢模型处理";
        break;

      case GuardAction.SILENT_DENY:
        result.passed = false;
        result.violationType = undefined; // 静默模式不暴露具体原因
        result.details = undefined;
        break;

      case GuardAction.FLAG:
        // FLAG 仍然允许通过，但记录
        break;

      case GuardAction.ALLOW:
        result.passed = true;
        break;
    }

    // 审计日志
    if (rule.config.auditLog && !this.config.silentMode) {
      this.logAudit(rule, context);
    }

    return result;
  }

  /**
   * 审计日志
   */
  private logAudit(rule: SmallModelGuardRule, context: GuardContext): void {
    console.log(
      `[SmallModelGuard Audit] Rule: ${rule.name}, Type: ${rule.violationType}, Session: ${context.sessionId}`
    );
  }

  /**
   * 按优先级排序规则
   */
  private sortRulesByPriority(): void {
    const sortedRules = Array.from(this.rules.values()).sort(
      (a, b) => b.priority - a.priority
    );
    this.rules = new Map(sortedRules.map((rule) => [rule.id, rule]));
  }

  /**
   * 获取所有规则
   */
  getRules(): SmallModelGuardRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * 获取启用的规则
   */
  getEnabledRules(): SmallModelGuardRule[] {
    return Array.from(this.rules.values()).filter((rule) => rule.enabled);
  }

  /**
   * 获取规则数量
   */
  getRuleCount(): { total: number; enabled: number } {
    const total = this.rules.size;
    const enabled = Array.from(this.rules.values()).filter(
      (rule) => rule.enabled
    ).length;
    return { total, enabled };
  }

  /**
   * 添加规则
   */
  addRule(rule: SmallModelGuardRule): void {
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
}

// ── 全局单例 ─────────────────────────────────────────────────────────────────

let globalGuard: SmallModelGuard | null = null;

/**
 * 获取全局 SmallModelGuard 实例
 */
export function getSmallModelGuard(config?: SmallModelGuardConfig): SmallModelGuard {
  if (!globalGuard) {
    globalGuard = new SmallModelGuard(config);
  }
  return globalGuard;
}

/**
 * 重置全局实例
 */
export function resetSmallModelGuard(): void {
  globalGuard = null;
}
