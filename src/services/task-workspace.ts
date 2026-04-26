/**
 * Sprint 64 — TaskWorkspaceService
 *
 * 跨 Worker 共享工作空间。
 * Fast 创建工作空间，Worker 读写共享产出；
 * 主人的 PII/凭证永远不写入此空间。
 */

import { randomUUID } from "crypto";
import {
  TaskWorkspaceRepo,
  type TaskWorkspaceRecord,
} from "../db/repositories.js";

// ── 工作空间快照（给 Worker 的只读视图） ──────────────────────────────────────

export interface WorkspaceSnapshot {
  task_id: string;
  objective: string;
  constraints: string[];
  /** 其他 Worker 已产出的内容（key = workerId） */
  peer_outputs: Record<string, unknown>;
}

// ── TaskWorkspaceService ──────────────────────────────────────────────────────

export const TaskWorkspaceService = {
  /**
   * 由 Fast Manager 创建工作空间。
   * objective / constraints 已经由 Fast 脱敏处理，不含 PII。
   */
  async create(params: {
    task_id: string;
    user_id: string;
    session_id: string;
    /** 任务目标（脱敏后） */
    objective: string;
    /** 约束条件列表（脱敏后） */
    constraints?: string[];
  }): Promise<TaskWorkspaceRecord> {
    const existing = await TaskWorkspaceRepo.getByTask(params.task_id);
    if (existing) return existing;

    return TaskWorkspaceRepo.create({
      id: randomUUID(),
      task_id: params.task_id,
      user_id: params.user_id,
      session_id: params.session_id,
      objective: params.objective,
      constraints: params.constraints ?? [],
    });
  },

  /**
   * Worker 调用：获取工作空间快照。
   * 只返回 peer 产出（不含自身 workerId 的产出），避免循环引用。
   */
  async getSnapshot(
    taskId: string,
    requestingWorkerId: string
  ): Promise<WorkspaceSnapshot | null> {
    const ws = await TaskWorkspaceRepo.getByTask(taskId);
    if (!ws) return null;

    // 记录访问日志
    await TaskWorkspaceRepo.appendAccessLog(taskId, {
      worker_id: requestingWorkerId,
      action: "read_snapshot",
      keys: ["objective", "constraints", "peer_outputs"],
    });

    const peerOutputs = await TaskWorkspaceRepo.getPeerOutputs(
      taskId,
      requestingWorkerId
    );

    return {
      task_id: ws.task_id,
      objective: ws.objective,
      constraints: ws.constraints,
      peer_outputs: peerOutputs,
    };
  },

  /**
   * Worker 写入自己的产出。
   * Fast 可以读取所有产出，汇总后返回给主人（中途再次脱敏）。
   */
  async writeOutput(params: {
    task_id: string;
    worker_id: string;
    output_key: string;
    output_value: unknown;
  }): Promise<void> {
    const { task_id, worker_id, output_key, output_value } = params;

    // Worker 产出命名空间：{workerId}.{outputKey}
    const namespaced: Record<string, unknown> = {
      [`${worker_id}.${output_key}`]: output_value,
    };

    await TaskWorkspaceRepo.updateOutputs(task_id, namespaced);
    await TaskWorkspaceRepo.appendAccessLog(task_id, {
      worker_id,
      action: "write_output",
      keys: [output_key],
    });
  },

  /**
   * Fast 读取所有 Worker 的产出，用于汇总给主人。
   */
  async collectOutputs(
    taskId: string
  ): Promise<Record<string, unknown>> {
    const ws = await TaskWorkspaceRepo.getByTask(taskId);
    return ws?.shared_outputs ?? {};
  },

  /**
   * 生成给 Worker 的 prompt 附加片段（工作空间上下文）。
   */
  buildWorkspacePrompt(snapshot: WorkspaceSnapshot): string {
    const lines: string[] = [
      "【共享工作空间】",
      `任务目标：${snapshot.objective}`,
    ];

    if (snapshot.constraints.length > 0) {
      lines.push(`约束条件：${snapshot.constraints.join("；")}`);
    }

    const peers = Object.entries(snapshot.peer_outputs);
    if (peers.length > 0) {
      lines.push("", "其他 Worker 已完成的工作：");
      for (const [key, val] of peers) {
        const snippet =
          typeof val === "string"
            ? val.slice(0, 200)
            : JSON.stringify(val).slice(0, 200);
        lines.push(`  [${key}] ${snippet}${snippet.length >= 200 ? "…" : ""}`);
      }
    } else {
      lines.push("（当前没有其他 Worker 的产出）");
    }

    return lines.join("\n");
  },

  /**
   * 清理已完成任务的工作空间（目前仅标记，保留归档）。
   * 生产中可加 TTL 自动删除。
   */
  async getByUser(userId: string): Promise<TaskWorkspaceRecord[]> {
    return TaskWorkspaceRepo.getActiveByUser(userId);
  },
};
