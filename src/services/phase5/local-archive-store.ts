/**
 * Phase 5 — Local Archive Store
 *
 * 本地文件系统存储后端，作为 PostgreSQL 的可选替代。
 * 用于：数据主权要求 / 离线场景 / 低延迟需求。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { v4 as uuid } from "uuid";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface LocalArchiveConfig {
  /** 存储根目录 */
  basePath: string;
  /** 最大单文件大小（字节），默认 10MB */
  maxFileSize?: number;
  /** 是否启用压缩（默认 false） */
  compress?: boolean;
}

export interface ArchiveDocument {
  id: string;
  task_id?: string;
  session_id: string;
  user_id: string;
  manager_decision: unknown;
  command?: unknown;
  user_input: string;
  task_brief?: string;
  goal?: string;
  state: string;
  status: string;
  constraints: Record<string, unknown>;
  fast_observations: unknown[];
  slow_execution: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ── LocalArchiveStore ──────────────────────────────────────────────────────────

/**
 * 本地文件系统 Archive 存储
 */
export class LocalArchiveStore {
  private basePath: string;
  private maxFileSize: number;
  private compress: boolean;

  constructor(config: LocalArchiveConfig) {
    this.basePath = config.basePath;
    this.maxFileSize = config.maxFileSize ?? 10 * 1024 * 1024; // 10MB
    this.compress = config.compress ?? false;

    // 确保目录存在
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
    }
  }

  /**
   * 获取 session 目录路径
   */
  private getSessionDir(sessionId: string, userId: string): string {
    // 按 userId/sessionId 组织目录结构
    return join(this.basePath, userId, sessionId);
  }

  /**
   * 获取 archive 文件路径
   */
  private getArchivePath(sessionDir: string, archiveId: string): string {
    return join(sessionDir, `${archiveId}.json`);
  }

  /**
   * 创建新的 Archive 记录
   */
  async create(input: {
    task_id?: string;
    session_id: string;
    user_id: string;
    decision: unknown;
    user_input: string;
    task_brief?: string;
    goal?: string;
  }): Promise<{ id: string }> {
    const id = uuid();
    const sessionDir = this.getSessionDir(input.session_id, input.user_id);

    // 确保目录存在
    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }

    const now = new Date().toISOString();
    const document: ArchiveDocument = {
      id,
      task_id: input.task_id,
      session_id: input.session_id,
      user_id: input.user_id,
      manager_decision: input.decision,
      command: (input.decision as { command?: unknown })?.command,
      user_input: input.user_input,
      task_brief: input.task_brief,
      goal: input.goal,
      state: "delegated",
      status: "pending",
      constraints: {},
      fast_observations: [],
      slow_execution: {},
      created_at: now,
      updated_at: now,
    };

    const filePath = this.getArchivePath(sessionDir, id);
    writeFileSync(filePath, JSON.stringify(document, null, 2), "utf-8");

