/**
 * PermissionChecker — Phase 4.1 权限校验器
 *
 * 职责：根据 PermissionContext 决定是否允许数据暴露。
 * 基于 DataClassification 和用户偏好做最终决策。
 */

import {
  DataClassification,
  PermissionContext,
  PermissionResult,
  UserDataPreferences,
} from "../../types";

/**
 * Feature Flag 常量
 */
export const FEATURE_FLAGS = {
  PERMISSION_LAYER: "use_permission_layer",
  DATA_CLASSIFICATION: "use_data_classification",
  CLOUD_MEMORY: "allow_cloud_memory",
  CLOUD_HISTORY: "allow_cloud_conversation_history",
  CLOUD_TOOLS: "allow_cloud_tool_results",
} as const;

/**
 * PermissionChecker — 权限校验器
 */
export class PermissionChecker {
  /**
   * 检查是否允许暴露数据
   */
  check(ctx: PermissionContext): PermissionResult {
    // ── Step 1: Feature Flag 检查 ──────────────────────────────────────
    if (!this.isPermissionLayerEnabled(ctx.featureFlags)) {
      // Feature Flag 未开启，放行（向后兼容）
      return {
        allowed: true,
        tier: DataClassification.CLOUD_ALLOWED,
        reason: "Permission Layer 未启用，使用默认策略",
        fallbackAction: "allow",
      };
    }

    // ── Step 2: 本地模型总是允许 ────────────────────────────────────────
    if (ctx.targetModel === "local_7b") {
      return {
        allowed: true,
        tier: DataClassification.LOCAL_ONLY,
        reason: "目标为本地模型，不涉及数据外泄",
        fallbackAction: "allow",
      };
    }

    // ── Step 3: 用户偏好检查 ────────────────────────────────────────────
    const userOverride = this.checkUserPreferences(ctx);
    if (userOverride) {
      return userOverride;
    }

    // ── Step 4: 分类级别决策 ────────────────────────────────────────────
    return this.decideByClassification(ctx);
  }

  /**
   * 快速检查（仅返回是否允许）
   */
  checkQuick(ctx: PermissionContext): boolean {
    return this.check(ctx).allowed;
  }

  /**
   * 检查 Permission Layer 是否启用
   */
  private isPermissionLayerEnabled(flags: Record<string, boolean>): boolean {
    return flags[FEATURE_FLAGS.PERMISSION_LAYER] === true;
  }

  /**
   * 检查用户偏好
   */
  private checkUserPreferences(ctx: PermissionContext): PermissionResult | null {
    const prefs = ctx.userDataPreferences;
    if (!prefs) {
      return null;
    }

    // 用户禁止云端访问对话历史
    if (
      prefs.allowCloudConversationHistory === false &&
      ctx.requestedTier === DataClassification.CLOUD_ALLOWED
    ) {
      return {
        allowed: false,
        tier: DataClassification.LOCAL_ONLY,
        reason: "用户禁止云端访问对话历史",
        fallbackAction: "summarize",
        summaryMaxLength: 500,
      };
    }

    // 用户禁止云端访问记忆
    if (
      prefs.allowCloudMemory === false &&
      ctx.requestedTier === DataClassification.CLOUD_ALLOWED
    ) {
      return {
        allowed: false,
        tier: DataClassification.LOCAL_ONLY,
        reason: "用户禁止云端访问记忆",
        fallbackAction: "summarize",
        summaryMaxLength: 300,
      };
    }

    // 用户禁止云端访问工具结果
    if (
      prefs.allowCloudToolResults === false &&
      ctx.requestedTier === DataClassification.CLOUD_ALLOWED
    ) {
      return {
        allowed: false,
        tier: DataClassification.LOCAL_ONLY,
        reason: "用户禁止云端访问工具结果",
        fallbackAction: "redact",
      };
    }

    return null;
  }

  /**
   * 根据分类级别做最终决策
   */
  private decideByClassification(ctx: PermissionContext): PermissionResult {
    const tier = ctx.requestedTier;

    switch (tier) {
      case DataClassification.LOCAL_ONLY:
        return {
          allowed: false,
          tier: DataClassification.LOCAL_ONLY,
          reason: "数据分类为 LOCAL_ONLY，不允许云端访问",
          fallbackAction: "summarize",
          summaryMaxLength: 300,
        };

      case DataClassification.LOCAL_SUMMARY_SHAREABLE:
        return {
          allowed: true,
          tier: DataClassification.LOCAL_SUMMARY_SHAREABLE,
          reason: "数据分类为 LOCAL_SUMMARY_SHAREABLE，仅暴露摘要",
          fallbackAction: "summarize",
          summaryMaxLength: 500,
        };

      case DataClassification.CLOUD_ALLOWED:
        return {
          allowed: true,
          tier: DataClassification.CLOUD_ALLOWED,
          reason: "数据分类为 CLOUD_ALLOWED，允许云端处理",
          fallbackAction: "allow",
        };

      default:
        return {
          allowed: false,
          tier: DataClassification.LOCAL_ONLY,
          reason: "未知分类级别，默认拒绝",
          fallbackAction: "reject",
        };
    }
  }

  /**
   * 从分类结果生成权限上下文
   */
  static fromClassification(
    classification: DataClassification,
    ctx: PermissionContext
  ): PermissionResult {
    const checker = new PermissionChecker();
    return checker.check({
      ...ctx,
      requestedTier: classification,
    });
  }
}

/**
 * 便捷函数：快速权限检查
 */
export function quickPermissionCheck(
  userId: string,
  sessionId: string,
  flags: Record<string, boolean>
): boolean {
  const checker = new PermissionChecker();
  return checker.checkQuick({
    userId,
    sessionId,
    requestedTier: DataClassification.CLOUD_ALLOWED,
    featureFlags: flags,
    targetModel: "cloud_72b",
  });
}

/**
 * 默认实例（全局单例）
 */
let defaultChecker: PermissionChecker | null = null;

export function getPermissionChecker(): PermissionChecker {
  if (!defaultChecker) {
    defaultChecker = new PermissionChecker();
  }
  return defaultChecker;
}
