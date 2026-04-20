/**
 * Phase 5 — TTL Eviction Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runEviction } from "../../../src/services/phase5/ttl-eviction";
import { mkdir, rm, writeFile, stat } from "fs/promises";
import { join } from "path";
import type { EvictionResult } from "../../../src/services/phase5/ttl-eviction";

const TEST_DIR = join(process.cwd(), ".test-eviction-temp");

async function touchFile(path: string, mtime: Date) {
  const { writeFile, utimes } = await import("fs/promises");
  await writeFile(path, "{}");
  await utimes(path, mtime, mtime);
}

describe("TTL Eviction — Local Backend", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  const doc = (daysAgo: number) => {
    const d = new Date(Date.now() - daysAgo * 86_400_000);
    return {
      id: `test-${daysAgo}d`,
      session_id: "s1",
      user_id: "u1",
      manager_decision: {},
      user_input: "hello",
      state: "done",
      status: "completed",
      constraints: {},
      fast_observations: [],
      slow_execution: {},
      created_at: d.toISOString(),
      updated_at: d.toISOString(),
    };
  };

  it("dryRun: 不删除，只统计", async () => {
    // 3 个文件，1 个过期
    await writeFile(join(TEST_DIR, "fresh.json"), JSON.stringify(doc(5)));
    await touchFile(join(TEST_DIR, "fresh.json"), new Date(Date.now() - 5 * 86_400_000));
    await writeFile(join(TEST_DIR, "old.json"), JSON.stringify(doc(35)));
    await touchFile(join(TEST_DIR, "old.json"), new Date(Date.now() - 35 * 86_400_000));
    await writeFile(join(TEST_DIR, "ancient.json"), JSON.stringify(doc(60)));
    await touchFile(join(TEST_DIR, "ancient.json"), new Date(Date.now() - 60 * 86_400_000));

    const result = await runEviction({ ttlDays: 30, dryRun: true, localPath: TEST_DIR });

    expect(result.scanned).toBeGreaterThanOrEqual(2);
    expect(result.expired).toBeGreaterThanOrEqual(2);
    expect(result.deleted).toBe(0); // dryRun
    expect(result.dryRun).toBe(true);
  });

  it("真实删除：只删除过期文件", async () => {
    await writeFile(join(TEST_DIR, "fresh.json"), JSON.stringify(doc(5)));
    await touchFile(join(TEST_DIR, "fresh.json"), new Date(Date.now() - 5 * 86_400_000));
    await writeFile(join(TEST_DIR, "old.json"), JSON.stringify(doc(31)));
    await touchFile(join(TEST_DIR, "old.json"), new Date(Date.now() - 31 * 86_400_000));

    const result = await runEviction({ ttlDays: 30, dryRun: false, localPath: TEST_DIR });

    expect(result.deleted).toBeGreaterThanOrEqual(1);

    // fresh 文件应该还在
    const freshStat = await stat(join(TEST_DIR, "fresh.json"));
    expect(freshStat).toBeDefined();
  });

  it("TTL=0 不触发扫描和删除", async () => {
    // 创建旧文件（TTL=0 应该直接跳过扫描逻辑）
    await writeFile(join(TEST_DIR, "old.json"), JSON.stringify(doc(999)));
    await touchFile(join(TEST_DIR, "old.json"), new Date(Date.now() - 999 * 86_400_000));

    const result = await runEviction({ ttlDays: 0, dryRun: false, localPath: TEST_DIR });

    // TTL=0 → 跳过整个扫描 → scanned=0, expired=0, deleted=0
    expect(result.scanned).toBe(0);
    expect(result.deleted).toBe(0);
  });

  it("目录不存在时优雅处理", async () => {
    await rm(TEST_DIR, { recursive: true, force: true });

    const result = await runEviction({ ttlDays: 30, dryRun: false, localPath: TEST_DIR });

    expect(result.scanned).toBe(0);
    expect(result.errors.length).toBe(0);
  });
});
