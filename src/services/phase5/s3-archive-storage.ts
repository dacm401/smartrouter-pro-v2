/**
 * Phase 5 — S3 Archive Storage
 *
 * S3 兼容存储后端（支持 AWS S3 / MinIO / Cloudflare R2）。
 * 将 Archive 存储为 JSON 文件，路径格式：{prefix}/{userId}/{sessionId}/{archiveId}.json
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  type PutObjectCommandInput,
  type GetObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { IArchiveStorage, ArchiveDocument } from "./storage-backend.js";

// ── Config ────────────────────────────────────────────────────────────────────

export interface S3ArchiveConfig {
  bucket: string;
  region?: string;
  endpoint?: string;        // MinIO: http://localhost:9000, R2: https://xxx.r2.cloudflarestorage.com
  accessKeyId: string;
  secretAccessKey: string;
  prefix?: string;          // 前缀，默认 "archives/"
  ttlDays?: number;         // TTL，天，0 = 不过期
  signatureExpires?: number; // 预签名 URL 有效期（秒），默认 3600
}

// ── S3ArchiveStorage ───────────────────────────────────────────────────────────

export class S3ArchiveStorage implements IArchiveStorage {
  private client: S3Client;
  private bucket: string;
  private prefix: string;
  private ttlDays: number;
  private signatureExpires: number;

  constructor(config: S3ArchiveConfig) {
    this.client = new S3Client({
      region: config.region ?? "us-east-1",
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // MinIO 需要 path style
      forcePathStyle: !!config.endpoint,
    });

    this.bucket = config.bucket;
    this.prefix = config.prefix ?? "archives/";
    this.ttlDays = config.ttlDays ?? 0;
    this.signatureExpires = config.signatureExpires ?? 3600;
  }

  // ── Path helpers ──────────────────────────────────────────────────────────

  private objectKey(userId: string, sessionId: string, archiveId: string): string {
    return `${this.prefix}${userId}/${sessionId}/${archiveId}.json`;
  }

  private sessionPrefix(userId: string, sessionId: string): string {
    return `${this.prefix}${userId}/${sessionId}/`;
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async save(doc: ArchiveDocument): Promise<string> {
    const key = this.objectKey(doc.user_id, doc.session_id, doc.id);
    const body = JSON.stringify(doc, null, 2);

    const params: PutObjectCommandInput = {
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: "application/json",
    };

    // 设置 TTL（通过 Expires 头，仅在 GET 时生效；实际 TTL 需配置 lifecycle rule）
    if (this.ttlDays > 0) {
      const expires = new Date();
      expires.setDate(expires.getDate() + this.ttlDays);
      params.Expires = expires;
    }

    await this.client.send(new PutObjectCommand(params));
    return doc.id;
  }

  async getById(id: string): Promise<ArchiveDocument | null> {
    // S3 没有 ID→path 索引，只能通过 session prefix 扫描
    // 实际使用中应先从 PG 查询元数据，再从 S3 取内容
    // 此处作为降级：遍历所有 session（仅用于测试/调试）
    const marker: string[] = [];
    for (let attempt = 0; attempt < 10; attempt++) {
      const listed = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: this.prefix,
          ContinuationToken: marker[marker.length - 1] ?? undefined,
          MaxKeys: 1000,
        })
      );

      for (const obj of listed.Contents ?? []) {
        if (obj.Key?.endsWith(`/${id}.json`)) {
          return this.downloadObject(obj.Key);
        }
      }

      if (!listed.IsTruncated) break;
      marker.push(listed.NextContinuationToken ?? "");
    }

    return null;
  }

  async getBySession(
    sessionId: string,
    userId: string
  ): Promise<ArchiveDocument | null> {
    const prefix = this.sessionPrefix(userId, sessionId);

    const listed = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        MaxKeys: 100,
      })
    );

    if (!listed.Contents || listed.Contents.length === 0) {
      return null;
    }

    // 按 LastModified 降序，取最新的
    const latest = listed.Contents.sort(
      (a, b) =>
        new Date(b.LastModified ?? 0).getTime() -
        new Date(a.LastModified ?? 0).getTime()
    )[0];

    return latest?.Key ? this.downloadObject(latest.Key) : null;
  }

  async update(
    id: string,
    updates: Partial<ArchiveDocument>
  ): Promise<boolean> {
    const existing = await this.getById(id);
    if (!existing) return false;

    const updated: ArchiveDocument = {
      ...existing,
      ...updates,
      id: existing.id,
      created_at: existing.created_at,
      updated_at: new Date().toISOString(),
    };

    await this.save(updated);
    return true;
  }

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

  async delete(id: string): Promise<boolean> {
    // 需要先找到 key
    const doc = await this.getById(id);
    if (!doc) return false;

    const key = this.objectKey(doc.user_id, doc.session_id, id);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
    );
    return true;
  }

  async listBySession(
    sessionId: string,
    userId: string
  ): Promise<ArchiveDocument[]> {
    const prefix = this.sessionPrefix(userId, sessionId);
    const listed = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        MaxKeys: 1000,
      })
    );

    if (!listed.Contents) return [];

    const docs = await Promise.all(
      listed.Contents
        .map((obj) => obj.Key)
        .filter((k): k is string => !!k)
        .map((key) => this.downloadObject(key))
    );
    return docs
      .filter((doc): doc is ArchiveDocument => doc !== null)
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() -
          new Date(a.created_at).getTime()
      );
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  /** 生成预签名下载地址（用于私有 bucket 分享） */
  async getPresignedUrl(
    userId: string,
    sessionId: string,
    archiveId: string
  ): Promise<string> {
    const key = this.objectKey(userId, sessionId, archiveId);
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, cmd, { expiresIn: this.signatureExpires });
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: `${this.prefix}` })
      );
      return true;
    } catch {
      // 前缀不存在不算错，尝试列出根目录
      try {
        await this.client.send(
          new ListObjectsV2Command({ Bucket: this.bucket, MaxKeys: 1 })
        );
        return true;
      } catch {
        return false;
      }
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async downloadObject(key: string): Promise<ArchiveDocument | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key })
      );

      if (!response.Body) return null;

      const bodyString = await response.Body.transformToString();
      return JSON.parse(bodyString) as ArchiveDocument;
    } catch {
      return null;
    }
  }
}
