-- SmartRouter Pro — Task Archive Schema Migration
-- Migration: 010_task_archive_phase3
-- Phase: Phase 3.0 Manager-Worker Runtime
-- Date: 2026-04-19
-- Replaces/extends: task_archives (O-005) + adds task_commands + task_worker_results

BEGIN;

-- ── 1. task_archives: add manager_decision column ─────────────────────────────
-- Phase 1.5 had a basic task_archives table. Phase 3.0 adds the ManagerDecision JSONB.

ALTER TABLE task_archives
  ADD COLUMN IF NOT EXISTS manager_decision JSONB;

-- Also add user_id for permission checks (was missing in Phase 1.5)
ALTER TABLE task_archives
  ADD COLUMN IF NOT EXISTS user_id VARCHAR(64);

-- ── 2. task_commands ──────────────────────────────────────────────────────────
-- Manager 发出的结构化命令。每个 Archive 可发出多个 Command（串行委托）。

CREATE TABLE IF NOT EXISTS task_commands (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id            UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  archive_id         UUID NOT NULL REFERENCES task_archives(id) ON DELETE CASCADE,
  user_id            VARCHAR(64) NOT NULL,

  -- 发行者（Phase 0 固定 fast_manager）
  issuer_role        VARCHAR(50) NOT NULL DEFAULT 'fast_manager',

  -- Command 核心
  command_type       VARCHAR(50) NOT NULL,
  worker_hint        VARCHAR(50),
  priority           VARCHAR(20) NOT NULL DEFAULT 'normal',
  status             VARCHAR(20) NOT NULL DEFAULT 'queued',

  -- Command payload（完整 CommandPayload JSONB）
  payload_json        JSONB NOT NULL,

  -- 幂等键
  idempotency_key     VARCHAR(120),

  -- 超时
  timeout_sec        INTEGER,

  -- 时间戳
  issued_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at         TIMESTAMPTZ,
  finished_at        TIMESTAMPTZ,

  -- 错误信息
  error_message      TEXT
);

CREATE INDEX IF NOT EXISTS task_commands_task_id_idx
  ON task_commands(task_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS task_commands_archive_id_idx
  ON task_commands(archive_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS task_commands_status_idx
  ON task_commands(status);

CREATE UNIQUE INDEX IF NOT EXISTS task_commands_idempotency_key_idx
  ON task_commands(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ── 3. task_worker_results ────────────────────────────────────────────────────
-- Worker 完成后写入的结构化结果。每个 Command 对应一个 Result（1:1）。

CREATE TABLE IF NOT EXISTS task_worker_results (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id            UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  archive_id         UUID NOT NULL REFERENCES task_archives(id) ON DELETE CASCADE,
  command_id         UUID NOT NULL REFERENCES task_commands(id) ON DELETE CASCADE,
  user_id            VARCHAR(64) NOT NULL,

  worker_role        VARCHAR(50) NOT NULL,
  result_type        VARCHAR(50) NOT NULL,
  status             VARCHAR(20) NOT NULL DEFAULT 'completed',

  summary            TEXT NOT NULL DEFAULT '',
  result_json        JSONB NOT NULL DEFAULT '{}',
  confidence         REAL,

  -- 资源消耗
  tokens_input       INTEGER,
  tokens_output      INTEGER,
  cost_usd           REAL,

  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  error_message      TEXT
);

CREATE INDEX IF NOT EXISTS task_worker_results_task_id_idx
  ON task_worker_results(task_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS task_worker_results_command_id_idx
  ON task_worker_results(command_id);

-- ── 4. task_archives FK 补充（可选，Phase 0 跳过）────────────────────────────

-- ALTER TABLE task_archives
--   ADD CONSTRAINT task_archives_current_command_fk
--   FOREIGN KEY (current_command_id)
--   REFERENCES task_commands(id) ON DELETE SET NULL;
-- Phase 0: current_command_id 暂不在 task_archives 中管理，
-- 直接通过 task_commands 查 latest queued command 即可。

COMMIT;
