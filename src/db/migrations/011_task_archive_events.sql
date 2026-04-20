-- SmartRouter Pro — Task Archive Events Migration
-- Migration: 011_task_archive_events
-- Phase: Phase 3.0 + Phase 4 Audit
-- Date: 2026-04-20
-- Purpose:
--   1. Archive lifecycle event log (Phase 3.0 completeness)
--   2. Audit trail for permission/approval decisions (Phase 4)

BEGIN;

-- ── 1. task_archive_events ──────────────────────────────────────────────────
-- Archive 生命周期事件日志 + Phase 4 审计事件
-- 用途：
--   - SSE archive_written / worker_started / worker_completed / manager_synthesized
--   - 审计：permission_denied / redaction_applied / approval_requested

CREATE TABLE IF NOT EXISTS task_archive_events (
  id          VARCHAR(36) PRIMARY KEY,
  archive_id  VARCHAR(36) NOT NULL REFERENCES task_archives(id) ON DELETE CASCADE,
  task_id     VARCHAR(36),

  -- 事件类型（对应 SSE Phase 3.0 事件 + Phase 4 审计事件）
  event_type  VARCHAR(50) NOT NULL,
  -- Phase 3.0 SSE:
  --   archive_created    — task_archives 写入完成
  --   worker_started     — Worker 开始执行
  --   worker_completed   — Worker 执行完成
  --   manager_synthesized — Manager 合成最终输出
  -- Phase 4 Audit:
  --   permission_denied   — 云端访问被拒绝
  --   redaction_applied    — 脱敏已应用
  --   approval_requested   — 需要用户审批
  --   approval_granted     — 审批通过
  --   approval_rejected    — 审批拒绝

  -- 事件内容（JSONB，可变结构）
  payload     JSONB NOT NULL DEFAULT '{}',
  -- 典型 payload 示例：
  --   archive_created:  { "decision_type": "delegate_to_slow", "command_type": "research" }
  --   worker_started:  { "worker_role": "slow_worker", "command_id": "..." }
  --   worker_completed: { "worker_role": "slow_worker", "summary": "...", "confidence": 0.9 }
  --   manager_synthesized: { "final_content_length": 500, "confidence": 0.95 }
  --   permission_denied: { "data_type": "task_brief", "classification": "sensitive" }

  -- 审计字段（Phase 4）
  actor       VARCHAR(50),       -- 'fast_manager' | 'slow_worker' | 'permission_layer' | 'system'
  user_id     VARCHAR(64),

  -- 时间戳
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引：按 archive 查事件 timeline
CREATE INDEX IF NOT EXISTS idx_tae_archive_id
  ON task_archive_events(archive_id, created_at ASC);

-- 索引：按 task 查事件
CREATE INDEX IF NOT EXISTS idx_tae_task_id
  ON task_archive_events(task_id) WHERE task_id IS NOT NULL;

-- 索引：按事件类型筛选（审计查询）
CREATE INDEX IF NOT EXISTS idx_tae_event_type
  ON task_archive_events(event_type, created_at DESC);

-- 索引：按 actor 筛选（审计）
CREATE INDEX IF NOT EXISTS idx_tae_actor
  ON task_archive_events(actor, created_at DESC) WHERE actor IS NOT NULL;

COMMIT;
