# SmartRouter Pro — 整体架构图 v1.1

> 版本：v1.1 | 日期：2026-04-24 | 状态：**当前运行版本**
> 关联：ARCHITECTURE-VISION / LLM-NATIVE-ROUTING-SPEC / GATED-DELEGATION-v2

---

## 1. 系统定位一句话

**轻量 AI Runtime（Lean Agent Runtime）** — 把 AI 系统从"全能黑箱"变成"分权系统"，本地 Fast 模型成为"用户利益代理人"，代表用户管理记忆、权限、风险和上下文暴露边界。

---

## 2. 整体三层架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          用户 (User)                                      │
│                      ↕ SSE / HTTP 通道                                   │
├─────────────────────────────────────────────────────────────────────────┤
│  Layer 1: 本地信任网关 (Local Trust Gateway)                              │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ • Guardrail (ToolGuardrail / Redaction Engine)                  │   │
│  │ • Policy Engine (hard_policy.ts / gating-config.ts)             │   │
│  │ • Audit Logger (delegation_logs)                                │   │
│  │ • Knowledge Boundary Signals (KB-1)                             │   │
│  └─────────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────────┤
│  Layer 2: 云端能力引擎 (Cloud Capability Engine)                         │
│  ┌──────────────────────┐    ┌──────────────────────┐                   │
│  │  Fast 模型 (7B)      │    │  Slow 模型 (72B)     │                   │
│  │  Qwen2.5-7B-Instruct │    │  Qwen2.5-72B-Instruct│                   │
│  │  工具: web_search    │    │  深度推理/复杂任务   │                   │
│  └──────────┬───────────┘    └──────────┬───────────┘                   │
│             │                             │                              │
│             └──────────┬──────────────────┘                              │
│                        ↓                                                  │
│              ┌─────────────────────┐                                       │
│              │   Task Archive      │  ← 唯一事实源                        │
│              │   (PostgreSQL)      │    Fast/Slow 共享读写                 │
│              └─────────────────────┘                                       │
├─────────────────────────────────────────────────────────────────────────┤
│  Layer 3: 执行与权限层 (Execution & Permission Layer)                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ • ToolGuardrail (http 白名单/HTTPS/timeout/响应大小)            │   │
│  │ • ExecutionLoop (顺序状态机: tool_call/reasoning/synthesis)    │   │
│  │ • Permission Layer (Phase 4)                                    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 请求入口路由 (chat.ts)

```
POST /chat
  │
  ├─ body.use_llm_native_routing === true
  │   └─→ routeWithManagerDecision()  ← 【当前主路径】
  │       ├─ Fast 模型打分 (Manager)
  │       ├─ KB-1 信号检测
  │       └─ Gated Delegation (G1→G2→G3)
  │
  ├─ body.execute === true
  │   └─→ taskPlanner.plan() + executionLoop.run()
  │
  ├─ body.stream === true (非 llm-native)
  │   └─→ orchestrator() + pollArchiveAndYield() SSE
  │
  └─ 默认
      └─→ orchestrator()  ← 【旧路径，待废弃】
```

**当前状态**：
- LLM-Native Routing 已上线，`use_llm_native_routing=true` 触发
- 旧 orchestrator 仍保留，作为 fallback

---

## 4. LLM-Native Routing 核心流程

