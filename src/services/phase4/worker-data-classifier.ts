/**
 * WorkerDataClassifier — Sprint 64
 *
 * 职责：Fast Manager 在委托 Worker 前，对用户上下文进行信息分类，
 * 决定哪些信息可以传递给 Worker（脱敏后/原始）、哪些需要主人授权、
 * 哪些绝对不过。
 *
 * 架构位置：Fast Manager → 任务分解 → 信息过滤 → Worker Context
 *
 * 与现有 DataClassifier（cloud/local）的区别：
 *   - 那个回答"数据能不能给云端模型"
 *   - 这个回答"这条信息能不能给这个 Worker"
 */

import { WorkerDataItem, WorkerDataPermission, WorkerContextConfig } from "../../types/worker-delegation.js";
import { getRedactionEngine } from "./redaction-engine.js";

/** 信息类型枚举 */
export type WorkerDataType =
  | "pii"              // 个人身份信息
  | "credential"       // 认证凭证
  | "task_context"     // 任务上下文（可传递）
  | "user_preference"  // 用户偏好（可传递）
  | "external_content" // 外部内容（搜索结果等）
  | "memory_item"      // 记忆项
  | "conversation_history" // 对话历史
  | "file_path"        // 文件路径
  | "api_response"     // API 响应
  | "unknown";

/** 权限级别 */
export type WorkerPermissionLevel =
  | "ALLOW"       // 自动授权，无需确认
  | "IMPORTANT"   // 需主人明确确认
  | "BLOCK";      // 绝对不过

/** 分类规则 */
interface WorkerClassificationRule {
  name: string;
  dataType?: WorkerDataType;
  /** 正则匹配字段名 */
  fieldPattern?: RegExp;
  /** 正则匹配值内容 */
  valuePattern?: RegExp;
  permission: WorkerPermissionLevel;
  reason: string;
  /** 脱敏方式（BLOCK 时不适用） */
  redaction?: "none" | "mask" | "hash" | "truncate" | "replace";
}

