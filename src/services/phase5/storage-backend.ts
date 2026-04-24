/**
 * Phase 5 — Storage Backend Interface
 *
 * 定义 Archive 存储的抽象接口，支持多种后端。
 * 后端通过 STORAGE_BACKEND 环境变量选择。
 */

import { createHash } from "crypto";

// ── Local Storage Config ──────────────────────────────────────────────────────

/** 本地文件系统存储配置 */
export interface LocalArchiveConfig {
  basePath: string;
  maxFileSize?: number;   // 最大单个文件大小（字节）
  compress?: boolean;     // 是否压缩存储
  maxAgeDays?: number;    // 自动清理超过N天的档案
}

// ── Core Types ────────────────────────────────────────────────────────────────

/** 所有后端必须实现的存储接口 */
export interface IArchiveStorage {
  /** 保存 archive，返回 archiveId */
  save(doc: ArchiveDocument): Promise<string>;

  /** 按 ID 读取 */
  getById(id: string): Promise<ArchiveDocument | null>;

  /** 按 session + user 读取最新 */
  getBySession(sessionId: string, userId: string): Promise<ArchiveDocument | null>;

  /** 更新 archive */
  update(id: string, updates: Partial<ArchiveDocument>): Promise<boolean>;

  /** 更新命令状态 */
  updateCommandStatus(id: string, status: string, result?: unknown): Promise<boolean>;

  /** 删除 archive */
  delete(id: string): Promise<boolean>;

  /** 列出 session 的所有 archives */
  listBySession(sessionId: string, userId: string): Promise<ArchiveDocument[]>;

  /** 健康检查 */
  ping(): Promise<boolean>;
}

/** 语义搜索查询接口 */
export interface IArchiveQuery {
  /** 语义搜索 */
  searchByEmbedding(
    userId: string,
    embedding: number[],
    topK?: number,
    filters?: SearchFilters
  ): Promise<SearchResult[]>;

  /** 关键词搜索 */
  searchByKeyword(
    userId: string,
    keyword: string,
    limit?: number
  ): Promise<SearchResult[]>;
}

export interface SearchFilters {
  sessionId?: string;
  taskType?: string;
  state?: string;
  fromDate?: string;
  toDate?: string;
}

export interface SearchResult {
  archiveId: string;
  sessionId: string;
  userId: string;
  userInput: string;
  taskBrief?: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  similarity?: number;
  highlight?: string;
}

// ── Archive Document ──────────────────────────────────────────────────────────

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

// ── Factory ───────────────────────────────────────────────────────────────────

export type StorageBackendType = "local" | "s3" | "pg";

/**
 * 统一入口 — 根据 STORAGE_BACKEND 环境变量创建后端实例。
 *
 * 用法：
 *   const store = await createArchiveStore();
 *   const id = await store.save(doc);
 *
 * @param type 可选：强制指定后端类型（用于测试）。不传则读 STORAGE_BACKEND 环境变量。
 */
export async function createArchiveStore(type?: StorageBackendType): Promise<IArchiveStorage> {
  const backend = type ?? (process.env.STORAGE_BACKEND ?? "local") as StorageBackendType;

  switch (backend) {
    case "s3": {
      const { S3ArchiveStorage } = await import("./s3-archive-storage.js");
      return new S3ArchiveStorage({
        bucket: process.env.S3_BUCKET ?? "smartrouter-archives",
        region: process.env.S3_REGION ?? "us-east-1",
        endpoint: process.env.S3_ENDPOINT,
        accessKeyId: process.env.S3_ACCESS_KEY ?? "",
        secretAccessKey: process.env.S3_SECRET_KEY ?? "",
        prefix: process.env.S3_PREFIX ?? "archives/",
      });
    }

    case "pg": {
      const { PGArchiveStorage } = await import("./pg-archive-storage.js");
      return new PGArchiveStorage();
    }

    case "local":
    default: {
      const { LocalArchiveStorage } = await import("./local-archive-store.js");
      return new LocalArchiveStorage({
        basePath: process.env.LOCAL_ARCHIVE_PATH ?? "./data/archive",
        compress: process.env.LOCAL_ARCHIVE_COMPRESS === "true",
      });
    }
  }
}

/**
 * 统一入口 — 创建查询后端（支持语义搜索）。
 * 目前只有 PG 后端实现了语义搜索。
 */
export async function createArchiveQuery(): Promise<IArchiveQuery> {
  const type = (process.env.STORAGE_BACKEND ?? "local") as StorageBackendType;

  if (type === "pg") {
    const { PGArchiveQuery } = await import("./pg-archive-storage.js");
    return new PGArchiveQuery();
  }

  // local/s3 只提供基础存储，不支持语义搜索
  // 返回空实现
  return {
    searchByEmbedding: async () => [],
    searchByKeyword: async () => [],
  };
}

// ── Embedding Utilities ───────────────────────────────────────────────────────

/** 计算文本的语义 ID（用于路由到特定 archive） */
export function computeContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}
