/**
 * Phase 5 — TTL Eviction
 *
 * 定期清理过期 archive，支持两种模式：
 * 1. Local/S3: 扫描文件修改时间（mtime）删除过期文件
 * 2. PG: SQL DELETE WHERE updated_at < NOW() - INTERVAL 'N days'
 *
 * 使用方式：
 *   // 同步调用（适用于 cron / scheduled job）
 *   const result = await runEviction({ ttlDays: 30, dryRun: false });
 *
 *   // 异步后台（不阻塞主线程）
 *   runEviction({ ttlDays: 30 }).catch(console.error);
 */

import { getIArchiveStorage } from "./storage-registry.js";
import { query } from "../../db/connection.js";
import { rm, readdir, stat } from "fs/promises";
import { join } from "path";
import type { IArchiveStorage } from "./storage-backend.js";

// ── Config ────────────────────────────────────────────────────────────────────

export interface EvictionConfig {
  /** 超过 N 天未更新的 archive 视为过期 */
  ttlDays: number;
  /** true = 只统计不删除，用于预览 */
  dryRun?: boolean;
  /** 只清理指定 userId 的 archive（可选） */
  userId?: string;
  /** Local 后端时指定目录路径 */
  localPath?: string;
}

export interface EvictionResult {
  scanned: number;
  expired: number;
  deleted: number;
  errors: string[];
  durationMs: number;
  dryRun: boolean;
}

// ── Main Entry ────────────────────────────────────────────────────────────────

export async function runEviction(
  config: EvictionConfig
): Promise<EvictionResult> {
  const start = Date.now();
  const { ttlDays, dryRun = false, userId, localPath } = config;

  const storage = await getIArchiveStorage();
  const type = (process.env.STORAGE_BACKEND ?? "local") as string;

  let scanned = 0;
  let expired = 0;
  let deleted = 0;
  const errors: string[] = [];

  // TTL=0 = 不过期，跳过扫描
  if (ttlDays <= 0) {
    return { scanned: 0, expired: 0, deleted: 0, errors: [], durationMs: Date.now() - start, dryRun };
  }

  const cutoff = new Date(Date.now() - ttlDays * 86_400_000);

  if (type === "pg") {
    // PG: SQL 批量删除（按 updated_at）
    try {
      const rows = await listExpiredPG(userId, cutoff);
      expired = rows.length;
      scanned = expired; // PG 没有前置 count

      if (!dryRun && expired > 0) {
        for (const row of rows) {
          try {
            const ok = await storage.delete(row.id);
            if (ok) deleted++;
          } catch (e: unknown) {
            errors.push(`delete ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }
    } catch (e: unknown) {
      errors.push(`PG eviction: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else if (type === "local") {
    // Local: 递归扫描文件 mtime
    const base = localPath ?? process.env.LOCAL_ARCHIVE_PATH ?? "./data/archive";

    const scanDir = async (dir: string) => {
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        return;
      }

      for (const entry of entries) {
        const full = join(dir, entry);
        let st: Awaited<ReturnType<typeof stat>>;
        try {
          st = await stat(full);
        } catch {
          continue;
        }

        if (st.isDirectory()) {
          await scanDir(full);
        } else if (entry.endsWith(".json")) {
          scanned++;
          if (st.mtime < cutoff) {
            expired++;
            if (!dryRun) {
              try {
                await rm(full, { force: true });
                deleted++;
              } catch (e: unknown) {
                errors.push(`delete ${full}: ${e instanceof Error ? e.message : String(e)}`);
              }
            }
          }
        }
      }
    };

    try {
      await scanDir(base);
    } catch (e: unknown) {
      errors.push(`Local scan: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else if (type === "s3") {
    // S3: 直接用 SDK 列出 + 删除对象
    try {
      const {
        S3Client,
        ListObjectsV2Command,
        DeleteObjectCommand,
      } = await import("@aws-sdk/client-s3");

      const s3client = new S3Client({
        region: process.env.S3_REGION ?? "us-east-1",
        endpoint: process.env.S3_ENDPOINT,
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY ?? "",
          secretAccessKey: process.env.S3_SECRET_KEY ?? "",
        },
        forcePathStyle: true, // MinIO / local S3
      });

      const bucket = process.env.S3_BUCKET ?? "smartrouter-archives";
      const prefix = process.env.S3_PREFIX ?? "archives/";
      let token: string | undefined;

      do {
        const listRes = await s3client.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })
        );
        const objs = listRes.Contents ?? [];

        for (const obj of objs) {
          if (!obj.Key || obj.Key === prefix) continue; // skip folder marker
          scanned++;
          if (obj.LastModified && obj.LastModified < cutoff) {
            expired++;
            if (!dryRun) {
              try {
                await s3client.send(
                  new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key })
                );
                deleted++;
              } catch (e: unknown) {
                errors.push(`delete ${obj.Key}: ${e instanceof Error ? e.message : String(e)}`);
              }
            }
          }
        }
        token = listRes.NextContinuationToken;
      } while (token);
    } catch (e: unknown) {
      errors.push(`S3 eviction: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    scanned,
    expired,
    deleted,
    errors,
    durationMs: Date.now() - start,
    dryRun,
  };
}

// ── PG Helper ─────────────────────────────────────────────────────────────────

interface PGArchiveRow {
  id: string;
}

async function listExpiredPG(
  userId: string | undefined,
  cutoff: Date
): Promise<PGArchiveRow[]> {
  const sql = userId
    ? `SELECT id FROM task_archive WHERE user_id = $1 AND updated_at < $2`
    : `SELECT id FROM task_archive WHERE updated_at < $1`;

  const args = userId ? [userId, cutoff.toISOString()] : [cutoff.toISOString()];
  const result = await query(sql, args);
  return result.rows as { id: string }[];
}

// ── Schedule ─────────────────────────────────────────────────────────────────

/**
 * 启动定时 eviction（调用一次即可，通常在 main() 中）
 * 每 intervalHours 小时运行一次 TTL 清理。
 *
 * 默认：每 24 小时运行一次。
 */
export function startEvictionScheduler(
  ttlDays: number = parseInt(process.env.ARCHIVE_TTL_DAYS ?? "30", 10),
  intervalHours: number = 24
): NodeJS.Timeout {
  // 不启动 if TTL=0（不过期）
  if (ttlDays <= 0) {
    console.log("[EvictionScheduler] TTL=0, eviction disabled");
    return -1 as unknown as NodeJS.Timeout;
  }

  console.log(`[EvictionScheduler] Starting, ttl=${ttlDays}d, interval=${intervalHours}h`);

  const id = setInterval(async () => {
    try {
      const result = await runEviction({ ttlDays, dryRun: false });
      if (result.deleted > 0 || result.errors.length > 0) {
        console.log(
          `[EvictionScheduler] scanned=${result.scanned} expired=${result.expired} deleted=${result.deleted} errors=${result.errors.length}`
        );
        if (result.errors.length > 0) {
          console.error("[EvictionScheduler] Errors:", result.errors.slice(0, 5));
        }
      }
    } catch (e: unknown) {
      console.error("[EvictionScheduler] Fatal:", e instanceof Error ? e.message : String(e));
    }
  }, intervalHours * 3_600_000);

  return id;
}
