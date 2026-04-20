/**
 * DataClassifier — Phase 4.1 数据分类器
 *
 * 职责：根据数据的类型、来源、敏感级别等特征，决定数据的暴露级别。
 * Rule-based 实现，后期可扩展为小模型增强。
 */

import {
  DataClassification,
  ClassificationContext,
  ClassificationResult,
  SensitivityLevel,
  DataSource,
} from "../../types";

/**
 * 默认分类规则表
 * 优先级：从上到下匹配，第一条匹配即返回
 */
interface ClassificationRule {
  /** 规则名称 */
  name: string;
  /** 数据类型匹配（可选） */
  dataType?: ClassificationContext["dataType"];
  /** 敏感级别匹配（可选） */
  sensitivity?: SensitivityLevel;
  /** 数据来源匹配（可选） */
  source?: DataSource;
  /** 包含 PII */
  hasPII?: boolean;
  /** 数据年龄上限（小时） */
  maxAgeHours?: number;
  /** 用户标记为敏感 */
  userMarkedSensitive?: boolean;
  /** 分类结果 */
  classification: DataClassification;
  /** 原因模板 */
  reason: string;
}

const DEFAULT_RULES: ClassificationRule[] = [
  // ── 最高优先级：用户明确标记敏感 ────────────────────────────────────────
  {
    name: "user_marked_sensitive",
    userMarkedSensitive: true,
    classification: DataClassification.LOCAL_ONLY,
    reason: "用户明确标记为敏感数据，仅本地处理",
  },

  // ── 高敏感级别：默认不外泄 ──────────────────────────────────────────────
  {
    name: "secret_classification",
    sensitivity: "secret",
    classification: DataClassification.LOCAL_ONLY,
    reason: "绝密级别数据，仅本地处理",
  },
  {
    name: "confidential_no_pii_source_user",
    sensitivity: "confidential",
    source: "user",
    hasPII: true,
    classification: DataClassification.LOCAL_ONLY,
    reason: "用户私密数据（含PII），不暴露给云端",
  },
  {
    name: "confidential_memory",
    sensitivity: "confidential",
    dataType: "memory",
    classification: DataClassification.LOCAL_ONLY,
    reason: "用户记忆数据，不暴露给云端",
  },
  {
    name: "confidential_user_profile",
    sensitivity: "confidential",
    dataType: "user_profile",
    classification: DataClassification.LOCAL_ONLY,
    reason: "用户画像数据，不暴露给云端",
  },

  // ── 任务归档：默认本地 ──────────────────────────────────────────────────
  {
    name: "task_archive",
    dataType: "task_archive",
    classification: DataClassification.LOCAL_ONLY,
    reason: "任务归档含执行细节，默认本地处理",
  },

  // ── 工具结果：区分类型 ──────────────────────────────────────────────────
  {
    name: "tool_result_internal_api",
    dataType: "tool_result",
    source: "system",
    classification: DataClassification.LOCAL_ONLY,
    reason: "内部API结果不外泄",
  },
  {
    name: "tool_result_public_web",
    dataType: "tool_result",
    source: "third_party",
    hasPII: false,
    classification: DataClassification.CLOUD_ALLOWED,
    reason: "公开搜索结果可云端处理",
  },

  // ── 网页内容：区分年龄和PII ─────────────────────────────────────────────
  {
    name: "web_content_public_recent",
    dataType: "web_content",
    source: "third_party",
    hasPII: false,
    maxAgeHours: 1,
    classification: DataClassification.CLOUD_ALLOWED,
    reason: "近期公开网页内容可云端处理",
  },
  {
    name: "web_content_old_or_pii",
    dataType: "web_content",
    source: "third_party",
    classification: DataClassification.LOCAL_SUMMARY_SHAREABLE,
    reason: "旧网页或含PII，仅暴露摘要",
  },

  // ── 对话历史：按年龄区分 ─────────────────────────────────────────────────
  // 注意：规则按顺序匹配，没有 maxAgeHours 的规则会匹配所有剩余情况
  // maxAgeHours 表示"年龄不超过此值"，超过后继续尝试后续规则
  {
    name: "conversation_recent",
    dataType: "conversation_history",
    maxAgeHours: 1,
    classification: DataClassification.CLOUD_ALLOWED,
    reason: "短期对话可云端处理",
  },
  {
    name: "conversation_medium",
    dataType: "conversation_history",
    maxAgeHours: 24,
    classification: DataClassification.LOCAL_SUMMARY_SHAREABLE,
    reason: "中期对话仅摘要暴露",
  },
  {
    name: "conversation_old",
    dataType: "conversation_history",
    // 无 maxAgeHours，表示匹配所有剩余情况
    classification: DataClassification.LOCAL_ONLY,
    reason: "长期对话历史不暴露给云端",
  },

  // ── API 响应：区分是否含PII ─────────────────────────────────────────────
  {
    name: "api_response_public",
    dataType: "api_response",
    source: "third_party",
    hasPII: false,
    classification: DataClassification.CLOUD_ALLOWED,
    reason: "公开API响应可云端处理",
  },
  {
    name: "api_response_pii",
    dataType: "api_response",
    hasPII: true,
    classification: DataClassification.LOCAL_ONLY,
    reason: "含PII的API响应不外泄",
  },

  // ── 默认规则 ────────────────────────────────────────────────────────────
  {
    name: "default_internal",
    sensitivity: "internal",
    classification: DataClassification.LOCAL_SUMMARY_SHAREABLE,
    reason: "内部数据仅摘要暴露",
  },
  {
    name: "default_public",
    sensitivity: "public",
    classification: DataClassification.CLOUD_ALLOWED,
    reason: "公开数据可云端处理",
  },
];

