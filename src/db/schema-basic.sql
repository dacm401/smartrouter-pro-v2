-- SmartRouter Pro v1.0 - Database Schema (Basic, no pgvector)

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
  feedback_score    NUMERIC(4,1),
  routing_correct   BOOLEAN,
  cost_saved_vs_slow DECIMAL(10, 6),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feedback_events (
  id              VARCHAR(36) PRIMARY KEY,
  decision_id    VARCHAR(36) NOT NULL,
  user_id        VARCHAR(36) NOT NULL,
  event_type     VARCHAR(50) NOT NULL,
  signal_level   SMALLINT NOT NULL,
  source         VARCHAR(20) NOT NULL,
  raw_data       JSONB,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_events_user_time ON feedback_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_events_decision ON feedback_events(decision_id);

CREATE TABLE IF NOT EXISTS memory_entries (
  id            VARCHAR(36) PRIMARY KEY,
  user_id       VARCHAR(36) NOT NULL,
  content       TEXT NOT NULL,
  source        VARCHAR(50) NOT NULL,
  importance    SMALLINT DEFAULT 3,
  metadata      JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_entries_user ON memory_entries(user_id);

CREATE TABLE IF NOT EXISTS user_identities (
  id              VARCHAR(36) PRIMARY KEY,
  user_id         VARCHAR(36) NOT NULL UNIQUE,
  preferred_style VARCHAR(20),
  common_tasks    JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id            VARCHAR(36) PRIMARY KEY,
  user_id       VARCHAR(36) NOT NULL,
  title         VARCHAR(255) NOT NULL,
  description   TEXT,
  status        VARCHAR(20) DEFAULT 'pending',
  priority      SMALLINT DEFAULT 3,
  due_date      TIMESTAMPTZ,
  metadata      JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

CREATE TABLE IF NOT EXISTS evidence_items (
  id            VARCHAR(36) PRIMARY KEY,
  task_id       VARCHAR(36),
  user_id       VARCHAR(36) NOT NULL,
  type          VARCHAR(50) NOT NULL,
  content       TEXT NOT NULL,
  source_url    VARCHAR(500),
  confidence    REAL,
  metadata      JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evidence_task ON evidence_items(task_id);
CREATE INDEX IF NOT EXISTS idx_evidence_user ON evidence_items(user_id);