/** 默认规则表（优先级从上到下） */
const DEFAULT_CLASSIFICATION_RULES: WorkerClassificationRule[] = [
  // ── BLOCK: 最高优先级 ───────────────────────────────────────────────
  {
    name: "password_field",
    fieldPattern: /^(password|passwd|pwd|secret|api_key|apiKey|apikey|token|access_token|accessToken|bearer)$/i,
    permission: "BLOCK",
    reason: "密码/密钥字段绝对不过 Worker",
  },
  {
    name: "id_card",
    fieldPattern: /^(id_card|idcard|证件号|certificate|护照号|passport|ssn|身份证)$/i,
    permission: "BLOCK",
    reason: "身份证件号绝对不过 Worker",
  },
  {
    name: "bank_card",
    fieldPattern: /^(bank_card|card_number|银行卡|card_no|credit_card)$/i,
    permission: "BLOCK",
    reason: "银行卡号绝对不过 Worker",
  },
  {
    name: "phone_full",
    fieldPattern: /^(phone|tel|mobile|手机|电话)$/i,
    permission: "BLOCK",
    reason: "完整手机号绝对不过 Worker",
  },
  {
    name: "address_full",
    fieldPattern: /^(address|home_address|居住地址|详细地址)$/i,
    permission: "BLOCK",
    reason: "详细地址绝对不过 Worker",
  },

  // ── IMPORTANT: 需主人确认 ──────────────────────────────────────────
  {
    name: "email",
    fieldPattern: /^(email|mail|e?mail)$/i,
    permission: "IMPORTANT",
    reason: "邮箱地址用于账号相关操作，需主人确认",
    redaction: "mask",
  },
  {
    name: "name_field",
    fieldPattern: /^(name|username|nickname|real_name|姓名|名字|真实姓名)$/i,
    permission: "IMPORTANT",
    reason: "姓名用于账号注册等操作，需主人确认",
    redaction: "mask",
  },
  {
    name: "id_partial",
    fieldPattern: /^(证件号后四位|id_last4|尾号)$/i,
    permission: "IMPORTANT",
    reason: "证件尾号用于验证，需主人确认",
    redaction: "none",
  },

  // ── ALLOW: 自动授权 ────────────────────────────────────────────────
  {
    name: "destination",
    fieldPattern: /^(destination|目的地|target|目标地点|旅游目的地|目的地城市)$/i,
    permission: "ALLOW",
    reason: "目的地信息是任务上下文，自动传递",
    redaction: "none",
  },
  {
    name: "budget",
    fieldPattern: /^(budget|预算|花费上限|价格区间|预算范围)$/i,
    permission: "ALLOW",
    reason: "预算信息是任务上下文，自动传递",
    redaction: "none",
  },
  {
    name: "travel_date",
    fieldPattern: /^(date|出发日期|开始日期|结束日期|travel_date|departure|return_date)$/i,
    permission: "ALLOW",
    reason: "日期信息是任务上下文，自动传递",
    redaction: "none",
  },
  {
    name: "preference_hobby",
    fieldPattern: /^(preference|偏好|hobby|爱好|favorite|喜好|口味|preferred)$/i,
    permission: "ALLOW",
    reason: "用户偏好信息可传递给 Worker 用于个性化结果",
    redaction: "none",
  },
  {
    name: "task_description",
    fieldPattern: /^(task|任务|description|描述|目标|goal|requirement|需求)$/i,
    permission: "ALLOW",
    reason: "任务描述是 Worker 执行的核心输入",
    redaction: "none",
  },
  {
    name: "search_result",
    dataType: "external_content",
    permission: "ALLOW",
    reason: "搜索结果等外部内容可传递给 Worker",
    redaction: "none",
  },
  {
    name: "web_content",
    dataType: "external_content",
    permission: "ALLOW",
    reason: "网页内容可传递给 Worker",
    redaction: "none",
  },

  // ── 兜底 ──────────────────────────────────────────────────────────
  {
    name: "default_block",
    permission: "BLOCK",
    reason: "未匹配规则，默认保守处理",
  },
];

/** 分类结果 */
export interface WorkerClassificationResult {
  permission: WorkerPermissionLevel;
  reason: string;
  redaction: "none" | "mask" | "hash" | "truncate" | "replace";
  /** 脱敏后的值（如果需要脱敏） */
  redactedValue?: unknown;
  /** 是否触发授权请求 */
  needsPermissionRequest: boolean;
  /** 授权请求消息（供 Fast 生成给主人的确认框） */
  permissionRequestMessage?: string;
}

/**
 * WorkerDataClassifier — Worker 信息分类器
 *
 * 规则匹配顺序：
 * 1. fieldPattern（字段名正则）优先
 * 2. dataType 兜底
 * 3. 全局兜底
 */
export class WorkerDataClassifier {
  private rules: WorkerClassificationRule[];
  private redactionEngine = getRedactionEngine();

  constructor(rules?: WorkerClassificationRule[]) {
    this.rules = rules ?? DEFAULT_CLASSIFICATION_RULES;
  }

  /**
   * 对单个数据项进行分类
   */
  classifyItem(key: string, value: unknown, dataType?: WorkerDataType): WorkerClassificationResult {
    // 优先按字段名匹配
    for (const rule of this.rules) {
      if (rule.fieldPattern && rule.fieldPattern.test(key)) {
        return this.buildResult(rule, value);
      }
    }

    // 按数据类型兜底
    if (dataType) {
      for (const rule of this.rules) {
        if (rule.dataType === dataType && !rule.fieldPattern) {
          return this.buildResult(rule, value);
        }
      }
    }

    // 默认兜底
    return this.buildResult(
      this.rules[this.rules.length - 1],
      value
    );
  }

