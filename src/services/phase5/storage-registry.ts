/**
 * Phase 5 — Storage Registry
 *
 * 解决 IArchiveStorage 实例的循环依赖问题。
 * 提供全局单例，确保每个后端只初始化一次。
 */

import type { IArchiveStorage } from "./storage-backend.js";

let _instance: IArchiveStorage | null = null;
let _type: string | null = null;

/**
 * 获取 IArchiveStorage 单例。
 * 首次调用时根据 STORAGE_BACKEND 创建实例，后续调用返回同一实例。
 */
export async function getIArchiveStorage(): Promise<IArchiveStorage> {
  if (_instance) return _instance;

  const type = process.env.STORAGE_BACKEND ?? "local";

  switch (type) {
    case "s3": {
      const { S3ArchiveStorage } = await import("./s3-archive-storage.js");
      _instance = new S3ArchiveStorage({
        bucket: process.env.S3_BUCKET ?? "smartrouter-archives",
        region: process.env.S3_REGION ?? "us-east-1",
        endpoint: process.env.S3_ENDPOINT,
        accessKeyId: process.env.S3_ACCESS_KEY ?? "",
        secretAccessKey: process.env.S3_SECRET_KEY ?? "",
        prefix: process.env.S3_PREFIX ?? "archives/",
      });
      break;
    }
    case "pg": {
      const { PGArchiveStorage } = await import("./pg-archive-storage.js");
      _instance = new PGArchiveStorage();
      break;
    }
    case "local":
    default: {
      const { LocalArchiveStorage } = await import("./local-archive-store.js");
      _instance = new LocalArchiveStorage({
        basePath: process.env.LOCAL_ARCHIVE_PATH ?? "./data/archive",
        compress: process.env.LOCAL_ARCHIVE_COMPRESS === "true",
      });
      break;
    }
  }

  _type = type;
  return _instance;
}

export function getStorageType(): string {
  return _type ?? process.env.STORAGE_BACKEND ?? "local";
}
