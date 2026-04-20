# SmartRouter Pro — SSE 事件协议 v1（FROZEN）

> 版本：v1.0 | 日期：2026-04-19 | Sprint：39-C | 状态：**冻结 ✅**

---

## 1. 协议版本分层

| 版本 | 触发条件 | 状态 |
|------|---------|------|
| **Phase 3.0 SSE（v1）** | `use_llm_native_routing=true` | ✅ 冻结，禁止新增/修改 |
| Legacy SSE | `useOrchestrator=true` / `stream=true` | ⚠️ 维护中，done 语义已对齐 Phase 3.0 |

---

## 2. Phase 3.0 SSE（v1）— 权威协议

> 触发条件：`body.use_llm_native_routing === true` + `body.stream === true`

### 事件序列

```
Client → POST /chat { use_llm_native_routing: true, stream: true }
Server → manager_decision       [立即]
         ↓（如有 delegation）
Server → archive_written         [立即，archive 写入后]
Server → worker_started          [立即，Worker 拿到 command]
Server → command_issued          [立即]
Server → status                  [30s/60s/120s 安抚，每节点一次]
Server → worker_completed        [Worker 执行完成]
Server → manager_synthesized     [Manager 合成最终输出]
Server → result                  [最终文本]
Server → done                    [流结束]
```

### 事件清单（Phase 3.0 Sprint 补充）

| 事件名 | type 值 | stream/字段 | routing_layer | 触发时机 |
|--------|---------|------------|--------------|---------|
| `manager_decision` | `"manager_decision"` | message 安抚文本 | `L0` | Manager 决策后立即 |
| `clarifying_needed` | `"clarifying_needed"` | question_text/options | `L0` | decision_type=`ask_clarification` |
| `archive_written` | `"archive_written"` | task_id/archive_id/decision_type | 同 manager_decision | archive 创建完成后（来自 task_archive_events.archive_created） |
| `worker_started` | `"worker_started"` | task_id/command_id/worker_role | 同 manager_decision | Worker 拿到 command 后立即（来自 task_archive_events.worker_started） |
| `command_issued` | `"command_issued"` | task_id | 同 manager_decision | decision_type ∈ {`delegate_to_slow`, `execute_task`} |
| `status` | `"status"` | stream 安抚文本 | `L2` | pollArchiveAndYield，30s/60s/120s 节点 |
| `worker_completed` | `"worker_completed"` | task_id/command_id/worker_type/summary | `L2` | Worker 执行完成（来自 task_archive_events.worker_completed） |
| `manager_synthesized` | `"manager_synthesized"` | task_id/final_content/confidence | `L2` | Manager 合成最终输出后（来自 task_archive_events.manager_synthesized） |
| `result` | `"result"` | stream 最终文本 | `L2` | task.status=`done` |
| `error` | `"error"` | stream 错误描述 | `L2` | task.status=`failed` |
| `done` | `"done"` | **无** | 同 manager_decision | 流结束，无 payload |

### Payload 结构（JSON）

```typescript
// manager_decision
{ type: "manager_decision", decision_type: string, routing_layer: string, message: string }

// clarifying_needed
{ type: "clarifying_needed", routing_layer: string, question_text: string, options: string[], question_id: string }

// archive_written（Phase 3.0 Sprint 新增）
{ type: "archive_written", task_id: string, archive_id: string, decision_type: string, routing_layer: string, timestamp: string }

// worker_started（Phase 3.0 Sprint 新增）
{ type: "worker_started", task_id: string, command_id: string, worker_role: string, routing_layer: string, timestamp: string }

// command_issued
{ type: "command_issued", task_id: string, routing_layer: string }

// status
{ type: "status", stream: string, routing_layer: "L2" }

// worker_completed（Phase 3.0 Sprint 新增）
{ type: "worker_completed", task_id: string, command_id: string, worker_type: string, summary: string, routing_layer: string }

// manager_synthesized（Phase 3.0 Sprint 新增）
{ type: "manager_synthesized", task_id: string, final_content: string, confidence: number, routing_layer: string }

// result
{ type: "result", stream: string, routing_layer: "L2" }

// error
{ type: "error", stream: string, routing_layer: "L2" }

// done（无 stream 字段）
{ type: "done", routing_layer: string }
```

### 关键规则