```
用户输入
    ↓
┌─────────────────────────────────────────────────────────────┐
│  Manager 模型 (Fast, Qwen2.5-7B)                            │
│  输出四动作打分 JSON：                                        │
│  {                                                          │
│    llm_scores: { direct_answer, ask_clarification,          │
│                   delegate_to_slow, execute_task },          │
│    llm_confidence_hint,                                     │
│    features: { missing_info, needs_long_reasoning, ... }   │
│  }                                                          │
└────────────────────────┬────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│  KB-1: 知识边界信号检测 (可选模块)                            │
│  detectKnowledgeBoundarySignals()                            │
│  → 识别: 需要外部工具 / 知识截止日期外 / 实时数据             │
└────────────────────────┬────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│  G1: Action Score Head — 计算 system_confidence             │
│  calculateSystemConfidence()                                 │
│  → 综合: top1-top2 gap / KB校准 / 高成本惩罚                  │
└────────────────────────┬────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│  G2: Policy-Calibrated Gate — 规则校准                       │
│  calibrateWithPolicy()                                       │
│  → 硬编码规则: 缺信息/高风险/越权拦截                        │
│  → 可配置阈值: 各动作基础阈值/惩罚系数                       │
└────────────────────────┬────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│  G3: Rerank-on-Uncertainty — 低置信度二判                    │
│  shouldRerank() → ruleBasedRerank()                         │
│  → 触发: gap<0.08 || confidence<0.6                         │
│  → 规则式 rerank (轻量，不引复杂模型)                        │
└────────────────────────┬────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│  四路路由 (routeByDecision)                                   │
│  ┌─────────────────┬──────────────────┬────────────────┐    │
│  │ direct_answer   │ ask_clarification │ delegate_to_slow│   │
│  │ (L0, Fast 直接) │ (L0, 写入Archive) │ (L2, 慢模型)   │    │
│  └─────────────────┴──────────────────┴────────────────┘    │
│  ┌─────────────────┐                                          │
│  │ execute_task    │ (L3, ExecutionLoop)                      │
│  └─────────────────┘                                          │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Gated Delegation 四层详解

### G1: Action Score Head
| 项目 | 内容 |
|------|------|
| 输入 | Manager 模型输出的 `llm_scores` (四动作打分) |
| 输出 | `system_confidence` (系统计算置信度) |
| 原则 | 双轨置信度 — `llm_confidence_hint`(LLM自报) + `system_confidence`(系统计算) |
| 文件 | `src/services/gating/system-confidence.ts` |

### G2: Policy-Calibrated Gate
| 项目 | 内容 |
|------|------|
| 输入 | `llm_scores` + `features` |
| 输出 | `calibratedScores` + `policyOverrides` |
| 硬编码规则 | 缺信息时`execute_task`不可通过 / 高风险动作拦截 / policy禁止动作拦截 |
| 可配置项 | 各动作阈值 / gap阈值 / 惩罚系数 |
| 文件 | `src/services/gating/hard_policy.ts` + `gating-config.ts` |

### G3: Rerank-on-Uncertainty
| 项目 | 内容 |
|------|------|
| 触发条件 | gap<0.08 \|\| confidence<0.6 \|\| delegate/execute且confidence<0.75 |
| 实现 | 规则式 rerank + 可选极轻 LLM judge |
| 文件 | `src/services/gating/delegation-reranker.ts` |

### G4: Delegation Learning Loop ⏳ (Sprint 51+)
| 项目 | 内容 |
|------|------|
| 目标 | `delegation_logs` 决策事实表 |
| 记录 | query / scores / confidence / action / latency / cost / success四层 |
| 当前状态 | 设计中，待 Sprint 51 实施 |

---

## 6. KB-1 知识边界信号

| 信号类型 | 说明 |
|---------|------|
| EXTERNAL_API | 需要调用外部 API (天气/股价/新闻) |
| REAL_TIME | 实时信息 (当前时间/日期/汇率) |
| KNOWLEDGE_CUT | 知识截止日期之后的事件 |
| SPORTS_SCORE | 比分/赛果 |
| WEATHER | 天气查询 |
| NEWS_EVENT | 新闻事件 |
| STOCK_PRICE | 股价查询 |
| EXCHANGE_RATE | 汇率查询 |

**用途**: 校准 direct_answer 置信度(G1) / 触发 Policy 拦截(G2) / 触发 Rerank(G3) / Benchmark trace

---

## 7. Task Archive 共享工作台

```
┌─────────────────────────────────────────────────────────────┐
│  task_archives (PostgreSQL)                                  │
├─────────────────────────────────────────────────────────────┤
│  核心字段:                                                    │
│  • id, session_id, turn_id                                  │
│  • command (JSONB) — Fast→Slow 结构化指令                    │
│  • user_input — 原始用户输入                                 │
│  • constraints — 边界条件数组                                │
│  • fast_observations — Fast 执行观察 (JSONB)                 │
│  • slow_execution — Slow 执行轨迹 (JSONB)                    │
│  • status — pending→running→done|failed|cancelled           │
│  • delivered — 结果是否已推送用户                            │
├─────────────────────────────────────────────────────────────┤
│  Worker Loop:                                                │
│  • slow-worker-loop.ts — 轮询 delegate 命令，执行慢模型      │
│  • execute-worker-loop.ts — 轮询 execute_plan 命令           │
│  • 自适应轮询: <10s→2s, 10s~60s→3s, >60s→5s                 │
└─────────────────────────────────────────────────────────────┘
```

**原则**: Fast/Slow 共享 Archive，不是 pipeline（Fast等Slow），是共享空间。

---

## 8. 模块依赖关系

```
src/api/chat.ts (入口)
    │
    ├── routeWithManagerDecision()       ← LLM-Native 主路径
    │       │
    │       ├── Manager模型 (callModelFull)
    │       │       └── KB-1 (detectKnowledgeBoundarySignals)
    │       │
    │       ├── Gated Delegation (runGatedDelegation)
    │       │       ├── G1: system-confidence.ts
    │       │       ├── G2: policy-calibrator.ts / hard_policy.ts / gating-config.ts
    │       │       └── G3: delegation-reranker.ts
    │       │
    │       └── routeByDecision (四路路由)
    │               ├── direct_answer → Fast 直接回复
    │               ├── ask_clarification → 写Archive
    │               ├── delegate_to_slow → 写Archive+command
    │               │       └── slow-worker-loop.ts (后台轮询)
    │               └── execute_task → 写Archive+execution plan
    │                       └── execute-worker-loop.ts (后台轮询)
    │
    ├── orchestrator()                    ← 旧路径 (待废弃)
    │       └── (rule-router/complexity-scorer/intent-analyzer)
    │
    ├── taskPlanner.plan() + executionLoop.run()
    │       └── ExecutionLoop (EL: ToolGuardrail + 顺序状态机)
    │
    └── pollArchiveAndYield() (SSE 轮询)
            └── TaskArchiveRepo
                    └── PostgreSQL
