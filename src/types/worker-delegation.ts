/**
 * Sprint 64 类型扩展：Worker 授权与委托
 *
 * 核心概念：
 * - WorkerDataItem: Worker 可以访问的数据项
 * - PermissionRequest: 需要主人确认的授权请求
 * - TaskWorkspace: 跨 Worker 协作工作空间
 * - WorkerContextConfig: Worker Context 构建配置
 * - ScopedToken: 受限访问令牌
 */

// ── 数据权限 ────────────────────────────────────────────────────────────────

/** 传递给 Worker 的单个数据项 */
export interface WorkerDataItem {
  key: string;
  value: unknown;
  permission: "ALLOW" | "IMPORTANT" | "BLOCK";
  reason: string;
}

/** 权限请求状态 */
export type PermissionRequestStatus =
  | "pending"    // 等待主人确认
  | "approved"   // 主人已批准
  | "denied"     // 主人已拒绝
  | "expired";   // 超时未处理

/** 权限请求记录 */
export interface PermissionRequest {
  id: string;
  task_id: string;
  worker_id: string;
  user_id: string;
  session_id: string;

  /** 请求访问的字段名 */
  field_name: string;
  /** 字段用途描述 */
  purpose: string;
  /** 脱敏后的值预览（主人看到的是这个，不是原始值） */
  value_preview?: string;

  status: PermissionRequestStatus;
  /** 有效期（秒） */
  expires_in: number;
  created_at: string;
  resolved_at?: string;
  resolved_by?: string;
  /** 批准的 scope（精确到具体字段+用途） */
  approved_scope?: string;
}

// ── Task Workspace ──────────────────────────────────────────────────────────

/** 任务工作空间（跨 Worker 共享） */
export interface TaskWorkspace {
  id: string;
  task_id: string;
  user_id: string;
  session_id: string;

  /** 任务目标（Fast 写） */
  objective: string;
  /** 约束条件（Fast 写，已脱敏） */
  constraints: string[];
  /** 各 Worker 进展 */
  progress: Record<string, string>;
  /** Worker 共享产出（可被其他 Worker 消费） */
  shared_outputs: Record<string, unknown>;
  /** 访问日志 */
  access_log: WorkspaceAccessRecord[];

  created_at: string;
  updated_at: string;
}

/** 工作空间访问记录 */
export interface WorkspaceAccessRecord {
  worker_id: string;
  action: "read" | "write" | "read_write";
  keys: string[];
  timestamp: string;
}

// ── Context 构建 ────────────────────────────────────────────────────────────

/** Worker Context 构建配置 */
export interface WorkerContextConfig {
  workerId: string;
  taskId: string;
  userId: string;
  sessionId: string;
  /** Fast 是否已经持有主人授权 */
  preApprovedFields?: string[];
  /** 是否启用审计日志 */
  auditEnabled?: boolean;
}

/** Worker Context 注入结果 */
export interface WorkerContextInjection {
  /** 允许传递给 Worker 的上下文 */
  allowedContext: Record<string, unknown>;
  /** 权限请求列表（需要主人确认） */
  pendingPermissionRequests: PermissionRequest[];
  /** 被拦截的字段（Worker 看不到） */
  blockedFields: string[];
  /** 审计日志 */
  auditLog: WorkerAuditEntry[];
  /** Worker 可见的共享工作空间 ID */
  workspaceId?: string;
}

/** Worker 审计条目 */
export interface WorkerAuditEntry {
  timestamp: string;
  worker_id: string;
  action: "read" | "blocked" | "request";
  field_key: string;
  reason: string;
}

// ── Access Channel ──────────────────────────────────────────────────────────

/** Worker 访问外部资源的通道类型 */
export type AccessChannelType =
  | "none"           // 无访问权限
  | "proxy"          // Fast 代理（Worker 不见凭证）
  | "scoped_token";  // 受限令牌（限 scope/时间）

/** 受限访问令牌 */
export interface ScopedAccessToken {
  token: string;
  scope: string[];
  expiresAt: string;
  taskId: string;
  workerId: string;
}

/** Worker 的外部资源访问权限 */
export interface WorkerExternalAccess {
  workerId: string;
  taskId: string;
  channels: Record<string, AccessChannelType>;
  scopedTokens?: ScopedAccessToken[];
}

// ── Worker Prompt Section ──────────────────────────────────────────────────

/** Worker Prompt 模板变量 */
export interface WorkerPromptContext {
  taskObjective: string;
  taskConstraints: string[];
  workspaceData: Record<string, unknown>;
  previousWorkerOutputs: Record<string, unknown>;
  accessChannel: "proxy" | "none";
  allowedFieldCount: number;
  blockedFieldCount: number;
}
