-- SmartRouter Pro — G4 Delegation Learning Loop Migration
-- Migration: 012_delegation_logs
-- Phase: Phase D — Gated Delegation v2
-- Date: 2026-04-24
-- Purpose:
--   Gated Delegation v2 事实表：G1(系统置信度) → G2(Policy校准) → G3(Rerank) → 执行结果
--   用途：离线分析、benchmark 改进、用户层面行为学习

BEGIN;

-- ── delegation_logs ─────────────────────────────────────────────────────────
-- Gated Delegation Pipeline 事实表
-- 记录每次 Fast 模型委托决策的完整 pipeline 状态（用于离线分析和学习）
--
-- Pipeline 版本（routing_version）用于回溯不同版本的 gate 行为
--
-- 决策分数结构（JSONB）:
--   { direct_answer, ask_clarification, delegate_to_slow, execute_task }
--
-- policy_overrides 示例:
--   [{ rule: "kb_signal_overrides", action: "boost", target: "delegate_to_slow",
--      original_score: 0.6, adjusted_score: 0.85, reason: "KB calibration applied" }]
--
-- rerank_rules 示例:
--   [{ rule: "top1_top2_gap", gap: 0.12, reranked: true }]

CREATE TABLE IF NOT EXISTS delegation_logs (
  -- PK
  id                VARCHAR(36) PRIMARY KEY,

  -- 决策上下文
  user_id           VARCHAR(64) NOT NULL,
  session_id        VARCHAR(64) NOT NULL,
  turn_id           INTEGER     NOT NULL DEFAULT 0,
  task_id           VARCHAR(64),

  -- Pipeline 版本（用于回溯不同版本的 gate 行为）
  routing_version   VARCHAR(20) NOT NULL DEFAULT 'v2',

  -- G0: LLM 原始输出
  llm_scores        JSONB NOT NULL,
  -- { direct_answer, ask_clarification, delegate_to_slow, execute_task }
  llm_confidence    REAL  NOT NULL,

  -- G1: System Confidence（动作打分头的系统级置信度）
  system_confidence  REAL  NOT NULL,

  -- G2: Policy Calibration
  calibrated_scores  JSONB NOT NULL,
  -- { direct_answer, ask_clarification, delegate_to_slow, execute_task }
  policy_overrides   JSONB NOT NULL DEFAULT '[]',
  -- [{ rule, action, target, original_score, adjusted_score, reason }]
  g2_final_action   VARCHAR(30),

  -- G3: Rerank
  did_rerank         BOOLEAN NOT NULL DEFAULT FALSE,
  rerank_gap         REAL,
  rerank_rules       JSONB   NOT NULL DEFAULT '[]',
  g3_final_action    VARCHAR(30),

  -- 最终路由决策
  routed_action      VARCHAR(30) NOT NULL,
  routing_reason     TEXT,

  -- 执行结果（异步回写，可为 NULL 表示尚未执行完）
  execution_status   VARCHAR(20),   -- pending | success | failed | timeout
  execution_correct  BOOLEAN,
  error_message      TEXT,
  model_used         VARCHAR(100),
  latency_ms         INTEGER,
  cost_usd           DECIMAL(10, 6),

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  executed_at        TIMESTAMPTZ
);

-- 索引：按用户 + 时间查历史
CREATE INDEX IF NOT EXISTS idx_dl_user_time
  ON delegation_logs(user_id, created_at DESC);

-- 索引：按 session + turn 重建决策轨迹
CREATE INDEX IF NOT EXISTS idx_dl_session
  ON delegation_logs(session_id, turn_id DESC);

-- 索引：按路由动作分析分布
CREATE INDEX IF NOT EXISTS idx_dl_routed_action
  ON delegation_logs(routed_action, created_at DESC);

-- 索引：按执行状态查 pending 任务（G4 Learning Loop 用）
CREATE INDEX IF NOT EXISTS idx_dl_execution
  ON delegation_logs(execution_status)
  WHERE execution_status IS NOT NULL;

-- 索引：按 G2 策略动作分析 Policy 有效性
CREATE INDEX IF NOT EXISTS idx_dl_g2_final
  ON delegation_logs(g2_final_action, created_at DESC);

-- 索引：按 G3 重排动作分析 Rerank 触发率
CREATE INDEX IF NOT EXISTS idx_dl_g3_final
  ON delegation_logs(g3_final_action, created_at DESC)
  WHERE g3_final_action IS NOT NULL;

COMMIT;