```

---

## 9. 数据流概览

```
用户请求
    ↓
chat.ts (入口路由)
    ↓
Manager(Fast) — 四动作打分 + features + 知识边界检测
    ↓
Gated Delegation (G1→G2→G3)
    ↓
┌───────────────────────────────────────────────────────┐
│  direct_answer ─────→ 快速回复 (SSE)                  │
│  ask_clarification ─→ 写 Archive → SSE 安抚           │
│  delegate_to_slow ───→ 写 Archive(command)            │
│    └─ slow-worker-loop 后台轮询 → SSE 推送结果        │
│  execute_task ───────→ 写 Archive(execution plan)    │
│    └─ execute-worker-loop 后台轮询 → SSE 推送结果     │
└───────────────────────────────────────────────────────┘
    ↓
delegation_logs (审计记录)
```

---

## 10. 与旧架构的关系

| 模块 | 状态 | 说明 |
|------|------|------|
| `rule-router.ts` | ⚠️ 待删除 | 硬编码评分，已被 Manager 模型替代 |
| `complexity-scorer.ts` | ⚠️ 待删除 | 硬编码公式，已被 Manager 模型替代 |
| `intent-analyzer.ts` | ⚠️ 待删除 | 硬编码正则，已被 Manager 模型替代 |
| `orchestrator.ts` | ⚠️ 待删除 | 旧路径，LLM-Native 上线后可废弃 |
| `llm-native-router.ts` | ✅ 现行 | 主路径，ManagerDecision + Gated Delegation |
| `task_archives` | ✅ 现行 | Fast/Slow 共享工作台 |
| `ToolGuardrail` | ✅ 现行 | HTTP 白名单/HTTPS 强制/timeout |
| `Redaction Engine` | ✅ 现行 | Phase 4 数据脱敏 |
| `delegation_logs` | ⏳ Sprint 51 | 决策事实表（设计完成，待实施） |

---

## 11. 版本状态

| 版本 | 状态 | 日期 | 关键里程碑 |
|------|------|------|-----------|
| v1.0.0 | ✅ 完成 | 2026-04-19 | LAR 10层全绿，Phase A/B/C 完整交付 |
| v1.1.0 | ✅ 完成 | 2026-04-22 | Gated Delegation v2 (G1/G2/G3) + KB-1 |
| v1.1.1 | ✅ 当前 | 2026-04-22 | Sprint 50 COMPLETE，484/484 测试全绿 |
| v1.2.0 | ⏳ 规划中 | Sprint 51 | G4 Delegation Learning Loop |

---

_整理日期：2026-04-24 | by 蟹小钳 🦀_