/**
 * DataClassifier — 数据分类器
 *
 * 使用规则引擎，根据 ClassificationContext 决定数据的暴露级别。
 */
export class DataClassifier {
  private rules: ClassificationRule[];

  constructor(rules?: ClassificationRule[]) {
    this.rules = rules ?? DEFAULT_RULES;
  }

  /**
   * 对数据进行分类
   */
  classify(content: unknown, ctx: ClassificationContext): ClassificationResult {
    // 遍历规则表，找到第一条匹配的规则
    for (const rule of this.rules) {
      if (this.matches(ctx, rule)) {
        return {
          classification: rule.classification,
          reason: rule.reason,
          confidence: this.calculateConfidence(ctx, rule),
          hasPII: ctx.hasPII,
          suggestedHandling: this.suggestedHandling(rule.classification),
        };
      }
    }

    // 未匹配任何规则，默认保守处理
    return {
      classification: DataClassification.LOCAL_ONLY,
      reason: "未匹配分类规则，默认本地处理",
      confidence: 0.5,
      hasPII: ctx.hasPII,
      suggestedHandling: "block",
    };
  }

  /**
   * 快速分类（仅返回分类级别）
   */
  classifyQuick(content: unknown, ctx: ClassificationContext): DataClassification {
    return this.classify(content, ctx).classification;
  }

  /**
   * 添加自定义规则
   */
  addRule(rule: ClassificationRule): void {
    // 新规则插入到列表开头（更高优先级）
    this.rules.unshift(rule);
  }

  /**
   * 检查上下文是否匹配规则
   */
  private matches(ctx: ClassificationContext, rule: ClassificationRule): boolean {
    if (rule.dataType !== undefined && rule.dataType !== ctx.dataType) {
      return false;
    }
    if (rule.sensitivity !== undefined && rule.sensitivity !== ctx.sensitivity) {
      return false;
    }
    if (rule.source !== undefined && rule.source !== ctx.source) {
      return false;
    }
    if (rule.hasPII !== undefined && rule.hasPII !== ctx.hasPII) {
      return false;
    }
    if (rule.userMarkedSensitive !== undefined && rule.userMarkedSensitive !== (ctx?.userMarkedSensitive ?? false)) {
      return false;
    }
    if (rule.maxAgeHours !== undefined) {
      const age = ctx.ageHours ?? 0;
      if (age > rule.maxAgeHours) {
        return false;
      }
    }
    return true;
  }

  /**
   * 计算分类置信度
   */
  private calculateConfidence(ctx: ClassificationContext, rule: ClassificationRule): number {
    let confidence = 0.7; // 基础置信度

    // 匹配项越多，置信度越高
    let matchCount = 0;
    const totalChecks = 5; // dataType, sensitivity, source, hasPII, userMarkedSensitive

    if (rule.dataType !== undefined) matchCount++;
    if (rule.sensitivity !== undefined) matchCount++;
    if (rule.source !== undefined) matchCount++;
    if (rule.hasPII !== undefined) matchCount++;
    if (rule.userMarkedSensitive !== undefined) matchCount++;

    confidence = 0.5 + (matchCount / totalChecks) * 0.4;

    // 用户明确标记敏感，提高置信度
    if (ctx.userMarkedSensitive) {
      confidence = Math.min(1.0, confidence + 0.1);
    }

    // 含PII且分类为LOCAL_ONLY，提高置信度
    if (ctx.hasPII && rule.classification === DataClassification.LOCAL_ONLY) {
      confidence = Math.min(1.0, confidence + 0.1);
    }

    return Math.round(confidence * 100) / 100;
  }

  /**
   * 根据分类级别建议处理方式
   */
  private suggestedHandling(classification: DataClassification): ClassificationResult["suggestedHandling"] {
    switch (classification) {
      case DataClassification.LOCAL_ONLY:
        return "block";
      case DataClassification.LOCAL_SUMMARY_SHAREABLE:
        return "summarize";
      case DataClassification.CLOUD_ALLOWED:
        return "expose";
      default:
        return "block";
    }
  }
}

/**
 * 默认实例（全局单例）
 */
let defaultClassifier: DataClassifier | null = null;

export function getDataClassifier(): DataClassifier {
  if (!defaultClassifier) {
    defaultClassifier = new DataClassifier();
  }
  return defaultClassifier;
}
