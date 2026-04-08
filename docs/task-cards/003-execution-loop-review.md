# EL-003 Review: Execution Loop

**Card:** EL-003 — Execution Loop
**Status:** ✅ Done
**Commit:** pending

---

## 验收结果

| 事项 | 状态 |
|---|---|
| `ExecutionLoop` class | ✅ |
| `tool_call` step: Function Calling model loop | ✅ |
| `reasoning` step: no-tool model call | ✅ |
| `synthesis` step: final answer generation | ✅ |
| Max steps guard (default: 10) | ✅ |
| Max tool calls guard (default: 20) | ✅ |
| No-progress abort (3 consecutive reasoning steps with no tool calls) | ✅ |
| Per-step trace writes to `task_traces` | ✅ |
| `loop_start` / `loop_end` trace | ✅ |
| `ChatRequest.execute` flag | ✅ |
| `ChatMessage` extended: `tool_calls`, `tool_call_id`, `"tool"` role | ✅ |
| `ExecutionLoop` wired into `chat.ts` (`body.execute === true`) | ✅ |
| Existing non-execute path untouched | ✅ |
| TypeScript build | ✅ |

---

## 产出文件

| 文件 | 描述 |
|---|---|
| `backend/src/services/execution-loop.ts` | 核心 ExecutionLoop 类 |
| `backend/src/types/index.ts` | ChatMessage 扩展（tool_calls / tool_call_id / "tool" role）；ChatRequest.execute |
| `backend/src/api/chat.ts` | execute 模式分支接入 |

---

## 架构：ExecutionLoop 作为顺序状态机

### Step 类型与行为

| `step.type` | 模型调用 | 工具 | 说明 |
|---|---|---|---|
| `tool_call` | `callModelWithTools`（含 schemas） | 可以发射 0~N 个 tool_calls | 模型决定是否调用工具；循环执行每个 tool_call 并回注结果 |
| `reasoning` | `callModelFull`（无 tools） | 无 | 模型生成中间结论，追加到 messages |
| `synthesis` / `unknown` | `callModelFull` | 无 | 最后一步，生成最终回答 |

### 消息累积模式

messages 数组在整个 loop 过程中持续增长：

```
user message
→ system (step 1) + assistant response (tool calls)
  → tool result message(s)
  → system (step 2) + assistant response
    → ...
```

每一步的 system prompt 包含：
- 当前 step 的 title 和 description
- 是否为最后一步的提示
- 对 `tool_call` 步骤：强制使用指定工具的提示（如果有 tool_name）

### Loop 结果

```typescript
interface LoopResult {
  taskId: string;
  plan: ExecutionPlan;
  messages: ChatMessage[];
  finalContent: string;   // 最后一条 assistant content
  completedSteps: number;
  totalSteps: number;
  toolCallsExecuted: number;
  reason: "completed" | "step_cap" | "tool_cap" | "no_progress" | "error";
}
```

---

## Trace 事件体系

所有事件写入 `task_traces`：

| trace.type | 触发时机 | detail 字段 |
|---|---|---|
| `loop_start` | loop 启动时 | total_steps, max_steps, max_tool_calls, model |
| `step_start` | 每步开始时 | step_index, step_title, step_type, tool_name |
| `step_complete` | 每步成功结束时 | step_index, step_type, tool_calls_this_step |
| `step_failed` | 步骤抛出异常时 | error |
| `loop_end` | loop 终止时 | reason, completed_steps, tool_calls_executed |
| `planning`（在 chat.ts） | planner 完成后 | goal, model, plan_steps, loop_reason, completed_steps, tool_calls |

---

## 硬护栏设计

### 1. Step Cap
- 默认上限 10 步（`DEFAULT_MAX_STEPS = 10`）
- 超过上限触发 `reason: "step_cap"`，loop 终止

### 2. Tool Call Cap
- 默认上限 20 次（`DEFAULT_MAX_TOOL_CALLS = 20`）
- 每步结束后检查；超过触发 `reason: "tool_cap"`