1. **`done` 事件无 `stream` 字段** — done 是纯终止信号，不携带数据
2. **`status` 事件只有安抚文本** — 不携带结构化数据，前端仅做展示
3. **`result` 事件包含完整回复** — stream 字段携带慢模型最终文本
4. **`routing_layer` 不可为空** — 始终传播，从 manager_decision 继承

---

## 3. Legacy SSE — 对齐后版本

> 触发条件：`useOrchestrator=true` 或 `stream=true`（且 `use_llm_native_routing !== true`）

### 与 Phase 3.0 的差异

| 维度 | Phase 3.0（v1） | Legacy |
|------|----------------|--------|
| 初始安抚事件名 | `manager_decision` | `fast_reply` |
| 澄清事件名 | `clarifying_needed` | `clarifying` |
| done 事件 stream 字段 | **无** | ~~`[delegation_complete]`~~ / ~~`[stream_complete]`~~ → **已移除** |

### Legacy 事件序列

```
Client → POST /chat { stream: true }
Server → fast_reply  [立即，Fast 直接回复]
         ↓（如有 delegation）
Server → clarifying [Phase 1.5 澄清]
Server → status     [30s/60s/120s 安抚]
Server → result     [delegation 完成]
Server → done        [流结束，无 stream]
```

### Payload 结构（JSON）

```typescript
// fast_reply（与 manager_decision 结构相同，语义对齐）
{ type: "fast_reply", stream: string, routing_layer: string }

// clarifying
{ type: "clarifying", stream: string, options: string[], question_id: string, routing_layer: string }

// status / result / error — 同 Phase 3.0

// done（对齐 Phase 3.0：无 stream 字段）
{ type: "done", routing_layer: string }
```

---

## 4. 变更记录

| 日期 | 变更 | 理由 |
|------|------|------|
| 2026-04-19 | 初始冻结（Phase 3.0 SSE v1） | Sprint 39-C |
| 2026-04-19 | Legacy done 事件移除 `stream` 字段 | 与 Phase 3.0 对齐，统一 done 语义 |
| 2026-04-20 | 新增 archive_written/worker_started/worker_completed/manager_synthesized 事件 | Sprint 45 Phase 3.0 补全 |

---

## 5. 禁止事项（v1）

1. 禁止在 `done` 事件中携带 `stream` 字段
2. 禁止新增与 Phase 3.0 同义不同名的事件
3. 禁止在 Phase 3.0 SSE 中使用 `fast_reply` / `clarifying` 等 Legacy 事件名
4. 禁止修改已冻结的 Phase 3.0 事件序列

如需变更协议，必须通过新的 Sprint 提案，经评审后升级版本号。

---

## 6. 前端消费指南

```typescript
// SSE 事件消费逻辑
for await (const line of sseStream) {
  const event = JSON.parse(line);
  switch (event.type) {
    case "manager_decision":
    case "fast_reply":
      // 初始安抚消息，显示在 chat 区域
      break;
    case "clarifying_needed":
    case "clarifying":
      // 显示澄清 UI
      break;
    case "archive_written":
      // Archive 已写入，开始 Worker 进度展示
      console.log("Archive created:", event.archive_id);
      break;
    case "worker_started":
      // Worker 开始执行，显示 spinner
      console.log("Worker started:", event.worker_role);
      break;
    case "command_issued":
      // Command 已下发
      break;
    case "status":
      // 显示安抚文本
      break;
    case "worker_completed":
      // Worker 完成，显示摘要
      console.log("Worker completed:", event.summary);
      break;
    case "manager_synthesized":
      // Manager 合成完成，显示最终回复（优先级高于 result）
      showFinalContent(event.final_content);
      break;
    case "result":
      // 显示慢模型回复（manager_synthesized 已有则可跳过）
      break;
    case "error":
      // 显示错误提示
      break;
    case "done":
      // 流结束，移除 loading 状态
      break;
  }
}
```

> **优先级说明**：`manager_synthesized` 和 `result` 都携带最终回复文本。
> 建议优先使用 `manager_synthesized.final_content`（Manager 合成后更精炼），
> `result` 作为 fallback。

> 注意：`manager_decision` 和 `fast_reply` 语义相同，可合并处理；`clarifying_needed` 和 `clarifying` 语义相同，可合并处理。

---

_冻结：2026-04-19 | Sprint 39-C | 蟹小钳 🦀_
