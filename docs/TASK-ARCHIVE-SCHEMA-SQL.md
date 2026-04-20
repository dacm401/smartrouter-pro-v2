# SmartRouter Pro — Task Archive Schema（SQL 快照）

> 版本：v1.0 | 日期：2026-04-20 | Phase：Phase 2 | 状态：**ACTIVE**
> 关联文档：`TASK-ARCHIVE-IMPLEMENTATION-GUIDE.md`（详细实现说明）

---

## 1. 表概览

Phase 2 共建 3 张核心表 + 1 张事件表：

| 表名 | 用途 | 位置 |
|---|---|---|
| `task_archives` | Archive 主记录 | schema.sql（主表）|
| `task_commands` | Manager 发出的命令 | migration 010 |
| `task_worker_results` | Worker 执行结果 | migration 010 |
| `task_archive_events` | 生命周期事件 + 审计日志 | migration 011 |

---

## 2. task_archives

```sql
CREATE TABLE IF NOT EXISTS task_archives (
  id              VARCHAR(36) PRIMARY KEY,
  session_id      VARCHAR(64) NOT NULL,
  turn_id         INTEGER NOT NULL DEFAULT 0,

  -- ManagerDecision JSONB（Phase 1）
  command         JSONB NOT NULL,
  user_input      TEXT NOT NULL,
  constraints     TEXT[] DEFAULT '{}',

  -- Phase 1.5: 任务卡片
  task_type       VARCHAR(20) DEFAULT 'analysis',
  task_brief      JSONB DEFAULT '{}',

  -- 执行过程
  fast_observations JSONB DEFAULT '[]',
  slow_execution    JSONB DEFAULT '{}',
  state           VARCHAR(20) DEFAULT 'chattering',
  status          VARCHAR(16) DEFAULT 'pending',
  delivered       BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**关键字段说明：**

- `command`：Phase 1 ManagerDecision.command，即 CommandPayload JSONB
- `state`：chattering / clarifying / task_ready / executing / done / failed / cancelled
- `status`：pending → running → done | failed | cancelled
- `slow_execution`：Worker 结果 `{ result, errors, deviations, started_at }`

---

## 3. task_commands

```sql
CREATE TABLE IF NOT EXISTS task_commands (
  id                 UUID PRIMARY KEY,
  task_id            UUID NOT NULL REFERENCES tasks(id),
  archive_id         UUID NOT NULL REFERENCES task_archives(id),
  user_id            VARCHAR(64) NOT NULL,
  issuer_role        VARCHAR(50) NOT NULL DEFAULT 'fast_manager',
  command_type       VARCHAR(50) NOT NULL,
  worker_hint        VARCHAR(50),
  priority           VARCHAR(20) NOT NULL DEFAULT 'normal',
  status             VARCHAR(20) NOT NULL DEFAULT 'queued',
  payload_json       JSONB NOT NULL,
  idempotency_key    VARCHAR(120),
  timeout_sec        INTEGER,
  issued_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at         TIMESTAMPTZ,
  finished_at        TIMESTAMPTZ,
  error_message      TEXT
);
```

**状态流转：**

```
queued → running → completed | failed | cancelled
```

---

## 4. task_worker_results

```sql
CREATE TABLE IF NOT EXISTS task_worker_results (
  id                 UUID PRIMARY KEY,
  task_id            UUID NOT NULL REFERENCES tasks(id),
  archive_id         UUID NOT NULL REFERENCES task_archives(id),
  command_id         UUID NOT NULL REFERENCES task_commands(id),
  user_id            VARCHAR(64) NOT NULL,
  worker_role        VARCHAR(50) NOT NULL,
  result_type        VARCHAR(50) NOT NULL,
  status             VARCHAR(20) NOT NULL DEFAULT 'completed',
  summary            TEXT NOT NULL DEFAULT '',
  result_json        JSONB NOT NULL DEFAULT '{}',
  confidence         REAL,
  tokens_input       INTEGER,
  tokens_output      INTEGER,
  cost_usd           REAL,
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error_message      TEXT
);
```

---

## 5. task_archive_events（migration 011）

```sql
CREATE TABLE IF NOT EXISTS task_archive_events (
  id          VARCHAR(36) PRIMARY KEY,
  archive_id  VARCHAR(36) NOT NULL REFERENCES task_archives(id),
  task_id     VARCHAR(36),
  event_type  VARCHAR(50) NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}',
  actor       VARCHAR(50),
  user_id     VARCHAR(64),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**event_type 枚举值：**

| event_type | 语义 | Phase |
|---|---|---|
| `archive_created` | Archive 写入完成 | Phase 3.0 |
| `worker_started` | Worker 开始执行 | Phase 3.0 |
| `worker_completed` | Worker 执行完成 | Phase 3.0 |
| `manager_synthesized` | Manager 合成最终输出 | Phase 3.0 |
| `permission_denied` | 云端访问被拒绝 | Phase 4 |
| `redaction_applied` | 脱敏已应用 | Phase 4 |
| `approval_requested` | 需要用户审批 | Phase 4 |
| `approval_granted` | 审批通过 | Phase 4 |
| `approval_rejected` | 审批拒绝 | Phase 4 |

---

## 6. 索引

```sql
-- task_archives
CREATE INDEX idx_ta_session ON task_archives(session_id);
CREATE INDEX idx_ta_status ON task_archives(status) WHERE status != 'done';
CREATE INDEX idx_ta_command ON task_archives USING GIN (command);
CREATE INDEX idx_ta_task_brief ON task_archives USING GIN (task_brief);
CREATE INDEX idx_ta_state ON task_archives(state);

-- task_commands
CREATE INDEX task_commands_task_id_idx ON task_commands(task_id, issued_at DESC);
CREATE INDEX task_commands_archive_id_idx ON task_commands(archive_id, issued_at DESC);
CREATE INDEX task_commands_status_idx ON task_commands(status);

-- task_worker_results
CREATE INDEX task_worker_results_task_id_idx ON task_worker_results(task_id, completed_at DESC);
CREATE INDEX task_worker_results_command_id_idx ON task_worker_results(command_id);

-- task_archive_events
CREATE INDEX idx_tae_archive_id ON task_archive_events(archive_id, created_at ASC);
CREATE INDEX idx_tae_task_id ON task_archive_events(task_id) WHERE task_id IS NOT NULL;
CREATE INDEX idx_tae_event_type ON task_archive_events(event_type, created_at DESC);
CREATE INDEX idx_tae_actor ON task_archive_events(actor, created_at DESC) WHERE actor IS NOT NULL;
```

---

_文档冻结：2026-04-20 | Sprint 45 | 蟹小钳 🦀_
