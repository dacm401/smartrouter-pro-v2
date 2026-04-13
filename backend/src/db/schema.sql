-- SmartRouter Pro v1.0 - Database Schema

CREATE TABLE IF NOT EXISTS decision_logs (
  id                VARCHAR(36) PRIMARY KEY,
  user_id           VARCHAR(36) NOT NULL,
  session_id        VARCHAR(36) NOT NULL,
  query_preview     TEXT,
  intent            VARCHAR(50),
  complexity_score  SMALLINT,
  input_token_count INTEGER,
  has_code          BOOLEAN DEFAULT FALSE,
  has_math          BOOLEAN DEFAULT FALSE,
  router_version    VARCHAR(20),
  fast_score        REAL,
  slow_score        REAL,
  confidence        REAL,
  selected_model    VARCHAR(100),
  selected_role     VARCHAR(10),
  selection_reason  TEXT,
  context_original_tokens   INTEGER,
  context_compressed_tokens INTEGER,
  compression_level VARCHAR(5),
  compression_ratio REAL,
  model_used        VARCHAR(100),
  exec_input_tokens INTEGER,
  exec_output_tokens INTEGER,
  total_cost_usd    DECIMAL(10, 6),
  latency_ms        INTEGER,
  did_fallback      BOOLEAN DEFAULT FALSE,
  fallback_reason   TEXT,
  feedback_type     VARCHAR(50),
  feedback_score    NUMERIC(4,1),  -- supports fractional values (e.g. "edited" = -0.5)
  routing_correct   BOOLEAN,
  cost_saved_vs_slow DECIMAL(10, 6),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feedback_events (
  id              VARCHAR(36) PRIMARY KEY,
  decision_id    VARCHAR(36) NOT NULL,
  user_id        VARCHAR(36) NOT NULL,
  event_type     VARCHAR(50) NOT NULL,
  signal_level   SMALLINT NOT NULL,  -- 1=L1(strong), 2=L2(weak), 3=L3(noise)
  source         VARCHAR(20) NOT NULL, -- 'ui' | 'auto_detect' | 'system'
  raw_data       JSONB,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_events_user_time ON feedback_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_events_decision ON feedback_events(decision_id);

CREATE TABLE IF NOT EXISTS execution_results (
  id                  VARCHAR(36) PRIMARY KEY,
  task_id             VARCHAR(36),
  user_id             VARCHAR(36) NOT NULL,
  session_id          VARCHAR(36) NOT NULL,
  final_content       TEXT,
  steps_summary       JSONB,
  memory_entries_used TEXT[]     DEFAULT '{}',
  model_used          VARCHAR(100),
  tool_count          INTEGER    DEFAULT 0,
  duration_ms         INTEGER,
  reason              VARCHAR(50),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_er_user_time  ON execution_results(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_er_task       ON execution_results(task_id);

CREATE TABLE IF NOT EXISTS behavioral_memories (
  id                  VARCHAR(36) PRIMARY KEY,
  user_id             VARCHAR(36) NOT NULL,
  trigger_pattern     TEXT NOT NULL,
  observation         TEXT NOT NULL,
  learned_action      TEXT NOT NULL,
  strength            REAL DEFAULT 0.5,
  reinforcement_count INTEGER DEFAULT 1,
  last_activated      TIMESTAMPTZ,
  source_decision_ids TEXT[],
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bm_user ON behavioral_memories(user_id);

CREATE TABLE IF NOT EXISTS identity_memories (
  user_id              VARCHAR(36) PRIMARY KEY,
  response_style       VARCHAR(20) DEFAULT 'balanced',
  expertise_level      VARCHAR(20) DEFAULT 'intermediate',
  domains              TEXT[] DEFAULT '{}',
  quality_sensitivity  REAL DEFAULT 0.5,
  cost_sensitivity     REAL DEFAULT 0.5,
  preferred_fast_model VARCHAR(100),
  preferred_slow_model VARCHAR(100),
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS growth_milestones (
  id              VARCHAR(36) PRIMARY KEY,
  user_id         VARCHAR(36) NOT NULL,
  milestone_type  VARCHAR(50),
  title           TEXT NOT NULL,
  description     TEXT,
  metric_value    REAL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gm_user ON growth_milestones(user_id, created_at);

CREATE TABLE IF NOT EXISTS sessions (
  id              VARCHAR(36) PRIMARY KEY,
  user_id         VARCHAR(36) NOT NULL,
  active_topic    TEXT,
  total_requests  INTEGER DEFAULT 0,
  fast_count      INTEGER DEFAULT 0,
  slow_count      INTEGER DEFAULT 0,
  fallback_count  INTEGER DEFAULT 0,
  total_tokens    INTEGER DEFAULT 0,
  total_cost      DECIMAL(10, 6) DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id              VARCHAR(36) PRIMARY KEY,
  user_id         VARCHAR(36) NOT NULL,
  session_id      VARCHAR(36) NOT NULL,
  title           VARCHAR(255),
  mode            VARCHAR(20) DEFAULT 'direct',
  status          VARCHAR(20) DEFAULT 'completed',
  complexity      VARCHAR(10) DEFAULT 'low',
  risk            VARCHAR(10) DEFAULT 'low',
  goal            TEXT,
  budget_profile  JSONB DEFAULT '{}',
  tokens_used     INTEGER DEFAULT 0,
  tool_calls_used INTEGER DEFAULT 0,
  steps_used      INTEGER DEFAULT 0,
  summary_ref     VARCHAR(36),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_session ON tasks(user_id, session_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks(user_id, updated_at DESC);

-- Task summaries (FC-002)
CREATE TABLE IF NOT EXISTS task_summaries (
  id              VARCHAR(36) PRIMARY KEY,
  task_id         VARCHAR(36) NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  goal            TEXT,
  confirmed_facts TEXT[] DEFAULT '{}',
  completed_steps TEXT[] DEFAULT '{}',
  blocked_by      TEXT[] DEFAULT '{}',
  next_step       TEXT,
  summary_text    TEXT,
  version         INTEGER DEFAULT 1,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ts_task ON task_summaries(task_id);

-- Task traces (FC-003)
CREATE TABLE IF NOT EXISTS task_traces (
  id        VARCHAR(36) PRIMARY KEY,
  task_id   VARCHAR(36) NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type      VARCHAR(30) NOT NULL,
  detail    TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tt_task ON task_traces(task_id, created_at);

-- Memory entries (MC-001)
CREATE TABLE IF NOT EXISTS memory_entries (
  id          VARCHAR(36) PRIMARY KEY,
  user_id     VARCHAR(36) NOT NULL,
  category    VARCHAR(50) NOT NULL,        -- "preference" | "fact" | "context" | "instruction"
  content     TEXT NOT NULL,
  importance  INTEGER NOT NULL DEFAULT 3, -- 1–5, higher = more important
  tags        TEXT[] DEFAULT '{}',
  source      VARCHAR(50) NOT NULL DEFAULT 'manual',  -- "manual" | "extracted" | "feedback"
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_me_user ON memory_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_me_user_importance ON memory_entries(user_id, importance DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_me_user_category ON memory_entries(user_id, category);

-- Sprint 25: pgvector extension for semantic memory retrieval
CREATE EXTENSION IF NOT EXISTS vector;

-- memory_entries 加 embedding 列（1536维，兼容 OpenAI text-embedding-3-small）
ALTER TABLE memory_entries
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- HNSW 索引（比 IVFFlat 更适合小数据集，无需预训练）
CREATE INDEX IF NOT EXISTS memory_entries_embedding_idx
  ON memory_entries
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Layer 6 / E1: Evidence table
-- Stores provenance of external information retrieved during task execution.
-- Distinct from memory_entries (user-level, editable) — evidence is task-level
-- and tied to the specific source that produced it (read-only provenance).
CREATE TABLE IF NOT EXISTS evidence (
  evidence_id     VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         VARCHAR(36) NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id         VARCHAR(36) NOT NULL,
  source          VARCHAR(50) NOT NULL DEFAULT 'manual',
  content         TEXT NOT NULL,
  source_metadata JSONB,
  relevance_score REAL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_evidence_task_id ON evidence(task_id);
CREATE INDEX IF NOT EXISTS idx_evidence_user_id ON evidence(user_id);
