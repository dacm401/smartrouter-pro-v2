/**
 * Phase 5 — Archive Storage
 *
 * 支持多种存储后端：
 * - local: 本地文件系统（数据主权/离线场景）
 * - s3: S3 兼容存储（AWS S3 / MinIO / Cloudflare R2）
 * - pg: PostgreSQL（默认，语义搜索支持）
 */

// Re-export local implementation (for backward compatibility)
export {
  LocalArchiveStorage,
} from "./local-archive-store";
export type {
  LocalArchiveConfig,
} from "./storage-backend.js";

// Re-export IArchiveStorage as ArchiveStore for backward compatibility
export type {
  IArchiveStorage as ArchiveStore,
  StorageBackendType as ArchiveStoreType,
} from "./storage-backend.js";

// Re-export ArchiveDocument (shared type)
export type {
  ArchiveDocument,
  IArchiveStorage,
  IArchiveQuery,
  StorageBackendType,
  SearchFilters,
  SearchResult,
} from "./storage-backend";

// Export storage backend factory
export { createArchiveStore, createArchiveQuery } from "./storage-backend";

// Export S3 implementation
export { S3ArchiveStorage } from "./s3-archive-storage";
export type { S3ArchiveConfig } from "./s3-archive-storage";

// Export PG implementations
export { PGArchiveStorage, PGArchiveQuery } from "./pg-archive-storage";

// Export TTL eviction
export { runEviction, startEvictionScheduler } from "./ttl-eviction";
export type { EvictionConfig, EvictionResult } from "./ttl-eviction";

// Export storage registry (singleton getter)
export { getIArchiveStorage, getStorageType } from "./storage-registry";