    return { id };
  }

  /**
   * 按 session_id 读取最新的 Archive
   */
  async getBySession(
    sessionId: string,
    userId: string
  ): Promise<ArchiveDocument | null> {
    const sessionDir = this.getSessionDir(sessionId, userId);

    if (!existsSync(sessionDir)) {
      return null;
    }

    // 查找所有 .json 文件并按修改时间排序
    const files = readdirSync(sessionDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({
        name: f,
        path: join(sessionDir, f),
        mtime: statSync(join(sessionDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) {
      return null;
    }

    try {
      const content = readFileSync(files[0].path, "utf-8");
      return JSON.parse(content) as ArchiveDocument;
    } catch {
      return null;
    }
  }

  /**
   * 按 ID 读取 Archive
   */
  async getById(id: string): Promise<ArchiveDocument | null> {
    // 搜索所有子目录
    return this.findByIdRecursive(this.basePath, id);
  }

  private findByIdRecursive(dir: string, id: string): ArchiveDocument | null {
    if (!existsSync(dir)) {
      return null;
    }

    try {
      const entries = readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          const result = this.findByIdRecursive(fullPath, id);
          if (result) return result;
        } else if (entry.isFile() && entry.name === `${id}.json`) {
          const content = readFileSync(fullPath, "utf-8");
          return JSON.parse(content) as ArchiveDocument;
        }
      }
    } catch {
      // 忽略权限错误
    }

    return null;
  }

  /**
   * 更新 Archive
   */
  async update(
    id: string,
    updates: Partial<Omit<ArchiveDocument, "id" | "created_at">>
  ): Promise<boolean> {
    const doc = await this.getById(id);
    if (!doc) {
      return false;
    }

    const updated: ArchiveDocument = {
      ...doc,
      ...updates,
      id: doc.id, // 保持 ID 不变
      created_at: doc.created_at, // 创建时间不变
      updated_at: new Date().toISOString(),
    };

    const sessionDir = this.getSessionDir(doc.session_id, doc.user_id);
    const filePath = join(sessionDir, `${id}.json`);

    writeFileSync(filePath, JSON.stringify(updated, null, 2), "utf-8");
    return true;
  }

  /**
   * 更新命令状态
   */
  async updateCommandStatus(
    id: string,
    status: string,
    result?: unknown
  ): Promise<boolean> {
    const updates: Partial<ArchiveDocument> = { status };

    if (result) {
      updates.slow_execution = result as Record<string, unknown>;
    }

    return this.update(id, updates);
  }

  /**
   * 删除 Archive
   */
  async delete(id: string): Promise<boolean> {
    const doc = await this.getById(id);
    if (!doc) {
      return false;
    }

    const sessionDir = this.getSessionDir(doc.session_id, doc.user_id);
    const filePath = join(sessionDir, `${id}.json`);

    if (existsSync(filePath)) {
      unlinkSync(filePath);
      return true;
    }

    return false;
  }

  /**
   * 列出 session 的所有 Archive
   */
  async listBySession(
    sessionId: string,
    userId: string
  ): Promise<ArchiveDocument[]> {
    const sessionDir = this.getSessionDir(sessionId, userId);

    if (!existsSync(sessionDir)) {
      return [];
    }

    try {
      const files = readdirSync(sessionDir).filter((f) => f.endsWith(".json"));

      return files
        .map((f) => {
          try {
            const content = readFileSync(join(sessionDir, f), "utf-8");
            return JSON.parse(content) as ArchiveDocument;
          } catch {
            return null;
          }
        })
        .filter((doc): doc is ArchiveDocument => doc !== null)
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
    } catch {
      return [];
    }
  }

  /**
   * 获取存储统计信息
   */
  async getStats(): Promise<{
    totalArchives: number;
    totalSize: number;
    sessionsCount: number;
  }> {
    let totalArchives = 0;
    let totalSize = 0;
    const sessions = new Set<string>();

    this.collectStats(this.basePath, { totalArchives, totalSize, sessions });

    return {
      totalArchives,
      totalSize,
      sessionsCount: sessions.size,
    };
  }

  private collectStats(
    dir: string,
    stats: { totalArchives: number; totalSize: number; sessions: Set<string> }
  ): void {
    if (!existsSync(dir)) {
      return;
    }

    try {
      const entries = readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          this.collectStats(fullPath, stats);
        } else if (entry.isFile() && entry.name.endsWith(".json")) {
          stats.totalArchives++;
          try {
            const stat = readFileSync(fullPath);
            stats.totalSize += stat.length;
          } catch {
            // 忽略
          }
        }
      }
    } catch {
      // 忽略权限错误
    }
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export type ArchiveStoreType = "postgresql" | "local";

export interface ArchiveStore {
  create(input: {
    task_id?: string;
    session_id: string;
    user_id: string;
    decision: unknown;
    user_input: string;
    task_brief?: string;
    goal?: string;
  }): Promise<{ id: string }>;

  getBySession(sessionId: string, userId: string): Promise<unknown | null>;
  getById(id: string): Promise<unknown | null>;
  update(id: string, updates: unknown): Promise<boolean>;
  updateCommandStatus(id: string, status: string, result?: unknown): Promise<boolean>;
  delete(id: string): Promise<boolean>;
  listBySession(sessionId: string, userId: string): Promise<unknown[]>;
}

/**
 * 创建 Archive Store 实例
 */
export function createArchiveStore(type: ArchiveStoreType = "postgresql"): ArchiveStore {
  switch (type) {
    case "local":
      return new LocalArchiveStore({
        basePath: process.env.LOCAL_ARCHIVE_PATH ?? "./data/archive",
        compress: process.env.LOCAL_ARCHIVE_COMPRESS === "true",
      });

    case "postgresql":
    default:
      // 返回 PostgreSQL 实现（TaskArchiveRepo）
      // 注意：这里需要导入实际的 repo
      throw new Error(
        "PostgreSQL archive store requires TaskArchiveRepo. Import from 'db/task-archive-repo.js'"
      );
  }
}