  /**
   * 对整个上下文对象进行分类
   * 返回：允许传递的字段 + 需要授权的字段 + 拦截的字段
   */
  classifyContext(
    context: Record<string, unknown>,
    config: WorkerContextConfig
  ): {
    allowed: WorkerDataItem[];
    needsApproval: WorkerDataItem[];
    blocked: string[];
    permissionRequests: Array<{ item: WorkerDataItem; message: string }>;
  } {
    const allowed: WorkerDataItem[] = [];
    const needsApproval: WorkerDataItem[] = [];
    const blocked: string[] = [];
    const permissionRequests: Array<{ item: WorkerDataItem; message: string }> = [];

    for (const [key, value] of Object.entries(context)) {
      // 跳过 Fast 内部字段
      if (key.startsWith("_") || key === "__meta") continue;

      const result = this.classifyItem(key, value);

      if (result.permission === "ALLOW") {
        const redactedValue = result.redactedValue ?? value;
        allowed.push({
          key,
          value: redactedValue,
          permission: "ALLOW",
          reason: result.reason,
        });
      } else if (result.permission === "IMPORTANT") {
        const item: WorkerDataItem = {
          key,
          value: result.redactedValue ?? value,
          permission: "IMPORTANT",
          reason: result.reason,
        };
        needsApproval.push(item);
        if (result.needsPermissionRequest) {
          permissionRequests.push({ item, message: result.permissionRequestMessage! });
        }
      } else {
        // BLOCK — 脱敏但不传递
        blocked.push(key);
        if (config.auditEnabled) {
          // 记录到审计日志（由调用方负责，这里返回元数据）
        }
      }
    }

    return { allowed, needsApproval, blocked, permissionRequests };
  }

  /**
   * 根据字段名批量判断某类数据是否需要主人授权
   * 用于 Worker 主动声明需要某类信息时
   */
  requiresApproval(fieldPattern: string): boolean {
    const regex = new RegExp(fieldPattern, "i");
    for (const rule of this.rules) {
      if (rule.fieldPattern && rule.fieldPattern.test(fieldPattern)) {
        return rule.permission === "IMPORTANT";
      }
    }
    return false;
  }

  private buildResult(rule: WorkerClassificationRule, value: unknown): WorkerClassificationResult {
    const needsRequest = rule.permission === "IMPORTANT";

    let redactedValue: unknown = undefined;
    if (rule.permission !== "BLOCK" && rule.redaction && rule.redaction !== "none") {
      redactedValue = this.applyRedaction(value, rule.redaction);
    }

    return {
      permission: rule.permission,
      reason: rule.reason,
      redaction: rule.redaction ?? "none",
      redactedValue,
      needsPermissionRequest: needsRequest,
      permissionRequestMessage: needsRequest
        ? `【授权确认】Worker 需访问你的「${rule.fieldPattern?.toString() ?? rule.name}」字段（${rule.reason}）。`
        : undefined,
    };
  }

  private applyRedaction(value: unknown, type: "mask" | "hash" | "truncate" | "replace"): unknown {
    if (typeof value === "string") {
      switch (type) {
        case "mask":
          return this.maskString(value);
        case "hash":
          return this.simpleHash(value);
        case "truncate":
          return value.substring(0, 20) + "...";
        case "replace":
          return "[已脱敏]";
      }
    }
    return value;
  }

  private maskString(value: string): string {
    if (value.length <= 2) return "*".repeat(value.length);
    return value[0] + "*".repeat(value.length - 2) + value[value.length - 1];
  }

  private simpleHash(value: string): string {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      hash = (hash << 5) - hash + value.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(8, "0");
  }
}

let globalClassifier: WorkerDataClassifier | null = null;

export function getWorkerDataClassifier(): WorkerDataClassifier {
  if (!globalClassifier) {
    globalClassifier = new WorkerDataClassifier();
  }
  return globalClassifier;
}
