-- SmartRouter Pro — Sprint 64: Permission-Gated Worker Architecture
-- Migration: 016_permission_workspace

BEGIN;

-- ── 1. Permission Requests ──────────────────────────────────────────────────
-- Fast Manager 请求主人授权敏感信息给 Worker 时记录在此
CREATE TABLE IF NOT EXISTS permission_requests (
  id              VARCHAR(64)  PRIMARY KEY,
  task_id         VARCHAR(64)  NOT NULL,
  worker_id       VARCHAR(64)  NOT NULL,
  user_id         VARCHAR(64)  NOT NULL,
  session_id      VARCHAR(64)  NOT NULL,

  -- 请求访问的字段名（语义描述，不是原始 key）
  field_name      VARCHAR(128) NOT NULL,
  field_key       VARCHAR(128) NOT NULL,
  -- 字段用途描述（给主人看的）
  purpose         TEXT         NOT NULL,
  -- 主人看到的预览值（脱敏后）
  value_preview   VARCHAR(256),

  status          VARCHAR(20)  NOT NULL DEFAULT 'pending',
  -- pending | approved | denied | expired

  -- 有效期（秒）
  expires_in      INTEGER      NOT NULL DEFAULT 300,
  -- 精确授权范围
  approved_scope  VARCHAR(256),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  resolved_by     VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS idx_pr_user_pending  ON permission_requests(user_id, status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_pr_task          ON permission_requests(task_id);
CREATE INDEX IF NOT EXISTS idx_pr_session      ON permission_requests(session_id);

-- ── 2. Task Workspaces ──────────────────────────────────────────────────────
-- 跨 Worker 共享工作空间，Fast 维护，Worker 按需读写
CREATE TABLE IF NOT EXISTS task_workspaces (
  id           VARCHAR(64)  PRIMARY KEY,
  task_id      VARCHAR(64)  NOT NULL UNIQUE,
  user_id      VARCHAR(64)  NOT NULL,
  session_id   VARCHAR(64)  NOT NULL,

  -- 任务目标（Fast 写，已脱敏）
  objective     TEXT         NOT NULL,
  -- 约束条件（Fast 写，已脱敏）
  constraints   TEXT[]      NOT NULL DEFAULT '{}',
  -- Worker 共享产出（JSON，允许不同 Worker 互相消费结果）
  shared_outputs JSONB       NOT NULL DEFAULT '{}',
  -- 访问日志
  access_log    JSONB       NOT NULL DEFAULT '[]',

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tw_task   ON task_workspaces(task_id);
CREATE INDEX IF NOT EXISTS idx_tw_user   ON task_workspaces(user_id, updated_at DESC);

-- ── 3. Scoped Access Tokens ────────────────────────────────────────────────
-- Fast 发给 Worker 的受限访问令牌（用于代理调用外部 API）
CREATE TABLE IF NOT EXISTS scoped_tokens (
  id           VARCHAR(64)  PRIMARY KEY,
  token        VARCHAR(128) NOT NULL UNIQUE,
  task_id      VARCHAR(64)  NOT NULL,
  worker_id    VARCHAR(64)  NOT NULL,
  user_id      VARCHAR(64)  NOT NULL,
  scope        TEXT[]       NOT NULL,  -- e.g. ['email', 'name']
  expires_at   TIMESTAMPTZ  NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_st_token    ON scoped_tokens(token);
CREATE INDEX IF NOT EXISTS idx_st_task     ON scoped_tokens(task_id);
CREATE INDEX IF NOT EXISTS idx_st_expires  ON scoped_tokens(expires_at) WHERE expires_at > NOW();

COMMIT;
