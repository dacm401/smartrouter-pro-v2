# SmartRouter Pro — ManagerDecision Schema

> 版本：v1.0 | 日期：2026-04-20 | Phase：Phase 1 | 状态：**ACTIVE**

---

## 1. 概述

`ManagerDecision` 是 Phase 1 引入的核心决策类型，用于替代旧的 `intent + complexity + rule score` 打分体系。

Fast Manager（管理模型）根据用户请求输出结构化 `ManagerDecision` JSON，系统按 `decision_type` 分发到对应处理路径。

---

## 2. JSON Schema

```json
{
  "schema_version": "manager_decision_v1",
  "decision_type": "direct_answer | ask_clarification | delegate_to_slow | execute_task",
  "reason": "string",
  "confidence": 0.0 - 1.0,
  "needs_archive": true,
  "direct_response": { "content": "string" },
  "clarification": {
    "question_text": "string",
    "options": [{ "label": "string", "description": "string" }]
  },
  "command": {
    "command_type": "delegate_analysis | delegate_summarization | execute_plan | execute_research",
    "task_type": "string",
    "task_brief": "string",
    "goal": "string",
    "constraints": ["string"],
    "input_materials": [{ "type": "string", "content": "string", "ref_id": "string", "title": "string" }],
    "required_output": { "format": "string", "sections": ["string"], "tone": "string" },
    "tools_allowed": ["string"],
    "priority": "low | normal | high",
    "timeout_sec": 300,
    "worker_hint": "slow_analyst | execute_worker | search_worker"
  }
}
```

---

## 3. decision_type 说明

| decision_type | 语义 | 触发条件 |
|---|---|---|
| `direct_answer` | Fast Manager 直接回复 | 闲聊/打招呼/简单问答 |
| `ask_clarification` | 请求用户澄清 | 请求模糊、缺少关键信息 |
| `delegate_to_slow` | 委托慢模型处理 | 深度分析/复杂推理/知识截止日期外 |
| `execute_task` | 执行任务（需要工具） | 代码/搜索/多步操作 |

---

## 4. 校验规则

- `schema_version` 必须为 `"manager_decision_v1"`
- `decision_type` 必须在枚举范围内
- `confidence` 必须在 0.0–1.0 之间
- `direct_answer` 必须有 `direct_response.content`
- `ask_clarification` 必须有 `clarification.question_text`
- `delegate_to_slow` / `execute_task` 必须有 `command`

校验失败 → fallback 到 `direct_answer` 路径

---

## 5. 与旧路由的关系

Phase 1 采用双轨过渡：

```
用户请求
    ↓
use_llm_native_routing === true?
    ├─ 是 → ManagerDecision 路由（Phase 1 新路径）
    └─ 否 → 旧 orchestrator 路由（fallback）
```

ManagerDecision 失败 → 自动 fallback 到旧 orchestrator

---

## 6. 实现文件

- 类型定义：`src/types/index.ts`（`ManagerDecision` / `ManagerDecisionType`）
- 校验器：`src/orchestrator/decision-validator.ts`（`parseAndValidate()`）
- Manager Prompt：`src/services/llm-native-router.ts`（`buildManagerSystemPrompt()`）
- 路由入口：`src/services/llm-native-router.ts`（`routeWithManagerDecision()`）
- chat 接入：`src/api/chat.ts`（`use_llm_native_routing === true` 分支）

---

_文档冻结：2026-04-20 | Sprint 45 | 蟹小钳 🦀_