### 3. No-Progress Abort
- 连续 3 个 reasoning 步骤都没有发射新的 tool_call → 触发 `reason: "no_progress"`
- 防止模型在死循环里反复推理而不推进

### 4. Step Failure = Hard Abort
- 工具执行异常 → 标记 step 为 `failed` → 立即终止 loop
- v1 不做重试；失败即停

---

## ChatRequest.execute 触发机制

```typescript
// chat.ts 中的触发条件
if (body.execute === true) {
  // TaskPlanner.plan() → ExecutionLoop.run() → return { message }
}
```

设计意图：
- 显式触发：`body.execute = true` 告诉后端这是一个多步任务
- 不影响现有逻辑：没有 `execute` 字段的请求走原有单次模型调用路径
- 前端可以基于 intent complexity score 自动设置 `execute: true`

---

## 与现有系统的衔接

### Memory 注入
- ExecutionLoop 的 `#executeReasoningStep` 和 `#executeSynthesisStep` 中，
  可以通过扩展 system prompt 注入 memory context
- v1：memory 暂不注入 loop（loop 的 system prompt 保持 minimal）
- 未来：第一步 system prompt 中加入 memory text

### Task Traces
- 所有执行事件复用 `task_traces` 表（type 字段区分）
- planner 的 `planning` trace 记录计划内容
- loop 的 `step_*` trace 记录执行过程

### Tool Executor
- `toolExecutor.execute()` 是 loop 的心脏
- 所有工具参数校验在 executor 层完成
- 外部工具（http_request, web_search）在 executor 中抛出错误，依赖 EL-004 的 guardrail 机制在 loop 层面预检

---

## Scope 边界（v1）

### 已实现
- 线性顺序执行
- 三种 step 类型
- 硬护栏（step cap / tool cap / no-progress / failure）
- Function Calling 循环（工具结果回注）
- 完整 trace 记录

### 未实现（待后续）
- 动态重规划（plan 与执行不同步时重跑 planner）
- step 级重试
- 并行工具执行
- memory context 注入 loop
- EL-004: Tool Guardrail（外部 API 安全预检）
- 外部工具实际执行（http_request / web_search stub）

---

## 关键设计决策

### 1. Function Calling 循环，而不是"强制单次工具调用"

一种替代方案是：planner 在 plan 里写死工具名和参数，loop 直接调 executor 执行。
当前方案让模型在每步重新判断"是否需要调用工具"，更灵活，也更接近 agent 行为。
trade-off：模型可能决策错误（如不该调用时调用），这是 EL-004 guardrail 的职责范围。

### 2. messages 作为 shared accumulator

整个 loop 过程中只有一个 messages 数组，每步追加：
- 避免了每步重建完整 context 的开销
- 工具结果自然累积到下一步的输入中

### 3. No-progress 检测基于 tool_calls 计数

简单粗暴但有效。连续 3 个 reasoning 步都没产生新 tool_call = 没有实际进展。
更精细的检测（比较 step 结果与前一步）可以后续加。

---

## 运行示例

```
用户: "帮我研究量子计算最新进展，写一份报告"

body.execute = true

Step 1 (tool_call, tool_name=web_search):
  Model → tool_call("web_search", {query: "quantum computing latest research 2026"})
  Loop → executor.execute(web_search, ...)
  Loop → append tool result to messages

Step 2 (tool_call, tool_name=http_request):
  Model → tool_call("http_request", ...)
  Loop → executor.execute(http_request, ...)  [EL-004 pending: guardrail rejects]

Step 2 Failed → loop aborts, returns partial result
```

---

## 下一步：EL-004

- **Tool Guardrail**：外部工具（http_request, web_search）在执行前通过 guardrail 预检
  - 域名白名单
  - GET-only
  - 不透传认证信息
- Guardrail 检查发生在 loop 的 `#executeToolStep` 中，tool_call 执行之前
